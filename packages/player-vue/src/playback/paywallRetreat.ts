/**
 * paywallRetreat — the learner's REAL position, held while a wall stands.
 *
 * Follow-up to job #734. The wall no longer rewinds to round 0, but when it
 * retreats the cursor to the last free round it must not FORGET where the
 * learner really was (Tom, 2026-09-14: a paywall never moves a learner's belt
 * or position back). The retreat in the post-init resume gate was followed, on
 * the same tick, by the lifecycle saves — so the RETREATED cursor overwrote the
 * real one in localStorage (the DB write is forward-only by round and refused
 * it, but localStorage is what resume reads first). When the entitlement
 * refresh then granted access — a class created after sign-in, a subscription
 * bought elsewhere — playback resumed at the retreated round: place lost.
 *
 * The memory has three moments, and nothing else touches it:
 *  1. `remember` — the wall is about to retreat the cursor: keep the real spot.
 *  2. `blocksPersist` — while set, no position write happens at all, so the
 *     stored cursors stay on the real spot.
 *  3. `takeRestore` — a fresh entitlement snapshot arrives: if it lets the
 *     learner play the remembered seed, hand back the spot to jump to.
 * It is cleared by `clear`, which the player calls from the one signal that
 * means "the learner is playing on from here": a cycle's prompt starting with
 * the wall down. Until then a dismissed wall leaves the stored cursors exactly
 * as they were, so closing the app after "Maybe later" loses nothing either.
 *
 * Pure so it can be proved in isolation; the .vue wiring is asserted by the
 * companion test reading the source.
 */
import { seedNumberOfRound } from './paywallLanding'

export interface RememberedPosition {
  roundIndex: number
  cycleIndex: number
  legoId: string | null
}

export interface PaywallRetreat {
  /** Keep the real position. A second call while one is held is ignored: the
   *  FIRST retreat is from the real spot, any later one is from the landing. */
  remember(pos: RememberedPosition): void
  /** True while a real position is held — every position write must skip. */
  blocksPersist(): boolean
  /** The held position, or null. */
  current(): RememberedPosition | null
  /** If the held position is now playable, return it (still held — the
   *  restoring jump's own round-advance write must not run; `clear` happens
   *  when play actually resumes). Null when nothing is held or it is still
   *  locked. */
  takeRestore(canAccessSeed: (seed: number) => boolean): RememberedPosition | null
  clear(): void
}

export function createPaywallRetreat(): PaywallRetreat {
  let held: RememberedPosition | null = null
  return {
    remember(pos) {
      if (held) return
      if (!Number.isInteger(pos.roundIndex) || pos.roundIndex < 0) return
      held = { roundIndex: pos.roundIndex, cycleIndex: Math.max(0, pos.cycleIndex | 0), legoId: pos.legoId ?? null }
    },
    blocksPersist() { return held !== null },
    current() { return held },
    takeRestore(canAccessSeed) {
      if (!held) return null
      const seed = seedNumberOfRound({ legoId: held.legoId })
      if (seed !== null && !canAccessSeed(seed)) return null
      return held
    },
    clear() { held = null },
  }
}
