/**
 * useLearningSession - Composable for managing learning session lifecycle
 *
 * Handles:
 * - Session initialization and cleanup
 * - Progress tracking via ProgressStore and SessionStore
 * - Course data loading with fallback to demo mode
 */

import { ref, computed, onMounted, onUnmounted, type Ref } from 'vue'
import type { ProgressStore, SessionStore } from '@ssi/core'
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

  // Computed
  const isDemoMode = computed(() => !progressStore || !sessionStore)
  const hasDatabase = computed(() => Boolean(progressStore && sessionStore))

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
        } else {
          // Fall back to demo items
          console.log('[useLearningSession] No database items, using demo mode')
          items.value = demoItems
        }
      } else {
        // No provider, use demo items
        items.value = demoItems
      }

      // Start session tracking if database is available (skip for demo-learner)
      const isDemoLearner = learnerId === 'demo-learner'
      if (sessionStore && learnerId && courseId && !isDemoLearner) {
        try {
          const session = await sessionStore.startSession(learnerId, courseId)
          sessionId.value = session.id
          console.log('[useLearningSession] Session started:', session.id)
        } catch (err) {
          console.warn('[useLearningSession] Session tracking unavailable:', err.message)
          // Continue without session tracking
        }
      } else if (isDemoLearner) {
        console.log('[useLearningSession] Demo mode - session tracking disabled')
      }

      // Get or create enrollment if database is available (skip for demo-learner)
      if (progressStore && learnerId && courseId && !isDemoLearner) {
        try {
          let enrollment = await progressStore.getEnrollment(learnerId, courseId)
          if (!enrollment) {
            enrollment = await progressStore.createEnrollment(learnerId, courseId)
            console.log('[useLearningSession] Created new enrollment')
          } else {
            console.log('[useLearningSession] Found existing enrollment')
          }
        } catch (err) {
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
   * Record progress for a completed cycle
   */
  const recordCycleComplete = async (item: LearningItem) => {
    itemsPracticed.value++

    // Only track if we have database stores and not demo-learner
    if (!progressStore || !learnerId || !courseId || learnerId === 'demo-learner') {
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
        })
      }

      console.log('[useLearningSession] Progress recorded for LEGO:', item.lego.id)
    } catch (err) {
      console.error('[usLearningSession] Failed to record progress:', err)
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
        started_at: sessionStartTime.value,
        ended_at: endTime,
        items_practiced: itemsPracticed.value,
        spikes_detected: 0, // TODO: Wire up spike detection
        final_rolling_average: 0, // TODO: Wire up metrics
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
    itemsPracticed,

    // Methods
    recordCycleComplete,
    saveMetrics,
    endSession,
  }
}
