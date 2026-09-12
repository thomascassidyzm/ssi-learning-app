/**
 * servedPod — which listening pod does this course actually serve?
 *
 * Pods used to be a constant: every course served `<course>:pod-0`, and five
 * separate call sites hardcoded that string. Tom's ruling (2026-08-22) makes
 * pods 1-BASED from here on, with `hrv_for_eng` the first course authored as
 * `pod-1`. The ~68 courses already recorded against `pod-0` keep serving
 * `pod-0` and must not change behaviour by so much as a query. So "the course's
 * pod" stops being a constant and becomes a lookup — this module is that
 * lookup, and it is the only place the slug is decided.
 *
 * Rules, in the order they matter:
 *
 * 1. ONLY `pod-1` and `pod-0` are ever served, `pod-1` first. This is a hard
 *    gate, not a default. Unreleased Layer 2 content is held back by PARKING a
 *    pod on a non-serving slug — `pod-0-unrecorded` (37 courses as of
 *    2026-08-22), `pod-0-gated-2026-08-06` (2 courses) — so that every learner
 *    path reads "no pods yet". A resolver that fell through to "whatever core
 *    pod exists" would publish all 39 of them at once. It must never widen.
 *
 * 2. Anything unknown resolves to `pod-0`: no rows, no `pod-1`, a query error,
 *    a missing course. Today's behaviour is the floor, so a transient failure
 *    degrades to exactly what shipped yesterday and never to "no pods".
 *
 * 3. One resolution per course per session. Five call sites share one memoised
 *    in-flight promise (the same shape listeningMetaCache uses for its
 *    once-only fetches) so the flip costs one round-trip, not five.
 * * 5. A pod that NAMES A ROLE is addressed to one person, and outranks
 *    everything above it for the person who holds that role. This is the one
 *    way a non-serving slug is ever served, and it is safe because the CLIENT
 *    does not decide it: RLS returns a role-restricted row only to a holder of
 *    that role (database/changes/20260903_restricted_content_by_role.sql in
 *    Popty), so for everybody else the row does not exist and rule 1 is
 *    exactly as hard as it was. It rides on the same round-trip as rule 1.
 *
 * 4. Offline, the answer comes from the download snapshot. The offline
 *    metadata cache persists the slug it was built from, so a learner who
 *    downloaded Croatian keeps reading the pod they actually have — and
 *    resolves it with no network round-trip at all. The snapshot's slug is
 *    still run through rule 1, so a parked slug can never enter this way.
 *
 * 5. A HELD pod resolves to "no pods yet" for free, and that is deliberate.
 *    `listening_pods.visibility` ('live' | 'held', added 2026-08-23 — see
 *    ssi-dashboard-v7-clean/database/changes/20260823_listening_pod_visibility.sql)
 *    lets a human hold a pod back while they are still recording it. The gate
 *    is enforced in RLS, so a held pod's row is simply not there for the
 *    anon-key query below: `found` comes back without it and rule 2 lands on
 *    `pod-0`, whose sentence read is likewise empty. Held and absent are
 *    INDISTINGUISHABLE to this resolver on purpose — that is what makes a hold
 *    invisible (Tom's ruling: not a greyed tab, not an empty pod, not "coming
 *    soon") rather than conspicuous. Do NOT add a visibility filter here; the
 *    anon client cannot see a held row to filter, and pretending otherwise
 *    would imply this code is the enforcement when RLS is.
 *
 *    Readers that BYPASS RLS must filter explicitly with `LIVE_POD_VISIBILITY`.
 *    Today that is exactly one learner-facing route: api/courses/[code]/bundle.ts,
 *    which builds its client from SUPABASE_SERVICE_ROLE_KEY and would otherwise
 *    ship a held pod's sentences into the offline bundle.
 *
 * 6. LISTENING MODE MAY SHOW EXTRA SLOTS; MAIN FLOW NEVER DOES. Tom's ruling
 *    (2026-09-12, job #354): the Italian method pod sits ALONGSIDE Pod 1 in
 *    Listening Mode as a third slot, never replacing it and never re-slugging
 *    it. `LISTENING_EXTRA_POD_SLUGS` is a second CLOSED allow-list of named
 *    slugs, read only by `resolveListeningPods` — the Dialogues list and the
 *    offline snapshot. `resolveServedPod`, and therefore every MAIN-FLOW reader
 *    (usePodLapScheduler, usePodStage0, generateLearningScript), still answers
 *    with exactly ONE pod from rule 1 and never sees the extra list. Rule 1 is
 *    unchanged as written: nothing here falls through to "whatever pod
 *    exists", and a held extra pod is absent to the anon client exactly as a
 *    held served pod is (rule 5), so flipping its visibility is the release.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { isOfflineish, withNetworkTimeout, NETWORK_TIMEOUT } from '../config/networkGate'
import { getCachedListeningMeta } from './listeningMetaCache'

/** The only slugs a MAIN-FLOW learner path may ever read, in preference order. */
export const SERVING_POD_SLUGS = ['pod-1', 'pod-0'] as const

