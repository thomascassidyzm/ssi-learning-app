/**
 * paywallLanding — where the cursor goes when the paywall closes.
 *
 * Tom, staging 2026-09-14 21:33Z (job #734): a teacher on a trial school
 * reached the end of Yellow on cym_n_for_eng, the wall came up, and dismissing
 * it "reset my position to the beginning of the course". Both rewind sites in
 * LearningPlayer (`dismissPaywall` and the post-init resume gate) called
 * `jumpToRound(0)` — the wall itself was the mechanism that threw away the
 * learner's place.
 *
 * The rule now: hitting the wall NEVER moves the cursor backwards further than
 * it has to. If the round the learner is on is still inside the free preview,
 * they stay exactly there (the belt-skip and lego-skip gates already refuse to
 * move the cursor, so this is the common case). Only when the cursor has
 * already crossed into locked territory — `advanceRound` bumps roundIndex even
 * when the boundary listener pauses, and a saved position can resolve past
 * the wall on a cold load — does it retreat, and then only to the LAST round
 * the learner may play, never to round 0.
 *
 * Pure so it can be proved in isolation; the .vue wiring is asserted by the
 * companion test reading the source.
 */

export interface LandingRound {
  legoId?: string | null
  seedId?: string | null
}

/** Seed number of a round, from its seedId ('S0020') or legoId ('S0020L01'). */
export function seedNumberOfRound(round: LandingRound | null | undefined): number | null {
  const id = round?.seedId || round?.legoId
  if (!id || id.length < 5 || id[0] !== 'S') return null
  const n = parseInt(id.substring(1, 5), 10)
  return Number.isFinite(n) ? n : null
}

/**
 * The round index to land on after the wall.
 *
 * @returns null when the current round is playable (stay put — do not touch
 *   the cursor); otherwise the highest index at or below `currentIndex` whose
 *   seed `canAccessSeed` allows. Falls back to 0 only when nothing at all is
 *   accessible, which the seed-1 preview makes unreachable in practice.
 */
export function paywallLandingRound(
  currentIndex: number,
  rounds: ReadonlyArray<LandingRound | null | undefined>,
  canAccessSeed: (seedNumber: number) => boolean,
): number | null {
  if (!Number.isInteger(currentIndex) || currentIndex < 0 || currentIndex >= rounds.length) return null
  const accessible = (i: number): boolean => {
    const seed = seedNumberOfRound(rounds[i])
    // A round with no readable seed cannot be judged; treat it as playable so
    // an unusual queue entry never becomes a rewind.
    return seed === null ? true : canAccessSeed(seed)
  }
  if (accessible(currentIndex)) return null
  for (let i = currentIndex - 1; i >= 0; i--) {
    if (accessible(i)) return i
  }
  return 0
}
