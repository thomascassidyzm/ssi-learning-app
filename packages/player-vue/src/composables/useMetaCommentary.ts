/**
 * useMetaCommentary - Vue composable for meta-commentary (welcome, instructions, encouragements)
 *
 * Manages the timing and playback of:
 * - Welcome audio (once at start, can be skipped)
 * - Instructions (meta-cognitive, played in sequence between rounds)
 * - Encouragements (motivational, random selection after instructions complete)
 *
 * Integration points:
 * - Call checkWelcome() at session start
 * - Call onRoundComplete() after each round finishes
 * - Use playCommentary() to play the audio with your audio system
 */

import { ref, shallowRef, computed } from 'vue'
import type { CourseDataProvider } from '../providers/CourseDataProvider'
import {
  MetaCommentaryService,
  createMetaCommentaryService,
  type MetaCommentaryAudio,
} from '../services/MetaCommentaryService'

export interface UseMetaCommentaryOptions {
  courseDataProvider: CourseDataProvider
  learnerId: string
}

export function useMetaCommentary(options: UseMetaCommentaryOptions) {
  const { courseDataProvider, learnerId } = options

  // Service instance (lazy initialized)
  const service = shallowRef<MetaCommentaryService | null>(null)

  // State
  const isInitialized = ref(false)
  const isPlayingCommentary = ref(false)
  const currentCommentary = ref<MetaCommentaryAudio | null>(null)
  const pendingCommentary = ref<MetaCommentaryAudio | null>(null)

  // Progress tracking
  const instructionProgress = computed(() => {
    if (!service.value) return { current: 0, total: 0, complete: false }
    return service.value.getInstructionProgress()
  })

  /**
   * Initialize the service (call once at session start)
   */
  const initialize = async () => {
    if (isInitialized.value) return

    try {
      const svc = createMetaCommentaryService(courseDataProvider, learnerId)
      await svc.initialize()
      service.value = svc
      isInitialized.value = true
      console.debug('[useMetaCommentary] Initialized')
    } catch (err) {
      console.error('[useMetaCommentary] Failed to initialize:', err)
    }
  }

  /**
   * Check if welcome audio should play
   * Call this at session start, before learning begins
   */
  const shouldPlayWelcome = (): boolean => {
    if (!service.value) return false
    return service.value.shouldPlayWelcome()
  }

  /**
   * Get welcome audio if it should be played
   */
  const getWelcomeAudio = (): MetaCommentaryAudio | null => {
    if (!service.value) return null
    return service.value.getWelcomeAudio()
  }

  /**
   * Call after each round completes. Returns commentary audio if the
   * round-cadence rule says it's time, otherwise null.
   *
   * Gating lives in MetaCommentaryService (every Nth round). No cycle
   * accumulation, no performance heuristics — the previous design used
   * those and they were either ignored or perma-stuck.
   *
   * @param roundNumber - The round that just completed (1-based)
   */
  const onRoundComplete = (roundNumber: number): MetaCommentaryAudio | null => {
    if (!service.value) return null

    const commentary = service.value.onRoundComplete(roundNumber)

    if (commentary) {
      pendingCommentary.value = commentary
      console.debug('[useMetaCommentary] Commentary ready:', commentary.type, commentary.text?.substring(0, 50))
    }

    return commentary
  }

  /**
   * Start playing commentary audio
   * Sets isPlayingCommentary to true while playing
   */
  const startCommentaryPlayback = () => {
    if (pendingCommentary.value) {
      currentCommentary.value = pendingCommentary.value
      pendingCommentary.value = null
      isPlayingCommentary.value = true
    }
  }

  /**
   * Mark commentary playback as complete
   */
  const finishCommentaryPlayback = () => {
    currentCommentary.value = null
    isPlayingCommentary.value = false
  }

  /**
   * Force next commentary (for testing)
   */
  const forceNextCommentary = (): MetaCommentaryAudio | null => {
    if (!service.value) return null
    const commentary = service.value.forceNextCommentary()
    if (commentary) {
      pendingCommentary.value = commentary
    }
    return commentary
  }

  /**
   * Reset ALL state including global (use with caution!)
   * This resets instruction progress across all courses
   */
  const resetAll = () => {
    if (service.value) {
      service.value.resetAll()
    }
    pendingCommentary.value = null
    currentCommentary.value = null
    isPlayingCommentary.value = false
  }

  return {
    // State
    isInitialized,
    isPlayingCommentary,
    currentCommentary,
    pendingCommentary,
    instructionProgress,

    // Methods
    initialize,
    shouldPlayWelcome,
    getWelcomeAudio,
    onRoundComplete,
    startCommentaryPlayback,
    finishCommentaryPlayback,
    forceNextCommentary,
    resetAll,
  }
}