/**
 * Extra slots LISTENING MODE lists after the served pod (rule 6). A closed
 * allow-list of NAMED slugs, exactly like rule 1 — never a fall-through. Main
 * flow never reads this list.
 */
export const LISTENING_EXTRA_POD_SLUGS = ['method-pod'] as const

/** What every unknown resolves to — today's behaviour for all ~68 courses. */
export const FALLBACK_POD_SLUG = 'pod-0'

/**
 * The `listening_pods.visibility` value a learner is allowed to reach.
 *
 * RLS already enforces this for every anon-key read (rule 5 above). It is
 * exported for the service-role readers that bypass RLS and must therefore
 * filter by hand — see api/courses/[code]/bundle.ts.
 */
export const LIVE_POD_VISIBILITY = 'live' as const

export interface ServedPod {
  /** Bare slug, e.g. `pod-1`. Needed by id-prefix readers (usePodStage0). */
  slug: string
  /** `listening_pods.id` — `<courseCode>:<slug>`. */
  podId: string
}

const servedPod = (courseCode: string, slug: string): ServedPod => ({
  slug,
  podId: `${courseCode}:${slug}`,
})

/** One entry of the Listening Mode pod list: the served pod, then extras. */
export interface ListeningPod extends ServedPod {
  /** `listening_pods.title` — the group heading Listening Mode shows when a
   *  course lists more than one pod. Null when the row carried none. */
  title: string | null
}

export interface PodRow {
  slug: string
  /** `listening_pods.required_role` — NULL/absent means "everyone". */
  required_role?: string | null
  title?: string | null
}

/**
 * Which slug do these rows mean? Pure, so the rule can be tested without a
 * client. A row only reaches here if RLS let it through, so a role-restricted
 * row IS one this reader may play — the check has already happened server-side
 * and this function must not try to repeat it.
 */
export const pickServedSlug = (rows: PodRow[] | null | undefined): string => {
  const list = rows ?? []
  // Rule 5: personally addressed content wins, on any slug.
  const addressed = list.find((r) => typeof r.required_role === 'string' && r.required_role !== '')
  if (addressed && typeof addressed.slug === 'string' && addressed.slug !== '') {
    return addressed.slug
  }
  // Rule 1: the hard gate, in preference order.
  const found = new Set(list.map((r) => r.slug))
  for (const slug of SERVING_POD_SLUGS) {
    if (found.has(slug)) return slug
  }
  // Rule 2: no serving pod — the course has none yet, or its only pod is
  // parked. Both read as `pod-0`, whose sentence query returns zero rows.
  return FALLBACK_POD_SLUG
}

const isServingSlug = (slug: unknown): slug is string =>
  typeof slug === 'string' && (SERVING_POD_SLUGS as readonly string[]).includes(slug)

/** courseCode → the one in-flight/settled resolution for this session. */
const inFlight = new Map<string, Promise<ServedPod>>()

/**
 * The slug the offline download snapshot was built from, if it is one we are
 * allowed to serve. Never throws — cache trouble degrades to "no opinion".
 */
const cachedSlug = async (courseCode: string): Promise<string | null> => {
  try {
    const cached = await getCachedListeningMeta(courseCode)
    return isServingSlug(cached?.podSlug) ? cached!.podSlug! : null
  } catch {
    return null
  }
}

