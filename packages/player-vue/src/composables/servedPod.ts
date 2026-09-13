/**
 * servedPod — which listening pod does this course actually serve?
 *
 * Every course's core listening pod is `<course>:pod-1`. Pods by TOPIC (the
 * method pod, a Senedd pod, a health pod) live on their own named slugs and
 * are listed by Listening Mode (rule 6) or addressed to a person (rule 5);
 * main flow reads exactly one pod, and this module is the only place that
 * slug is decided.
 *
 * MIGRATION NOTE (the one historical note on the app side): core pods were
 * once slugged `pod-0`. Tom's ruling, 2026-09-13 14:44Z: "Pod-0 does not
 * exist anymore. There should be zero references to it in code or docs or
 * briefs. There is only pod-1 now. And then pods by topic like Method Pod,
 * Senedd Pod, Health Pod." The production data was renamed to `pod-1` the
 * same day (Popty tools/pods/retire-pod-slug.cjs, one transaction per course,
 * learner progress and provenance moved with it). Old ids in OLD DATA — an
 * offline snapshot written before the rename, an audit-log row — still carry
 * the old segment; listeningMetaCache maps such a snapshot forward on read.
 * Nothing else in this app may branch on the old name.
 *
 * Rules, in the order they matter:
 *
 * 1. ONLY `pod-1` is ever served to main flow. This is a hard gate, not a
 *    default. Unreleased Layer 2 content is held back by PARKING a pod on a
 *    non-serving slug (`unrecorded`, `gated-<date>`, `retired-<date>`) so that
 *    every learner path reads "no pods yet". A resolver that fell through to
 *    "whatever core pod exists" would publish every parked pod at once. It
 *    must never widen.
 *
 * 2. Anything unknown resolves to `pod-1`: no rows, a query error, a missing
 *    course. A transient failure degrades to the served pod's own name, whose
 *    sentence query then answers for itself, and never to "no pods".
 *
 * 3. One resolution per course per session. Five call sites share one memoised
 *    in-flight promise (the same shape listeningMetaCache uses for its
 *    once-only fetches) so the flip costs one round-trip, not five.
 *
 * 4. Offline, the answer comes from the download snapshot. The offline
 *    metadata cache persists the slug it was built from, so a learner who
 *    downloaded Croatian keeps reading the pod they actually have — and
 *    resolves it with no network round-trip at all. The snapshot's slug is
 *    still run through rule 1, so a parked slug can never enter this way.
 *
 * 5. A pod that NAMES A ROLE is addressed to one person, and RLS returns the
 *    row only to a holder of that role (database/changes/
 *    20260903_restricted_content_by_role.sql in Popty); for everybody else the
 *    row does not exist. Such a pod is a TOPIC pod (the Senedd pod is
 *    `cym_n_for_eng:senedd-s4c-steve`, pod_type 'choice' on its own slug): it
 *    is listed by Listening Mode as its own card, titled from its own row,
 *    AFTER pod-1 — never in place of it (Tom's decision, 2026-09-13, job
 *    #544: "topic pods sit ALONGSIDE pod-1 as their own cards, never replacing
 *    pod-1; the serving list must include every pod RLS returns for the
 *    learner, pod-1 first, topic pods after"). Main flow does not read it:
 *    rule 1 is exactly as hard for a role-holder as for anyone else. Before
 *    this the addressed pod REPLACED pod-1 in the served slot for its
 *    holder, so Steve saw the Senedd pod labelled "Pod 1" and no real pod-1
 *    at all (job #539 probes); an offline snapshot written in that window
 *    still records it as served, and listeningMetaCache maps such an entry
 *    forward on read and heals it on the next online boot (job #553). The
 *    client still does not decide who may see
 *    it: a row is listed because the server sent it, and this reader must not
 *    try to repeat the role check.
 *
 *    A HELD pod resolves to "no pods yet" for free, and that is deliberate.
 *    `listening_pods.visibility` ('live' | 'held', added 2026-08-23 — see
 *    ssi-dashboard-v7-clean/database/changes/20260823_listening_pod_visibility.sql)
 *    lets a human hold a pod back while they are still recording it. The gate
 *    is enforced in RLS, so a held pod's row is simply not there for the
 *    anon-key query below: `found` comes back without it and rule 2 lands on
 *    `pod-1`, whose sentence read is likewise empty. Held and absent are
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
 *    it. The list `resolveListeningPods` answers is: pod-1, then the named
 *    slugs in `LISTENING_EXTRA_POD_SLUGS` (a CLOSED allow-list, exactly like
 *    rule 1 — never a fall-through), then every role-addressed pod the server
 *    returned (rule 5). `resolveServedPod`, and therefore every MAIN-FLOW
 *    reader (usePodLapScheduler, usePodStage0, generateLearningScript), still
 *    answers with exactly ONE pod from rule 1 and never sees the list. A
 *    parked pod is on neither list and has no role, so it is never listed
 *    even though the server may send it; a held pod is absent to the anon
 *    client exactly as under rule 5, so flipping its visibility is the
 *    release.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { isOfflineish, withNetworkTimeout, NETWORK_TIMEOUT } from '../config/networkGate'
import { getCachedListeningMeta } from './listeningMetaCache'

/** The only slugs a MAIN-FLOW learner path may ever read, in preference order. */
export const SERVING_POD_SLUGS = ['pod-1'] as const

