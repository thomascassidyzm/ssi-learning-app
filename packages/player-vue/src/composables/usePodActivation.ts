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
 * Reads `last_completed_round_index` directly from the enrollment — under
 * the position-not-completion model that's the round the learner is ON
 * (the live cursor), kept current by ProgressStore.setLivePosition. Pin =
 * that round. Sentence #1 enters at stage 1 the moment they resume.
 *
 * Returns a number — the activation round to thread into listeningConfig.
 * Falls back to the default (6) on any error path so the player never blocks
 * on this lookup.
 */
export async function resolvePodActivationRound(
  supabase: SupabaseClient | null,
  learnerId: string | null | undefined,
  courseCode: string
): Promise<number> {
  if (!supabase) return DEFAULT_POD_ACTIVATION
  if (!learnerId || isGuestLearner(learnerId)) return DEFAULT_POD_ACTIVATION

  try {
    // Read current pin and exact last completed round in one query
    const { data, error } = await supabase
      .from('course_enrollments')
      .select('pod_activation_round, last_completed_round_index')
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

    const lastCompleted = data?.last_completed_round_index ?? null
    if (lastCompleted == null) {
      // Brand new enrollment, no rounds completed — default activation
      return DEFAULT_POD_ACTIVATION
    }

    // Pin = the round they're on now (the live cursor). If that's at or below
    // the default activation (R6), the default already gives them everything;
    // skip writing the pin so the default path applies.
    const pinRound = lastCompleted
    if (pinRound <= DEFAULT_POD_ACTIVATION) {
      return DEFAULT_POD_ACTIVATION
    }

    const { error: writeError } = await supabase
      .from('course_enrollments')
      .update({ pod_activation_round: pinRound })
      .eq('learner_id', learnerId)
      .eq('course_id', courseCode)
      .is('pod_activation_round', null)

    if (writeError) {
      console.warn('[podActivation] Write error:', writeError.message)
      return DEFAULT_POD_ACTIVATION
    }
    return pinRound
  } catch (err) {
    console.warn('[podActivation] Unexpected:', err)
    return DEFAULT_POD_ACTIVATION
  }
}
