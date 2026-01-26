/**
 * useCompletedContent - Helper composable for consuming completed session data
 *
 * Wraps SessionController's completed content data for easy consumption by
 * BrainView and Listening components.
 *
 * Usage:
 * ```typescript
 * const completedContent = computed(() =>
 *   props.sessionController
 *     ? useCompletedContent(props.sessionController)
 *     : null
 * )
 * ```
 */

import { computed, type ComputedRef } from 'vue'
import type { SessionController } from '../playback/SessionController'
import type { RoundTemplate } from '../playback/types'

export interface CompletedContent {
  /** All completed rounds (rounds before current) */
  completedRounds: ComputedRef<RoundTemplate[]>
  /** Set of LEGO IDs from completed rounds */
  completedLegoIds: ComputedRef<Set<string>>
  /** Number of completed rounds */
  completedCount: ComputedRef<number>
}

/**
 * Create a CompletedContent wrapper from a SessionController
 *
 * @param sessionController - The session controller to wrap
 * @returns CompletedContent with reactive computed properties
 */
export function useCompletedContent(
  sessionController: SessionController
): CompletedContent {
  return {
    completedRounds: computed(() => sessionController.completedRounds.value),
    completedLegoIds: computed(() => sessionController.completedLegoIds.value),
    completedCount: computed(() => sessionController.completedRounds.value.length),
  }
}
