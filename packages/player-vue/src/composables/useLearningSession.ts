/**
 * useLearningSession - Composable for managing learning session lifecycle
 *
 * Handles:
 * - Session initialization and cleanup
 * - Progress tracking via ProgressStore and SessionStore
 * - Course data loading with fallback to demo mode
 * - ROUND-based learning via TripleHelixEngine
 */

import { ref, computed, onMounted, onUnmounted, shallowRef, type Ref } from 'vue'
import type { ProgressStore, SessionStore, ClassifiedBasket } from '@ssi/core'
import {
  createTripleHelixEngine,
  type TripleHelixEngine,
  DEFAULT_CONFIG,
} from '@ssi/core'
import type { CourseDataProvider, LearningItem } from '../providers/CourseDataProvider'

export interface UseLearningSessionOptions {
  progressStore?: ProgressStore
  sessionStore?: SessionStore
  courseDataProvider?: CourseDataProvider
  learnerId?: string
  courseId?: string
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
  const {
    progressStore,
    sessionStore,
    courseDataProvider,
    learnerId = 'demo-learner',
    courseId = 'demo',
    demoItems = [],
  } = options

  // State
  const sessionId = ref<string | null>(null)
  const isLoading = ref(false)
  const error = ref<string | null>(null)
  const items = ref<LearningItem[]>([])
  const itemsPracticed = ref(0)
  const sessionStartTime = ref<Date | null>(null)

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
  const isDemoMode = computed(() => !progressStore || !sessionStore)
  const hasDatabase = computed(() => Boolean(progressStore && sessionStore))
  const hasHelixEngine = computed(() => Boolean(helixEngine.value))

  /**
   * Initialize session on mount
   */
  const initializeSession = async () => {
    isLoading.value = true
    error.value = null
    sessionStartTime.value = new Date()

    try {
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

      // Start session tracking if database is available (skip for guests)
      if (sessionStore && learnerId && courseId && !isGuestLearner(learnerId)) {
        try {
          const session = await sessionStore.startSession(learnerId, courseId)
          sessionId.value = session.id
          console.log('[useLearningSession] Session started:', session.id)
        } catch (err: any) {
          console.warn('[useLearningSession] Session tracking unavailable:', err.message)
          // Continue without session tracking
        }
      } else if (isGuestLearner(learnerId)) {
        console.log('[useLearningSession] Guest mode - session tracking disabled')
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
        courseId
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
      if (courseDataProvider) {
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
  }

  /**
   * End session and save final metrics
   */
  const endSession = async () => {
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
  })

  onUnmounted(() => {
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
    saveMetrics,
    endSession,
    getBasket,
  }
}