const resolveOnce = async (
  client: SupabaseClient,
  courseCode: string,
): Promise<ServedPod> => {
  // Offline first: the snapshot already knows, and a doomed fetch would only
  // spend the learner's boot budget to learn nothing.
  if (isOfflineish()) {
    const offline = await cachedSlug(courseCode)
    if (offline) return servedPod(courseCode, offline)
  }

  // `withNetworkTimeout` returns the sentinel on a hang but still PROPAGATES a
  // real rejection, so both arms have to land in the same fallback.
  let result: { data: PodRow[] | null; error: unknown } | typeof NETWORK_TIMEOUT
  try {
    result = await withNetworkTimeout(
      client
        .from('listening_pods')
        .select('slug, required_role')
        .eq('course_code', courseCode)
        // Rule 1 unchanged, plus rule 5 on the same round-trip. The role arm
        // carries no slug or pod_type filter on purpose: a pod addressed to a
        // person may live on any slug, and RLS — not this query — is what
        // makes it invisible to everyone else.
        .or(
          `required_role.not.is.null,and(pod_type.eq.core,slug.in.(${SERVING_POD_SLUGS.join(',')}))`,
        ),
    )
  } catch {
    result = NETWORK_TIMEOUT
  }

  if (result === NETWORK_TIMEOUT || result.error) {
    // Degrade to what this device last knew, else to today's behaviour.
    const fallback = (await cachedSlug(courseCode)) ?? FALLBACK_POD_SLUG
    return servedPod(courseCode, fallback)
  }

  return servedPod(courseCode, pickServedSlug(result.data))
}

/**
 * Which pod does this course serve? Memoised per course for the session; every
 * failure mode resolves (never rejects) to `pod-0`.
 */
export const resolveServedPod = (
  client: SupabaseClient,
  courseCode: string,
): Promise<ServedPod> => {
  const existing = inFlight.get(courseCode)
  if (existing) return existing
  const pending = resolveOnce(client, courseCode).catch(() =>
    servedPod(courseCode, FALLBACK_POD_SLUG),
  )
  inFlight.set(courseCode, pending)
  return pending
}

const isExtraSlug = (slug: unknown): slug is string =>
  typeof slug === 'string' && (LISTENING_EXTRA_POD_SLUGS as readonly string[]).includes(slug)

/**
 * Which extra pods do these rows carry, in allow-list order? Pure. Only a
 * core pod on a NAMED extra slug counts — a row on any other slug is ignored
 * even if the server sent it, so this is a gate in its own right and not just
 * a mirror of the query's `.in()`.
 */
export const pickListeningExtras = (
  rows: Array<PodRow & { pod_type?: string | null }> | null | undefined,
): Array<{ slug: string; title: string | null }> => {
  const list = rows ?? []
  const out: Array<{ slug: string; title: string | null }> = []
  for (const slug of LISTENING_EXTRA_POD_SLUGS) {
    const hit = list.find(
      (r) => r.slug === slug && (r.pod_type == null || r.pod_type === 'core'),
    )
    if (hit) out.push({ slug, title: typeof hit.title === 'string' ? hit.title : null })
  }
  return out
}

/** courseCode → the one in-flight/settled Listening Mode list for this session. */
const inFlightListening = new Map<string, Promise<ListeningPod[]>>()

/**
 * Courses whose Listening Mode list this session did NOT get from a live
 * server read — it came from the offline snapshot, from the timeout/error
 * fallback, or from the last-ditch served-pod-alone catch. Read by
 * listeningMetaCache so a snapshot written off a fallback list is not filed
 * as "every slot known" (job #424: one bad first fetch on a device with no
 * cached extras wrote `extraPods: []`, and the once-per-boot heal never ran
 * again while the content stamp stood still).
 */
const degradedListening = new Set<string>()

/**
 * Was this session's Listening Mode list for the course a fallback rather
 * than a live read? False until resolveListeningPods has settled.
 */
export const isListeningPodLookupDegraded = (courseCode: string): boolean =>
  degradedListening.has(courseCode)

/**
 * Courses whose offline snapshot the heal (ensureListeningMetaSnapshot) has
 * already refreshed THIS session. The heal is called on every round advance,
 * not once per boot, and a snapshot flagged extrasDegraded stays flagged
 * while the degraded memo above stands — so without this mark one flaky
 * first fetch re-read pod rows and clip texts and rewrote the snapshot on
 * every advance for the rest of the session (job #425). Once per session.
 * "Healed" means a SUCCESSFUL write: a failed fetch leaves the course
 * unmarked so the next round advance retries it (job #430).
 */
