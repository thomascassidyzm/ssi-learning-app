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
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { isOfflineish, withNetworkTimeout, NETWORK_TIMEOUT } from '../config/networkGate'
import { getCachedListeningMeta } from './listeningMetaCache'

/** The only slugs a learner path may ever read, in preference order. */
export const SERVING_POD_SLUGS = ['pod-1', 'pod-0'] as const

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

export interface PodRow {
  slug: string
  /** `listening_pods.required_role` — NULL/absent means "everyone". */
  required_role?: string | null
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

/** Drop the memo — tests, and any future content-version reset. */
export const resetServedPodCache = (): void => {
  inFlight.clear()
}
