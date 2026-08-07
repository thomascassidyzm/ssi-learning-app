/**
 * The new-learner mode default (Aran's ruling via Tom, 2026-08-06).
 *
 * A learner with NO play history starts on EASY. A learner who is already
 * playing keeps TODAY'S behaviour — FAST — so nobody's course silently slows
 * down underneath them mid-flight. That asymmetry is the entire rule, and it
 * is why the module-level default stays 'fast': every pre-existing learner,
 * and every code path that reads the mode before progress has resolved, must
 * land on the unchanged experience.
 *
 * Extracted as a pure function purely so it can be tested — the caller in
 * LearningPlayer.vue owns the refs and the persistence, this owns the
 * decision. Tom has flagged the default itself as his to overturn.
 */
import type { LearningMode } from './useAlgorithmConfig'

/** The mode a learner with no history gets handed. */
export const NEW_LEARNER_DEFAULT_MODE: LearningMode = 'easy'

/** The mode everyone else stays on — today's behaviour, unchanged. */
export const EXISTING_LEARNER_MODE: LearningMode = 'fast'

export interface NewLearnerModeInput {
  /** Has the saved-progress read RESOLVED? Before it has, "no history" and
   *  "not loaded yet" are both empty, and acting on the second would put an
   *  existing learner on Easy — exactly what the ruling forbids. */
  progressResolved: boolean
  /** Has the learner ever picked a mode themselves (learner row or device)? */
  hasChosenMode: boolean
  /** Any trace of prior play. */
  highestCompletedLegoId?: string | null
  lastCompletedLegoId?: string | null
  highestCompletedRoundIndex?: number | null
  completedRounds?: number
}

/** True when this learner shows any evidence of having played before. */
export function hasPlayHistory(input: NewLearnerModeInput): boolean {
  return !!(
    input.highestCompletedLegoId ||
    input.lastCompletedLegoId ||
    (input.highestCompletedRoundIndex ?? null) !== null ||
    (input.completedRounds ?? 0) > 0
  )
}

/**
 * The mode to apply, or `null` for "leave whatever is already set alone".
 *
 * Returns null — not 'fast' — for the leave-alone cases, so the caller never
 * writes a mode it did not decide. Overwriting with 'fast' would clobber a
 * learner whose choice is still in flight from the learner row.
 */
export function resolveNewLearnerMode(input: NewLearnerModeInput): LearningMode | null {
  if (!input.progressResolved) return null   // not loaded yet — decide nothing
  if (input.hasChosenMode) return null       // an explicit choice outranks any default, forever
  if (hasPlayHistory(input)) return null     // existing learner — today's behaviour, untouched
  return NEW_LEARNER_DEFAULT_MODE
}
