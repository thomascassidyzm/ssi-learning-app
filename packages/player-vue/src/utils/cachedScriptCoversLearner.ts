import { resolveResumeAnchor, seedOfLegoId } from './resolveResumeAnchor'

/**
 * Does a cached script hold the learner's place?
 *
 * The cache fast-path hydrates the player from whatever script this device
 * last wrote. On a bundle-booted premium course that script can be the free
 * PREVIEW slice — 33 rounds through Yellow on cym_s_for_eng — written while
 * the device was a guest, was unentitled, or fetched the bundle before its
 * session restored. The bundle itself heals when entitlement arrives
 * (useCourseBundle.revalidateCachedBundles); the script cache never did, so a
 * learner whose cursor sat past Yellow was resolved against 33 rounds, found
 * nowhere, and started at round 1 with a console warning as the only trace
 * (job #326, 2026-09-12: ieuan422 on production, cursor S0215L01, every cold
 * start landing on S0001L01).
 *
 * A cached script that cannot place a learner who HAS a place is not this
 * learner's course view. Returns false in exactly that case, and the caller
 * must not hydrate from it: the bootstrap path resolves against the live
 * bundle's round map instead, and the full-script handoff rewrites the cache.
 *
 * Same lookup as the fast-path itself (cursor, then the cursor's seed, then
 * the ceiling), so "covers" and "resumes at" are one fact.
 */
export function cachedScriptCoversLearner(
  rounds: ReadonlyArray<{ legoId?: string | null } | null | undefined>,
  cursorLegoId: string | null,
  ceilingLegoId: string | null,
): boolean {
  // No server position at all — a fresh learner, whom any script places at
  // round 1 correctly.
  if (!cursorLegoId && !ceilingLegoId) return true
  const findIndex = (legoId: string) => rounds.findIndex((r) => r?.legoId === legoId)
  const firstLegoOfSeed = (seed: number) =>
    rounds.find((r) => seedOfLegoId(r?.legoId ?? null) === seed)?.legoId ?? null
  return resolveResumeAnchor(cursorLegoId, ceilingLegoId, findIndex, firstLegoOfSeed).legoId !== null
}
