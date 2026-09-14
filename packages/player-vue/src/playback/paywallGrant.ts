/**
 * paywallGrant — what a fresh entitlement snapshot may do with the wall.
 *
 * Job #752 addition, from a cold verify of #745: the grant watcher used to try
 * the restore and then, whether or not it had worked, lower the wall and
 * resume. When the remembered LEGO was not yet in the engine queue (lazy load
 * not reached it, or the queue still the preview window) or the jump threw,
 * playback resumed at the RETREATED position — and the next prompt spent the
 * memory and persisted the retreat. The real place was lost on the failure
 * path.
 *
 * The rule now: automatic resume only after a restore that verifiably landed
 * the engine on the held LEGO. A failed restore keeps the memory and the
 * write-hold and lowers the wall (access is real; a wall would be a lie).
 *
 * Job #757 (the #752 follow-up): a failed restore is not the end of it. The
 * held LEGO is missing because the queue the player bootstrapped from is the
 * PREVIEW the server issued before the grant, and no amount of waiting brings
 * a locked LEGO into a preview queue — the learner sat paused with the wall
 * down for as long as the tab lived, at the exact moment they had just paid
 * or redeemed. So the grant RECOVERS: re-fetch the script under the granted
 * entitlement (the server gate honours entitlements per request), let the
 * caller swap the queue, then restore again. Only a restore that verifiably
 * lands resumes play; anything else keeps the memory and the write-hold, and
 * the round-count retry stays as the net.
 *
 * Pure over a tiny engine interface so it can be proved with a fake engine.
 */
import type { PaywallRetreat } from './paywallRetreat'
import { seedNumberOfRound } from './paywallLanding'

export interface RestoreEngine {
  getEngineRounds(): ReadonlyArray<{ legoId?: string | null } | null | undefined>
  jumpToRound(roundIndex: number, cycleIndex?: number): void
  /** The LEGO the engine is on right now, read from the engine itself. */
  currentLegoId(): string | null
}

/**
 * Try to put the engine back on the held real place. True ONLY when the engine
 * is verifiably on it afterwards. Never spends the memory: that happens when a
 * prompt plays on the remembered round (`release`).
 */
export function restoreHeldPosition(
  memory: PaywallRetreat,
  engine: RestoreEngine,
  canAccessSeed: (seed: number) => boolean,
): boolean {
  const restore = memory.takeRestore(
    canAccessSeed,
    (legoId) => engine.getEngineRounds().findIndex((r) => r?.legoId === legoId),
  )
  if (!restore) return false
  try {
    engine.jumpToRound(restore.roundIndex, restore.cycleIndex)
  } catch {
    return false
  }
  if (!restore.legoId) return true
  return engine.currentLegoId() === restore.legoId
}

/**
 * Put the engine back on the held real place, re-fetching the script under the
 * granted entitlement when the live queue does not carry it. `refetchScript`
 * is the caller's swap: fetch past every cache and merge the rounds into the
 * engine. True ONLY when the engine is verifiably on the held LEGO afterwards.
 * A refetch that throws, or that still does not bring the LEGO, is a false —
 * the memory and the write-hold stay, nothing is resumed at the retreat.
 */
export async function recoverHeldPosition(
  memory: PaywallRetreat,
  engine: RestoreEngine,
  canAccessSeed: (seed: number) => boolean,
  refetchScript: () => Promise<unknown>,
): Promise<boolean> {
  if (restoreHeldPosition(memory, engine, canAccessSeed)) return true
  const held = memory.current()
  if (!held) return false
  // Still locked: a refetch would only hand back the same preview.
  const seed = seedNumberOfRound({ legoId: held.legoId })
  if (seed !== null && !canAccessSeed(seed)) return false
  try {
    await refetchScript()
  } catch {
    return false
  }
  return restoreHeldPosition(memory, engine, canAccessSeed)
}

export type GrantAction = 'stay' | 'lower-and-resume' | 'lower-and-recover'

/**
 * `lower-and-recover`: access is real so the wall comes down, but the held
 * place is not in the live queue — recover it (refetch, swap, restore) and
 * resume only once it lands. Never "lower and sit paused" (job #757).
 */
export function grantAction(input: { held: boolean; restored: boolean; accessNow: boolean }): GrantAction {
  if (!input.accessNow) return 'stay'
  if (input.held && !input.restored) return 'lower-and-recover'
  return 'lower-and-resume'
}
