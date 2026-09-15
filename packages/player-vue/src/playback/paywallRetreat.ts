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
  /** If the held position is now playable, return where to jump: the round
   *  that carries the held LEGO in the LIVE queue (`findRoundIndex`), never
   *  the index the queue had when it retreated — the bootstrap queue is a
   *  window whose round 0 is the resume LEGO, and the full-script handoff
   *  swaps it for the whole course, where index 0 is the first LEGO of the
   *  course (staging probe, job #745). Still held after this call: the
   *  restoring jump's own round-advance write must not run; `clear` happens
   *  when play actually resumes. Null when nothing is held, when it is still
   *  locked, or when the live queue does not carry the LEGO (stay put). */
  takeRestore(
    canAccessSeed: (seed: number) => boolean,
    findRoundIndex: (legoId: string) => number,
  ): RememberedPosition | null
  /** Spend the memory when the learner is actually PLAYING the remembered
   *  round with the wall down (`currentLegoId` is the held LEGO), or when the
   *  memory carries no LEGO to compare. A prompt on some OTHER round — playing
   *  on inside the preview after "Maybe later" — leaves it held: the real
   *  place is still the held one and the stored cursors must stay on it
   *  (job #752: an unentitled learner's saved S0031L01 must survive a session
   *  of replaying the preview, so a later subscription resumes there). */
  release(currentLegoId: string | null | undefined): void
  clear(): void
  /** The subscription answer is still in flight, so the gate has not judged
   *  the landed position yet: block every cursor write until it does. Cold
   *  verify of job #757: positionInitialized fires before /api/subscription
   *  answers; an unentitled learner bootstrapped onto the preview's last
   *  round who backgrounded the app in that window had the dormant save
   *  write S0019L01 over S0031L01 in localStorage and the DB — the hold
   *  only existed once the gate ran, and the gate was waiting. Bounded by
   *  the same 8s useSubscription bounds hydration (job #761). */
  awaitVerdict(): void
  /** The answer landed (or the bound expired): the gate runs next and holds
   *  the real spot itself if it must. Neither `release` nor `clear` ends a
   *  pending verdict — only the answer does. */
  verdictReached(): void
}

export function createPaywallRetreat(): PaywallRetreat {
  let held: RememberedPosition | null = null
  let verdictPending = false
  return {
    remember(pos) {
      if (held) return
      if (!Number.isInteger(pos.roundIndex) || pos.roundIndex < 0) return
      held = { roundIndex: pos.roundIndex, cycleIndex: Math.max(0, pos.cycleIndex | 0), legoId: pos.legoId ?? null }
    },
    blocksPersist() { return verdictPending || held !== null },
    current() { return held },
    takeRestore(canAccessSeed, findRoundIndex) {
      if (!held) return null
      const seed = seedNumberOfRound({ legoId: held.legoId })
      if (seed !== null && !canAccessSeed(seed)) return null
      if (!held.legoId) return held
      const live = findRoundIndex(held.legoId)
      if (!Number.isInteger(live) || live < 0) return null
      return { ...held, roundIndex: live }
    },
    release(currentLegoId) {
      if (!held) return
      if (!held.legoId || held.legoId === (currentLegoId ?? null)) held = null
    },
    clear() { held = null },
    awaitVerdict() { verdictPending = true },
    verdictReached() { verdictPending = false },
  }
}