/**
 * Extra slots LISTENING MODE lists after the served pod (rule 6). A closed
 * allow-list of NAMED slugs, exactly like rule 1 — never a fall-through. Main
 * flow never reads this list. Each slug carries the ONE pod_type it may hold
 * (LISTENING_EXTRA_POD_TYPE): a row on a named slug of any other type is
 * ignored even if the server sent it.
 *
 *  - `method-pod` (core): the Italian method pod (Tom, 2026-09-12, job #354).
 *  - `senedd-s4c-steve` (choice): the Senedd/S4C pod, opened to EVERY Welsh
 *    (Northern) learner by Tom's release ruling of 2026-09-13 20:31Z (job
 *    #605). While it named a role it reached its holders through rule 5; with
 *    `required_role` NULL a `choice` pod on its own slug matches neither the
 *    served slot nor the role arm, so it is listed here or it is listed
 *    nowhere — for Steve too. Not in the offline bundle (api/courses/[code]/
 *    bundle.ts keeps its own closed list): 567 lines is a download-size call
 *    nobody has made, so it listens online, exactly as it did for its holders.
 */
export const LISTENING_EXTRA_POD_SLUGS = ['method-pod', 'senedd-s4c-steve'] as const

/** The pod_type each named extra slot must carry to be listed. */
export const LISTENING_EXTRA_POD_TYPE: Record<(typeof LISTENING_EXTRA_POD_SLUGS)[number], 'core' | 'choice'> = {
  'method-pod': 'core',
  'senedd-s4c-steve': 'choice',
}

/** What every unknown resolves to — the served pod's own name (rule 2). */
export const FALLBACK_POD_SLUG = 'pod-1'

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
  /** True for a role-addressed topic pod (rule 5): the server returned it
   *  because THIS reader holds its role. Persisted into the offline snapshot
   *  so the read-back gate can tell it from a parked slug. */
  addressed?: true
}

export interface PodRow {
  slug: string
  /** `listening_pods.required_role` — NULL/absent means "everyone". */
  required_role?: string | null
  title?: string | null
}

/**
 * Which slug does MAIN FLOW play? Pure, so the rule can be tested without a
 * client. Rule 1 only: pod-1 when the server sent it, else the fallback.
 */
