/**
 * useLearningSession - Composable for managing learning session lifecycle
 *
 * Handles:
 * - Session initialization and cleanup
 * - Progress tracking via ProgressStore and SessionStore
 * - Course data loading with fallback to demo mode
 * - ROUND-based learning via TripleHelixEngine
 */

import { ref, computed, onMounted, onUnmounted, shallowRef, isRef, type Ref } from 'vue'
import type { ProgressStore, SessionStore, ClassifiedBasket } from '@ssi/core'
import {
  createTripleHelixEngine,
  type TripleHelixEngine,
  DEFAULT_CONFIG,
} from '@ssi/core'
import type { CourseDataProvider, LearningItem } from '../providers/CourseDataProvider'

// Accept either a value or a Ref — read lazily to avoid setup-time null captures
type MaybeRef<T> = T | Ref<T>
function unref<T>(val: MaybeRef<T>): T {
  return isRef(val) ? val.value : val
}

export interface UseLearningSessionOptions {
  progressStore?: MaybeRef<ProgressStore | null | undefined>
  sessionStore?: MaybeRef<SessionStore | null | undefined>
  courseDataProvider?: MaybeRef<CourseDataProvider | null | undefined>
  learnerId?: MaybeRef<string | null | undefined>
  courseId?: MaybeRef<string | null | undefined>
  demoItems?: LearningItem[]
}

export interface LearningSessionState {
  sessionId: Ref<string | null>
  isLoading: Ref<boolean>
  error: Ref<string | null>
  items: Ref<LearningItem[]>
  isDemoMode: Ref<boolean>
}

export interface RoundInfo {
  isInRound: boolean
  legoId: string | null
  phase: string | null
  phaseIndex: number
}

