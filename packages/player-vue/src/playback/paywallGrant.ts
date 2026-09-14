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
 * write-hold, lowers the wall (access is real; a wall would be a lie) and
 * leaves the player paused; the restore is retried whenever rounds are added.
 *
 * Pure over a tiny engine interface so it can be proved with a fake engine.
 */
import type { PaywallRetreat } from './paywallRetreat'

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

export type GrantAction = 'stay' | 'lower-and-resume' | 'lower-paused'

export function grantAction(input: { held: boolean; restored: boolean; accessNow: boolean }): GrantAction {
  if (!input.accessNow) return 'stay'
  if (input.held && !input.restored) return 'lower-paused'
  return 'lower-and-resume'
}