export const pickServedSlug = (rows: PodRow[] | null | undefined): string => {
  const list = rows ?? []
  // Rule 1: the hard gate, in preference order. A role-addressed row on any
  // other slug is a TOPIC pod for Listening Mode (rule 5), not the served
  // pod — it must never displace pod-1 here.
  const found = new Set(list.map((r) => r.slug))
  for (const slug of SERVING_POD_SLUGS) {
    if (found.has(slug)) return slug
  }
  // Rule 2: no serving pod — the course has none yet, or its only pod is
  // parked. Both read as `pod-1`, whose sentence query returns zero rows.
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
        .select('slug')
        .eq('course_code', courseCode)
        // Rule 1 and nothing else: the serving slugs, core type. A
        // role-addressed topic pod (rule 5) is Listening Mode's business.
        .eq('pod_type', 'core')
        .in('slug', [...SERVING_POD_SLUGS]),
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
 * failure mode resolves (never rejects) to `pod-1`.
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

/** True when the server sent this row because the reader holds its role. */
const isAddressed = (r: PodRow): boolean =>
  typeof r.required_role === 'string' && r.required_role !== ''

/** One Listening Mode extra slot, before it is stamped with the course code. */
export interface ListeningExtra {
  slug: string
  title: string | null
  addressed?: true
}

/**
 * Which extra pods do these rows carry? Pure. Two sources, in this order:
 *
 *  - the NAMED extra slugs, in allow-list order — only a pod of that slug's
 *    own type (LISTENING_EXTRA_POD_TYPE) on a named slug counts, so a row on
 *    any other slug, or of the wrong type, is ignored even if the server sent
 *    it (this is a gate in its own right, not a mirror of the query);
 *  - then every ROLE-ADDRESSED pod (rule 5), on any slug and of any type,
 *    ordered by `pod_order` then slug so the list is stable. The server has
 *    already decided this reader holds the role; a null/empty role is not
 *    addressed and never widens the gate.
 */
export const pickListeningExtras = (
  rows: Array<PodRow & { pod_type?: string | null; pod_order?: number | null }> | null | undefined,
): ListeningExtra[] => {
  const list = rows ?? []
  const out: ListeningExtra[] = []
  for (const slug of LISTENING_EXTRA_POD_SLUGS) {
    const hit = list.find(
      (r) => r.slug === slug && (r.pod_type == null || r.pod_type === LISTENING_EXTRA_POD_TYPE[slug]),
    )
    // A named slot the server sent on the strength of a role (the Senedd pod
    // between its 16:17Z release to holders and its 20:31Z opening to all) is
    // still recorded as addressed: the snapshot keeps it for that holder.
    if (hit) {
      out.push({
        slug,
        title: typeof hit.title === 'string' ? hit.title : null,
        ...(isAddressed(hit) ? { addressed: true as const } : {}),
      })
    }
  }
  const named = new Set(out.map((e) => e.slug))
  const addressed = list
    .filter((r) => isAddressed(r) && typeof r.slug === 'string' && r.slug !== '' && !named.has(r.slug))
    .sort(
      (a, b) =>
        (a.pod_order ?? Number.MAX_SAFE_INTEGER) - (b.pod_order ?? Number.MAX_SAFE_INTEGER) ||
        a.slug.localeCompare(b.slug),
    )
  for (const r of addressed) {
    if (named.has(r.slug)) continue
    named.add(r.slug)
    out.push({ slug: r.slug, title: typeof r.title === 'string' ? r.title : null, addressed: true })
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
 * What the offline snapshot says the Listening Mode list is: the extra pods
 * it was built from, re-gated (named slug or recorded as role-addressed),
 * and the served pod's own title. `extras` is null when there is no snapshot
 * at all (or the cache threw), so a caller can tell "nothing known" from
 * "known to have no extras". Never throws.
 *
 * This is the ONE fallback every degraded arm of resolveListeningOnce reads
 * — offline, timeout/error, and the last-ditch catch — and each of them
 * marks the course degraded first, so listeningMetaCache never files a list
 * that came from here as "every slot known" (job #424).
 */
const snapshotListening = async (
  courseCode: string,
): Promise<{ extras: ListeningExtra[] | null; servedTitle: string | null }> => {
  try {
    const cached = await getCachedListeningMeta(courseCode)
    if (!cached) return { extras: null, servedTitle: null }
    const extras = Array.isArray(cached.extraPods) ? cached.extraPods : []
    return {
      extras: extras
        // A named slug, or a topic pod the snapshot recorded as addressed to
        // this reader (rule 5). Anything else in an old snapshot is parked.
        .filter((e) => isExtraSlug(e?.slug) || e?.addressed === true)
        .map((e) => ({
          slug: e.slug,
          title: typeof e.title === 'string' ? e.title : null,
          ...(e.addressed === true ? { addressed: true as const } : {}),
        })),
      servedTitle: cached.podTitle ?? null,
    }
  } catch {
    return { extras: null, servedTitle: null }
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
    extras: ListeningExtra[],
    servedTitle: string | null,
  ): ListeningPod[] => [
    { ...served, title: servedTitle },
    ...extras
      // An extra slot never duplicates the served pod.
      .filter((e) => e.slug !== served.slug)
      .map((e) => ({
        ...servedPod(courseCode, e.slug),
        title: e.title,
        ...(e.addressed ? { addressed: true as const } : {}),
      })),
  ]

  if (isOfflineish()) {
    const snapshot = await snapshotListening(courseCode)
    if (snapshot.extras) {
      degradedListening.add(courseCode)
      return asListening(snapshot.extras, snapshot.servedTitle)
    }
  }

  // One round-trip: the named extra slots plus the served pod's own title
  // (a closed `.in()` on named slugs, core or choice — the per-slug type is
  // re-checked by pickListeningExtras), OR any pod that names a role
  // (rule 5) — that arm carries no slug or pod_type filter on purpose: a
  // topic pod addressed to a person may live on any slug, and RLS, not this
  // query, is what makes it invisible to everyone else. Both arms are
  // re-gated client-side by pickListeningExtras. No visibility filter, on
  // purpose: a held row is absent to the anon client, so it is not here.
  let result:
    | { data: Array<PodRow & { pod_type?: string | null; pod_order?: number | null }> | null; error: unknown }
    | typeof NETWORK_TIMEOUT
  try {
    result = await withNetworkTimeout(
      client
        .from('listening_pods')
        .select('slug, title, pod_type, pod_order, required_role')
        .eq('course_code', courseCode)
        .or(
          `required_role.not.is.null,and(pod_type.in.(core,choice),slug.in.(${[...LISTENING_EXTRA_POD_SLUGS, served.slug].join(',')}))`,
        ),
    )
  } catch {
    result = NETWORK_TIMEOUT
  }

  if (result === NETWORK_TIMEOUT || result.error) {
    // Degrade to what this device last knew, else to the served pod alone —
    // today's behaviour, never fewer pods than main flow serves.
    degradedListening.add(courseCode)
    const snapshot = await snapshotListening(courseCode)
    return asListening(snapshot.extras ?? [], snapshot.servedTitle)
  }

  degradedListening.delete(courseCode)
  const rows = result.data ?? []
  const servedRow = rows.find((r) => r.slug === served.slug)
  const servedTitle = typeof servedRow?.title === 'string' ? servedRow.title : null
  return asListening(pickListeningExtras(rows), servedTitle)
}

/**
 * Every pod Listening Mode lists for this course, served pod FIRST, then the
 * named extra slots the course actually has, then the topic pods addressed to
 * this reader (rules 5 and 6). Memoised per course for
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
