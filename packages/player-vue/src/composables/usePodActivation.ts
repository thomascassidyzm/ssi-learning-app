/**
 * usePodActivation — per-learner pin for Listening Pods activation round.
 *
 * The Layer 2 pod scheduler keys off `podActivationRound`. Default is R6.
 * For users who already had progress when pods were switched on, R6 is wrong:
 * they'd skip straight to stage-7 eternal hold for sentences they've never
 * been introduced to.
 *
 * This composable pins the activation to the learner's current round on the
 * first session after pods become visible. Once written, the value is stable
 * and the pod sequence progresses normally from that round forward.
 *
 * Behaviour:
 *   - Guests / no-enrollment / new users (current round ≤ 6) → default 6
 *   - Returning users (current round > 6, NULL pin) → write & return current round
 *   - Returning users (current round > 6, pin already set) → return stored pin
 *
 * The write uses an `IS NULL` predicate so re-runs are idempotent and the
 * value never shifts after the first capture.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

const DEFAULT_POD_ACTIVATION = 6

const isGuestLearner = (id: string | undefined | null): boolean => {
  return !id || id === 'demo-learner' || id.startsWith('guest-')
}

/**
 * Resolve the pod activation round for this learner+course, writing the pin
 * back to course_enrollments if it was NULL and the learner is past R6.
 *
 * Returns a number — the activation round to thread into listeningConfig.
 * Falls back to the default (6) on any error path so the player never blocks
 * on this lookup.
 */
export async function resolvePodActivationRound(
  supabase: SupabaseClient | null,
  learnerId: string | null | undefined,
  courseCode: string,
  currentRound: number
): Promise<number> {
  if (!supabase) return DEFAULT_POD_ACTIVATION
  if (!learnerId || isGuestLearner(learnerId)) return DEFAULT_POD_ACTIVATION

  try {
    // Read current pin
    const { data, error } = await supabase
      .from('course_enrollments')
      .select('pod_activation_round')
      .eq('learner_id', learnerId)
      .eq('course_id', courseCode)
      .maybeSingle()

    if (error) {
      console.warn('[podActivation] Read error:', error.message)
      return DEFAULT_POD_ACTIVATION
    }

    if (data?.pod_activation_round != null) {
      // Already pinned — use stored value
      return data.pod_activation_round
    }

    // No pin yet. If learner is past R6, capture their current round.
    if (currentRound > DEFAULT_POD_ACTIVATION) {
      const { error: writeError } = await supabase
        .from('course_enrollments')
        .update({ pod_activation_round: currentRound })
        .eq('learner_id', learnerId)
        .eq('course_id', courseCode)
        .is('pod_activation_round', null)

      if (writeError) {
        console.warn('[podActivation] Write error:', writeError.message)
        return DEFAULT_POD_ACTIVATION
      }
      return currentRound
    }

    // Learner at or below R6 — default activation is correct
    return DEFAULT_POD_ACTIVATION
  } catch (err) {
    console.warn('[podActivation] Unexpected:', err)
    return DEFAULT_POD_ACTIVATION
  }
}