const healedListening = new Set<string>()
export const wasListeningSnapshotHealed = (courseCode: string): boolean => healedListening.has(courseCode)
export const markListeningSnapshotHealed = (courseCode: string): void => { healedListening.add(courseCode) }

/**
 * The extra pods (and their titles) the offline snapshot was built from —
 * re-gated through the allow-list, like the served slug. Never throws.
 */
const cachedExtras = async (
  courseCode: string,
): Promise<Array<{ slug: string; title: string | null }> | null> => {
  try {
    const cached = await getCachedListeningMeta(courseCode)
    if (!cached) return null
    const extras = Array.isArray(cached.extraPods) ? cached.extraPods : []
    return extras
      .filter((e) => isExtraSlug(e?.slug))
      .map((e) => ({ slug: e.slug, title: typeof e.title === 'string' ? e.title : null }))
  } catch {
    return null
  }
}

const resolveListeningOnce = async (
  client: SupabaseClient,
  courseCode: string,
): Promise<ListeningPod[]> => {
  // The served pod is rule 1, unchanged and already memoised; it is always
  // the first slot. Offline it comes from the snapshot's `podSlug`.
  const served = await resolveServedPod(client, courseCode)
  const asListening = (
    extras: Array<{ slug: string; title: string | null }>,
    servedTitle: string | null,
  ): ListeningPod[] => [
    { ...served, title: servedTitle },
    ...extras
      // An extra slot never duplicates the served pod (rule 5 can serve a
      // role-addressed pod on any slug, including in principle an extra one).
      .filter((e) => e.slug !== served.slug)
      .map((e) => ({ ...servedPod(courseCode, e.slug), title: e.title })),
  ]

  if (isOfflineish()) {
    const offline = await cachedExtras(courseCode)
    if (offline) {
      degradedListening.add(courseCode)
      const cached = await getCachedListeningMeta(courseCode).catch(() => null)
      return asListening(offline, cached?.podTitle ?? null)
    }
  }

  // One round-trip: the extra slots plus the served pod's own title. The
  // extra arm is a closed `.in()` on named slugs and is re-gated client-side
  // by pickListeningExtras. No visibility filter, on purpose (rule 5): a held
  // row is absent to the anon client, so a held method pod simply is not here.
  let result:
    | { data: Array<PodRow & { pod_type?: string | null }> | null; error: unknown }
    | typeof NETWORK_TIMEOUT
  try {
    result = await withNetworkTimeout(
      client
        .from('listening_pods')
        .select('slug, title, pod_type, required_role')
        .eq('course_code', courseCode)
        .eq('pod_type', 'core')
        .in('slug', [...LISTENING_EXTRA_POD_SLUGS, served.slug]),
    )
  } catch {
    result = NETWORK_TIMEOUT
  }

  if (result === NETWORK_TIMEOUT || result.error) {
    // Degrade to what this device last knew, else to the served pod alone —
    // today's behaviour, never fewer pods than main flow serves.
    degradedListening.add(courseCode)
    const fallback = (await cachedExtras(courseCode)) ?? []
    const cached = await getCachedListeningMeta(courseCode).catch(() => null)
    return asListening(fallback, cached?.podTitle ?? null)
  }

  degradedListening.delete(courseCode)
  const rows = result.data ?? []
  const servedRow = rows.find((r) => r.slug === served.slug)
  const servedTitle = typeof servedRow?.title === 'string' ? servedRow.title : null
  return asListening(pickListeningExtras(rows), servedTitle)
}

/**
 * Every pod Listening Mode lists for this course, served pod FIRST, then the
 * named extra slots the course actually has (rule 6). Memoised per course for
 * the session; every failure mode resolves (never rejects) to at least the
 * served pod. Main flow must never call this — it wants resolveServedPod.
 */
export const resolveListeningPods = (
  client: SupabaseClient,
  courseCode: string,
): Promise<ListeningPod[]> => {
  const existing = inFlightListening.get(courseCode)
  if (existing) return existing
  const pending = resolveListeningOnce(client, courseCode).catch(async () => {
    degradedListening.add(courseCode)
    const served = await resolveServedPod(client, courseCode)
    return [{ ...served, title: null }]
  })
  inFlightListening.set(courseCode, pending)
  return pending
}

/** Drop the memo — tests, and any future content-version reset. */
export const resetServedPodCache = (): void => {
  inFlight.clear()
  inFlightListening.clear()
  degradedListening.clear()
  healedListening.clear()
}
