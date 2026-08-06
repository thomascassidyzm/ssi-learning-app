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

import { ref, shallowRef, computed, inject } from 'vue'
import type { CourseDataProvider } from '../providers/CourseDataProvider'
import {
  MetaCommentaryService,
  createMetaCommentaryService,
  type MetaCommentaryAudio,
  type EncouragementTaperConfig,
} from '../services/MetaCommentaryService'

export interface UseMetaCommentaryOptions {
  courseDataProvider: CourseDataProvider
  learnerId: string
}

export function useMetaCommentary(options: UseMetaCommentaryOptions) {
  const { courseDataProvider, learnerId } = options

  // Supabase client for cross-device persistence of instruction progress.
  // Captured at setup (inject must run here, not inside async initialize);
  // App.vue provides either the raw client or a ref — resolve .value lazily.
  const injectedSupabase = inject<any>('supabase', null)

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
      const supabaseClient = injectedSupabase && typeof injectedSupabase === 'object' && 'value' in injectedSupabase
        ? injectedSupabase.value
        : injectedSupabase
      const svc = createMetaCommentaryService(courseDataProvider, learnerId, supabaseClient)
      await svc.initialize()
      // Dev cheat: ?forceEncouragements=1 (or ?fc=1) fires an interjection on
      // every eligible boundary, bypassing the ~10-min interval — so the
      // interjection display can be tested without the wait. Instructions still
      // come first (in order), then encouragements.
      try {
        const p = new URLSearchParams(window.location.search)
        if (p.has('forceEncouragements') || p.has('fc')) {
          svc.forceFire = true
          console.debug('[useMetaCommentary] forceFire ON (dev cheat) — interjection on every speaking boundary')
          // ?fc=enc → jump straight to encouragement icons (skip the ~30
          // instructions), session-only / not persisted.
          if (p.get('fc') === 'enc' || p.has('enc')) {
            svc.forceEncouragementsOnly = true
            console.debug('[useMetaCommentary] forceEncouragementsOnly ON (dev cheat) — skipping instructions, session-only')
          }
        }
      } catch { /* no window / no search params */ }
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
   * Call after each round completes. Returns commentary audio if it's time
   * (variable ~10-min interval of active play) AND `canFire` is true,
   * otherwise null. Timing/gating lives in MetaCommentaryService; this just
   * passes through the round's cycle count (active-time signal) and whether
   * this boundary is a legal drop point (between two speaking rounds).
   *
   * @param roundNumber - The round that just completed (1-based)
   * @param cyclesInRound - Cycles in that round (active-time accumulator)
   * @param canFire - True iff the boundary is between two speaking rounds
   */
  const onRoundComplete = (
    roundNumber: number,
    cyclesInRound = 0,
    canFire = true,
  ): MetaCommentaryAudio | null => {
    if (!service.value) return null

    const commentary = service.value.onRoundComplete(roundNumber, cyclesInRound, canFire)

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

  /** Re-key the service when learner identity resolves/changes after setup
   *  (guest → signed-in, play-as-class). See MetaCommentaryService.setLearnerId. */
  const setLearnerId = (id: string | null | undefined) => {
    if (id) service.value?.setLearnerId(id)
  }

  /** Push live taper config (algorithm_config 'meta_commentary'). */
  const setEncouragementTaper = (cfg: Partial<EncouragementTaperConfig> | null | undefined) => {
    service.value?.setEncouragementTaper(cfg)
  }

  /** Push the learner's cumulative learning minutes across ALL courses —
   *  the encouragement-taper signal. null = unknown ⇒ treated as beginner. */
  const setCumulativeLearningMinutes = (minutes: number | null | undefined) => {
    service.value?.setCumulativeLearningMinutes(minutes)
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
    setLearnerId,
    setEncouragementTaper,
    setCumulativeLearningMinutes,
    startCommentaryPlayback,
    finishCommentaryPlayback,
    forceNextCommentary,
    resetAll,
  }
}