export function useLearningSession(options: UseLearningSessionOptions = {}) {
  const demoItems = options.demoItems ?? []

  // Lazy accessors — these read refs at call time, not setup time
  const getProgressStore = () => unref(options.progressStore) ?? undefined
  const getSessionStore = () => unref(options.sessionStore) ?? undefined
  const getCourseDataProvider = () => unref(options.courseDataProvider) ?? undefined
  const getLearnerId = () => unref(options.learnerId) || 'demo-learner'
  const getCourseId = () => unref(options.courseId) || 'demo'

  // State
  const sessionId = ref<string | null>(null)
  const isLoading = ref(false)
  const error = ref<string | null>(null)
  const items = ref<LearningItem[]>([])
  const itemsPracticed = ref(0)
  const sessionStartTime = ref<Date | null>(null)

  // Actual play time tracking — only counts seconds where audio is playing.
  // Wall-clock duration is useless (idle tabs, backgrounded apps, etc.)
  let playSegmentStart: number | null = null
  const accumulatedPlaySeconds = ref(0)

  /** Call when playback starts or resumes */
  const markPlayStart = () => {
    if (!playSegmentStart) playSegmentStart = Date.now()
  }

  /** Call when playback pauses, stops, or app backgrounds */
  const markPlayStop = () => {
    if (playSegmentStart) {
      accumulatedPlaySeconds.value += Math.floor((Date.now() - playSegmentStart) / 1000)
      playSegmentStart = null
    }
  }

  /** Get current accumulated play seconds (including any in-flight segment) */
  const getPlaySeconds = (): number => {
    let total = accumulatedPlaySeconds.value
    if (playSegmentStart) {
      total += Math.floor((Date.now() - playSegmentStart) / 1000)
    }
    return total
  }

  // TripleHelixEngine for ROUND-based learning
  const helixEngine = shallowRef<TripleHelixEngine | null>(null)
  const baskets = shallowRef<Map<string, ClassifiedBasket>>(new Map())
  const currentRoundInfo = ref<RoundInfo>({
    isInRound: false,
    legoId: null,
    phase: null,
    phaseIndex: 0,
  })

  // Helper to check if learner is a guest (guest IDs start with 'guest-')
  const isGuestLearner = (id: string | undefined) => {
    return !id || id === 'demo-learner' || id.startsWith('guest-')
  }

  // Computed
  const isDemoMode = computed(() => !getProgressStore() || !getSessionStore())
  const hasDatabase = computed(() => Boolean(getProgressStore() && getSessionStore()))
  const hasHelixEngine = computed(() => Boolean(helixEngine.value))

  /**
   * Initialize session on mount
   */
  const initializeSession = async () => {
    isLoading.value = true
    error.value = null
    sessionStartTime.value = new Date()

    try {
      // Read stores lazily — they may not be ready at setup time
      const courseDataProvider = getCourseDataProvider()
      const sessionStore = getSessionStore()
      const progressStore = getProgressStore()
      const learnerId = getLearnerId()
      const courseId = getCourseId()

      // Try to load items from database
      if (courseDataProvider) {
        console.log('[useLearningSession] Loading items from database...')
        const dbItems = await courseDataProvider.loadSessionItems(1, 30)

        if (dbItems.length > 0) {
          items.value = dbItems
          console.log(`[useLearningSession] Loaded ${dbItems.length} items from database`)

          // Initialize TripleHelixEngine with loaded items
          await initializeHelixEngine(dbItems)
        } else {
          // Fall back to demo items
          console.log('[useLearningSession] No database items, using demo mode')
          items.value = demoItems
        }
      } else {
        // No provider, use demo items
        items.value = demoItems
      }

      // Start session tracking only for real learners — Supabase rejects
      // guest IDs (the `guest-` prefix breaks the uuid column constraint),
      // and the failed round-trip costs ~200ms on every cold start.
      if (sessionStore && learnerId && courseId && !isGuestLearner(learnerId)) {
        try {
          const session = await sessionStore.startSession(learnerId, courseId)
          sessionId.value = session.id
          console.log('[useLearningSession] Session started:', session.id)
        } catch (err: any) {
          console.warn('[useLearningSession] Session tracking unavailable:', err.message)
          // Continue without session tracking
        }
      }

      // Get or create enrollment if database is available (skip for guests)
      if (progressStore && learnerId && courseId && !isGuestLearner(learnerId)) {
        try {
          let enrollment = await progressStore.getEnrollment(learnerId, courseId)
          if (!enrollment) {
            enrollment = await progressStore.createEnrollment(learnerId, courseId)
            console.log('[useLearningSession] Created new enrollment')
          } else {
            console.log('[useLearningSession] Found existing enrollment')
          }
        } catch (err: any) {
          console.warn('[useLearningSession] Enrollment tracking unavailable:', err.message)
          // Continue without enrollment tracking
        }
      }
    } catch (err) {
      console.error('[useLearningSession] Session initialization error:', err)
      error.value = err instanceof Error ? err.message : 'Failed to initialize session'
      // Fall back to demo items
      items.value = demoItems
    } finally {
      isLoading.value = false
    }
  }

  /**
   * Initialize TripleHelixEngine with loaded items
   */
  const initializeHelixEngine = async (loadedItems: LearningItem[]) => {
    try {
      // Create engine
      const engine = createTripleHelixEngine(
        DEFAULT_CONFIG.helix,
        DEFAULT_CONFIG.repetition,
        getCourseId()
      )

      // Convert LearningItem[] to SeedPair[] format for the engine
      const seedsMap = new Map<string, any>()
      for (const item of loadedItems) {
        const seedId = item.seed.seed_id
        if (!seedsMap.has(seedId)) {
          seedsMap.set(seedId, {
            seed_id: seedId,
            seed_pair: item.seed.seed_pair,
            legos: [],
            audioRefs: undefined, // Seeds may not have audio
          })
        }
        // Add LEGO to seed
        seedsMap.get(seedId).legos.push({
          id: item.lego.id,
          type: item.lego.type as 'A' | 'M',
          new: item.lego.new,
          lego: item.lego.lego,
          audioRefs: item.lego.audioRefs,
        })
      }

      // Load seeds into engine
      const seeds = Array.from(seedsMap.values())
      engine.loadSeeds(seeds)

      // Load baskets for LEGOs (if provider available)
      if (getCourseDataProvider()) {
        await loadBasketsForItems(loadedItems, engine)
      }

      helixEngine.value = engine
      console.log('[useLearningSession] TripleHelixEngine initialized with', seeds.length, 'seeds')
    } catch (err) {
      console.error('[useLearningSession] Failed to initialize HelixEngine:', err)
      // Continue without engine - will fall back to sequential items
    }
  }

  /**
   * Load baskets for all LEGOs in the session
   */
  const loadBasketsForItems = async (
    loadedItems: LearningItem[],
    engine: TripleHelixEngine
  ) => {
    const courseDataProvider = getCourseDataProvider()
    if (!courseDataProvider) return

    try {
      // Get unique seed IDs
      const seedIds = [...new Set(loadedItems.map(item => item.seed.seed_id))]

      // Load all baskets in parallel (not sequentially!)
      const basketResults = await Promise.all(
        seedIds.map(seedId => courseDataProvider.getLegoBasketsForSeed(seedId))
      )

      // Merge all results
      for (const seedBaskets of basketResults) {
        for (const [legoId, basket] of seedBaskets) {
          baskets.value.set(legoId, basket)
          engine.registerBasket(legoId, basket)
        }
      }

      console.log('[useLearningSession] Loaded baskets for', baskets.value.size, 'LEGOs')
    } catch (err) {
      console.warn('[useLearningSession] Failed to load baskets:', err)
      // Continue without baskets - engine will use simple phrases
    }
  }

  /**
   * Get the next learning item from the engine
   * Falls back to sequential items if engine not available
   */
  const getNextItem = (currentIndex: number): LearningItem | null => {
    // If we have an engine, use it for intelligent selection
    if (helixEngine.value) {
      const engineItem = helixEngine.value.getNextItem()
      if (engineItem) {
        // Update round info
        const activeRound = helixEngine.value.getActiveRound()
        if (activeRound) {
          currentRoundInfo.value = {
            isInRound: true,
            legoId: activeRound.legoId,
            phase: activeRound.roundState.current_phase,
            phaseIndex: activeRound.roundState.phase_index,
          }
        } else {
          currentRoundInfo.value = {
            isInRound: false,
            legoId: null,
            phase: null,
            phaseIndex: 0,
          }
        }

        // Convert engine LearningItem to our LearningItem format
        return {
          lego: {
            id: engineItem.lego.id,
            type: engineItem.lego.type,
            new: engineItem.lego.new,
            lego: engineItem.lego.lego,
            audioRefs: engineItem.lego.audioRefs,
          },
          phrase: {
            id: engineItem.phrase.id,
            phraseType: engineItem.phrase.phraseType,
            phrase: engineItem.phrase.phrase,
            audioRefs: engineItem.phrase.audioRefs,
            wordCount: engineItem.phrase.wordCount,
            containsLegos: engineItem.phrase.containsLegos,
          },
          seed: {
            seed_id: engineItem.seed.seed_id,
            seed_pair: engineItem.seed.seed_pair,
            legos: engineItem.seed.legos.map(l => l.id),
          },
          thread_id: engineItem.thread_id,
          mode: engineItem.mode,
        }
      }
    }

    // Fallback: sequential items
    if (currentIndex < items.value.length) {
      return items.value[currentIndex]
    }

    return null
  }

  /**
   * Record progress for a completed cycle
   */
  const recordCycleComplete = async (item: LearningItem, wasSuccessful: boolean = true, wasSpike: boolean = false) => {
    itemsPracticed.value++

    // Checkpoint to DB on every cycle — lightweight UPDATE, ensures no data loss
    if (sessionId.value) {
      checkpointSession()
    }

    // Record in engine if available
    if (helixEngine.value) {
      helixEngine.value.recordPractice(
        item.lego.id,
        item.thread_id,
        wasSuccessful,
        wasSpike
      )
    }

    // Only track in database if we have stores and not a guest
    const progressStore = getProgressStore()
    const learnerId = getLearnerId()
    const courseId = getCourseId()
    if (!progressStore || !learnerId || !courseId || isGuestLearner(learnerId)) {
      return
    }

    try {
      // Check if we already have progress for this LEGO
      const existingProgress = await progressStore.getLegoProgressById(
        learnerId,
        item.lego.id
      )

      if (existingProgress) {
        // Update existing progress
        await progressStore.updateLegoProgress(existingProgress.id, {
          reps_completed: existingProgress.reps_completed + 1,
          last_practiced_at: new Date(),
        })
      } else {
        // Create new progress record
        await progressStore.saveLegoProgress({
          learner_id: learnerId,
          lego_id: item.lego.id,
          course_id: courseId,
          thread_id: item.thread_id,
          fibonacci_position: 0,
          skip_number: 1,
          reps_completed: 1,
          is_retired: false,
          last_practiced_at: new Date(),
          // ROUND tracking
          introduction_played: false,
          introduction_index: 0,
          introduction_complete: false,
          // Eternal selection
          eternal_urn: [],
          last_eternal_phrase_id: null,
        })
      }

      console.log('[useLearningSession] Progress recorded for LEGO:', item.lego.id)
    } catch (err) {
      console.error('[useLearningSession] Failed to record progress:', err)
      // Don't throw - continue learning even if tracking fails
    }

    // Update enrollment with highest seed
    try {
      const seedNumber = parseInt(item.seed.seed_id.replace(/\D/g, ''), 10)
      if (!isNaN(seedNumber) && seedNumber > 0) {
        await progressStore.updateEnrollmentActivity(
          learnerId,
          courseId,
          seedNumber,
          0  // Don't accumulate minutes per-cycle, do it on session end
        )
      }
    } catch (err) {
      console.warn('[useLearningSession] Failed to update enrollment:', err)
    }
  }

  /**
   * Lightweight checkpoint — updates session row with current progress.
   * Fire-and-forget: must be fast and never block (used in beforeunload, visibilitychange).
   */
  const checkpointSession = () => {
    const sessionStore = getSessionStore()
    if (!sessionStore || !sessionId.value || !sessionStartTime.value) return

    // Use actual play seconds, not wall-clock time
    const durationSeconds = getPlaySeconds()

    // Fire-and-forget — this must be fast and never block
    sessionStore.checkpointSession(
      sessionId.value,
      itemsPracticed.value,
      durationSeconds
    )
  }

  const handleVisibilityChange = () => {
    if (document.visibilityState === 'hidden') {
      markPlayStop()
      checkpointSession()
    }
  }

  const handleBeforeUnload = () => {
    checkpointSession()
  }

  /**
   * End session and save final metrics
   */
  const endSession = async () => {
    const sessionStore = getSessionStore()
    if (!sessionStore || !sessionId.value || !sessionStartTime.value) {
      return
    }

    try {
      const endTime = new Date()
      await sessionStore.endSession(sessionId.value, {
        session_id: sessionId.value,
        started_at: sessionStartTime.value,
        ended_at: endTime,
        items_practiced: itemsPracticed.value,
        spikes_detected: 0, // TODO: Wire up spike detection
        final_rolling_average: 0, // TODO: Wire up metrics
        metrics: [], // TODO: Wire up response metrics
        spikes: [], // TODO: Wire up spike events
      })

      // Update enrollment with accumulated practice minutes (actual play time)
      markPlayStop()
      const progressStore = getProgressStore()
      const learnerId = getLearnerId()
      const courseId = getCourseId()
      if (progressStore && learnerId && courseId && !isGuestLearner(learnerId)) {
        const durationMinutes = Math.floor(getPlaySeconds() / 60)
        if (durationMinutes > 0) {
          try {
            await progressStore.updateEnrollmentActivity(learnerId, courseId, 0, durationMinutes)
          } catch (err) {
            console.warn('[useLearningSession] Failed to update enrollment minutes:', err)
          }
        }
      }

      console.log('[useLearningSession] Session ended:', sessionId.value)
    } catch (err) {
      console.error('[useLearningSession] Failed to end session:', err)
      // Don't throw on cleanup
    }
  }

  /**
   * Save session metrics (called periodically or on specific events)
   */
  const saveMetrics = async (metrics: any[]) => {
    const sessionStore = getSessionStore()
    if (!sessionStore || !sessionId.value) {
      return
    }

    try {
      await sessionStore.saveMetrics(sessionId.value, metrics)
    } catch (err) {
      console.error('[useLearningSession] Failed to save metrics:', err)
    }
  }

  /**
   * Get basket for a specific LEGO
   */
  const getBasket = (legoId: string): ClassifiedBasket | undefined => {
    return baskets.value.get(legoId)
  }

  // Lifecycle hooks
  onMounted(() => {
    initializeSession()

    // Checkpoint when tab becomes hidden (user switches tabs, locks phone, etc.)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    // Last-resort checkpoint on tab close
    window.addEventListener('beforeunload', handleBeforeUnload)
  })

  onUnmounted(() => {
    document.removeEventListener('visibilitychange', handleVisibilityChange)
    window.removeEventListener('beforeunload', handleBeforeUnload)
    endSession()
  })

  return {
    // State
    sessionId,
    isLoading,
    error,
    items,
    isDemoMode,
    hasDatabase,
    hasHelixEngine,
    itemsPracticed,
    currentRoundInfo,

    // Methods
    getNextItem,
    recordCycleComplete,
    checkpointSession,
    saveMetrics,
    endSession,
    getBasket,
    markPlayStart,
    markPlayStop,
  }
}
