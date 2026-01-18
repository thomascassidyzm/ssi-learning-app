/**
 * useBeltProgress - Belt progression system with localStorage + Supabase sync
 *
 * Tracks:
 * - completedSeeds per course (persisted locally + synced to Supabase)
 * - Session history for learning rate calculation
 * - Rolling average for time-to-next-belt estimates
 *
 * Sync Strategy:
 * - localStorage is primary (instant, works offline)
 * - Supabase is background sync (cross-device)
 * - On load: merge local + remote, take highest
 * - Progress never goes backward (max wins)
 *
 * Belt System (from APML):
 * - 8 belts: White → Yellow → Orange → Green → Blue → Purple → Brown → Black
 * - Thresholds: 0, 8, 20, 40, 80, 150, 280, 400 seeds
 */

import { ref, computed, watch, type Ref } from 'vue'
import type { SupabaseClient } from '@supabase/supabase-js'

// ============================================================================
// BELT CONFIGURATION (from APML)
// ============================================================================

export interface Belt {
  name: string
  seedsRequired: number
  color: string
  colorDark: string
  glow: string
  index: number
}

export const BELTS: Omit<Belt, 'index'>[] = [
  { name: 'white',  seedsRequired: 0,   color: '#f5f5f5', colorDark: '#e0e0e0', glow: 'rgba(245, 245, 245, 0.3)' },
  { name: 'yellow', seedsRequired: 8,   color: '#fcd34d', colorDark: '#f59e0b', glow: 'rgba(252, 211, 77, 0.4)' },
  { name: 'orange', seedsRequired: 20,  color: '#fb923c', colorDark: '#ea580c', glow: 'rgba(251, 146, 60, 0.4)' },
  { name: 'green',  seedsRequired: 40,  color: '#4ade80', colorDark: '#16a34a', glow: 'rgba(74, 222, 128, 0.4)' },
  { name: 'blue',   seedsRequired: 80,  color: '#60a5fa', colorDark: '#2563eb', glow: 'rgba(96, 165, 250, 0.4)' },
  { name: 'purple', seedsRequired: 150, color: '#a78bfa', colorDark: '#7c3aed', glow: 'rgba(167, 139, 250, 0.4)' },
  { name: 'brown',  seedsRequired: 280, color: '#a8856c', colorDark: '#78350f', glow: 'rgba(168, 133, 108, 0.4)' },
  { name: 'black',  seedsRequired: 400, color: '#1f1f1f', colorDark: '#0a0a0a', glow: 'rgba(255, 255, 255, 0.15)' },
]

export const TOTAL_SEEDS = 668 // Total seeds in a typical course

// ============================================================================
// STORAGE KEYS & VERSION
// ============================================================================

const PROGRESS_KEY_PREFIX = 'ssi_belt_progress_'
const SESSION_HISTORY_KEY_PREFIX = 'ssi_session_history_'

// Note: Cache invalidation (position, scripts) is handled by App.vue using BUILD_VERSION
// Belt PROGRESS (completedSeeds) persists across builds - it's real user progress

// ============================================================================
// TYPES
// ============================================================================

interface StoredProgress {
  completedSeeds: number
  lastUpdated: number
}

interface SessionRecord {
  timestamp: number
  seedsLearned: number
  durationMs: number
}

interface StoredSessionHistory {
  sessions: SessionRecord[]
}

// ============================================================================
// SUPABASE SYNC CONFIG
// ============================================================================

export interface BeltProgressSyncConfig {
  /** Supabase client for remote sync */
  supabase?: Ref<SupabaseClient | null> | SupabaseClient | null
  /** Learner ID for remote sync */
  learnerId?: Ref<string | null> | string | null
}

// ============================================================================
// COMPOSABLE
// ============================================================================

export function useBeltProgress(courseCode: string, syncConfig?: BeltProgressSyncConfig) {
  // Core state
  const completedSeeds = ref(0)
  const sessionHistory = ref<SessionRecord[]>([])
  const isLoaded = ref(false)
  const isSyncing = ref(false)
  const lastSyncError = ref<string | null>(null)

  // Current session tracking
  const sessionStartTime = ref<number | null>(null)
  const sessionStartSeeds = ref(0)

  // ============================================================================
  // SYNC HELPERS
  // ============================================================================

  /**
   * Get Supabase client from config (handles both ref and direct value)
   */
  const getSupabase = (): SupabaseClient | null => {
    if (!syncConfig?.supabase) return null
    return 'value' in syncConfig.supabase
      ? syncConfig.supabase.value
      : syncConfig.supabase
  }

  /**
   * Get learner ID from config (handles both ref and direct value)
   */
  const getLearnerId = (): string | null => {
    if (!syncConfig?.learnerId) return null
    return 'value' in syncConfig.learnerId
      ? syncConfig.learnerId.value
      : syncConfig.learnerId
  }

  /**
   * Check if sync is available
   */
  const canSync = (): boolean => {
    const supabase = getSupabase()
    const learnerId = getLearnerId()
    return !!(supabase && learnerId && !learnerId.startsWith('guest-'))
  }

  // ============================================================================
  // SUPABASE SYNC
  // ============================================================================

  /**
   * Fetch highest_completed_seed from Supabase
   * Returns null if not found or error
   */
  const fetchRemoteProgress = async (): Promise<number | null> => {
    const supabase = getSupabase()
    const learnerId = getLearnerId()

    if (!supabase || !learnerId) return null

    try {
      const { data, error } = await supabase
        .from('course_enrollments')
        .select('highest_completed_seed')
        .eq('learner_id', learnerId)
        .eq('course_id', courseCode)
        .maybeSingle()

      if (error) {
        console.warn('[BeltProgress] Remote fetch error:', error.message)
        return null
      }

      return data?.highest_completed_seed ?? null
    } catch (err) {
      console.warn('[BeltProgress] Remote fetch failed:', err)
      return null
    }
  }

  /**
   * Sync progress to Supabase (background, non-blocking)
   * Updates highest_completed_seed if local value is higher
   */
  const syncToRemote = async (seeds: number): Promise<void> => {
    if (!canSync()) return

    const supabase = getSupabase()
    const learnerId = getLearnerId()

    if (!supabase || !learnerId) return

    isSyncing.value = true
    lastSyncError.value = null

    try {
      // Upsert: create enrollment if doesn't exist, update if it does
      const { error } = await supabase
        .from('course_enrollments')
        .upsert({
          learner_id: learnerId,
          course_id: courseCode,
          highest_completed_seed: seeds,
          last_practiced_at: new Date().toISOString(),
        }, {
          onConflict: 'learner_id,course_id',
        })

      if (error) {
        // If upsert fails, try update only (enrollment might exist without highest_completed_seed)
        const { error: updateError } = await supabase
          .from('course_enrollments')
          .update({
            highest_completed_seed: seeds,
            last_practiced_at: new Date().toISOString(),
          })
          .eq('learner_id', learnerId)
          .eq('course_id', courseCode)

        if (updateError) {
          console.warn('[BeltProgress] Remote sync failed:', updateError.message)
          lastSyncError.value = updateError.message
        } else {
          console.log('[BeltProgress] Synced to remote:', seeds, 'seeds')
        }
      } else {
        console.log('[BeltProgress] Synced to remote:', seeds, 'seeds')
      }
    } catch (err) {
      console.warn('[BeltProgress] Remote sync error:', err)
      lastSyncError.value = String(err)
    } finally {
      isSyncing.value = false
    }
  }

  /**
   * Merge local and remote progress, taking the highest value
   * This ensures progress never goes backward across devices
   */
  const mergeProgress = async (): Promise<number> => {
    const localSeeds = completedSeeds.value
    const remoteSeeds = await fetchRemoteProgress()

    if (remoteSeeds === null) {
      console.log('[BeltProgress] No remote progress, using local:', localSeeds)
      return localSeeds
    }

    const mergedSeeds = Math.max(localSeeds, remoteSeeds)

    if (mergedSeeds !== localSeeds) {
      console.log('[BeltProgress] Merged progress: local', localSeeds, '+ remote', remoteSeeds, '=', mergedSeeds)
      completedSeeds.value = mergedSeeds
      saveProgressLocal() // Persist merged value locally
    }

    if (mergedSeeds > remoteSeeds) {
      // Local is ahead, sync to remote
      syncToRemote(mergedSeeds) // Fire and forget
    }

    return mergedSeeds
  }

  // ============================================================================
  // PERSISTENCE (localStorage)
  // ============================================================================

  /**
   * Load progress from localStorage only
   */
  const loadProgressLocal = () => {
    try {
      const key = `${PROGRESS_KEY_PREFIX}${courseCode}`
      const stored = localStorage.getItem(key)
      if (stored) {
        const data: StoredProgress = JSON.parse(stored)
        completedSeeds.value = data.completedSeeds || 0
        console.log(`[BeltProgress] Loaded ${completedSeeds.value} seeds from localStorage for ${courseCode}`)
      } else {
        completedSeeds.value = 0
        console.log(`[BeltProgress] No saved progress for ${courseCode}, starting at 0`)
      }
    } catch (err) {
      console.warn('[BeltProgress] Failed to load progress:', err)
      completedSeeds.value = 0
    }
  }

  /**
   * Save progress to localStorage only
   */
  const saveProgressLocal = () => {
    try {
      const key = `${PROGRESS_KEY_PREFIX}${courseCode}`
      const data: StoredProgress = {
        completedSeeds: completedSeeds.value,
        lastUpdated: Date.now(),
      }
      localStorage.setItem(key, JSON.stringify(data))
    } catch (err) {
      console.warn('[BeltProgress] Failed to save progress:', err)
    }
  }

  /**
   * Save progress to both localStorage and Supabase
   * localStorage is synchronous (instant), Supabase is background
   */
  const saveProgress = () => {
    // Always save locally first (instant)
    saveProgressLocal()

    // Sync to remote in background (non-blocking)
    if (canSync()) {
      syncToRemote(completedSeeds.value)
    }
  }

  /**
   * Load progress from both localStorage and Supabase, taking highest
   * Called on initialization to merge cross-device progress
   */
  const loadProgress = async (): Promise<void> => {
    // Load local first (instant)
    loadProgressLocal()

    // Then merge with remote (async)
    if (canSync()) {
      await mergeProgress()
    }
  }

  const loadSessionHistory = () => {
    try {
      const key = `${SESSION_HISTORY_KEY_PREFIX}${courseCode}`
      const stored = localStorage.getItem(key)
      if (stored) {
        const data: StoredSessionHistory = JSON.parse(stored)
        // Keep only last 30 days of sessions
        const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000
        sessionHistory.value = (data.sessions || []).filter(s => s.timestamp > thirtyDaysAgo)
      }
    } catch (err) {
      console.warn('[BeltProgress] Failed to load session history:', err)
      sessionHistory.value = []
    }
  }

  const saveSessionHistory = () => {
    try {
      const key = `${SESSION_HISTORY_KEY_PREFIX}${courseCode}`
      const data: StoredSessionHistory = {
        sessions: sessionHistory.value,
      }
      localStorage.setItem(key, JSON.stringify(data))
    } catch (err) {
      console.warn('[BeltProgress] Failed to save session history:', err)
    }
  }

  // ============================================================================
  // BELT CALCULATIONS
  // ============================================================================

  const currentBelt = computed((): Belt => {
    for (let i = BELTS.length - 1; i >= 0; i--) {
      if (completedSeeds.value >= BELTS[i].seedsRequired) {
        return { ...BELTS[i], index: i }
      }
    }
    return { ...BELTS[0], index: 0 }
  })

  const nextBelt = computed((): Belt | null => {
    const nextIndex = currentBelt.value.index + 1
    if (nextIndex >= BELTS.length) return null
    return { ...BELTS[nextIndex], index: nextIndex }
  })

  const beltProgress = computed(() => {
    if (!nextBelt.value) return 100 // At black belt
    const current = currentBelt.value.seedsRequired
    const next = nextBelt.value.seedsRequired
    const progress = (completedSeeds.value - current) / (next - current)
    return Math.min(Math.max(progress * 100, 0), 100)
  })

  const seedsToNextBelt = computed(() => {
    if (!nextBelt.value) return 0
    return nextBelt.value.seedsRequired - completedSeeds.value
  })

  const courseProgress = computed(() => {
    return Math.min((completedSeeds.value / TOTAL_SEEDS) * 100, 100)
  })

  // ============================================================================
  // LEARNING RATE & TIME ESTIMATES
  // ============================================================================

  /**
   * Calculate rolling average seeds per session (last 10 sessions)
   */
  const averageSeedsPerSession = computed(() => {
    const recent = sessionHistory.value.slice(-10)
    if (recent.length === 0) return 0
    const total = recent.reduce((sum, s) => sum + s.seedsLearned, 0)
    return total / recent.length
  })

  /**
   * Calculate average session duration in minutes
   */
  const averageSessionDuration = computed(() => {
    const recent = sessionHistory.value.slice(-10)
    if (recent.length === 0) return 30 // Default assumption: 30 min sessions
    const total = recent.reduce((sum, s) => sum + s.durationMs, 0)
    return (total / recent.length) / 60000 // Convert to minutes
  })

  /**
   * Estimate sessions until next belt
   */
  const sessionsToNextBelt = computed(() => {
    if (!nextBelt.value) return 0
    if (averageSeedsPerSession.value <= 0) return null // No data yet
    return Math.ceil(seedsToNextBelt.value / averageSeedsPerSession.value)
  })

  /**
   * Estimate time to next belt as human-readable string
   * Based on rolling average of recent sessions
   */
  const timeToNextBelt = computed(() => {
    if (!nextBelt.value) return 'Complete!'
    if (sessionsToNextBelt.value === null) return 'Keep learning to see estimate'

    const sessions = sessionsToNextBelt.value
    const avgDuration = averageSessionDuration.value

    // If less than 1 session worth of seeds
    if (sessions <= 1) {
      const seedsNeeded = seedsToNextBelt.value
      const seedsPerMinute = averageSeedsPerSession.value / avgDuration
      if (seedsPerMinute > 0) {
        const minutes = Math.ceil(seedsNeeded / seedsPerMinute)
        if (minutes < 60) return `~${minutes} mins`
        return `~${Math.round(minutes / 60)} hr`
      }
      return 'Almost there!'
    }

    // Multiple sessions needed
    if (sessions <= 3) return `~${sessions} sessions`
    if (sessions <= 7) return `~${Math.ceil(sessions / 2)} days (2 sessions/day)`
    if (sessions <= 14) return `~${Math.ceil(sessions / 7)} week${sessions > 7 ? 's' : ''}`
    return `~${Math.ceil(sessions / 30)} month${sessions > 30 ? 's' : ''}`
  })

  // ============================================================================
  // SESSION TRACKING
  // ============================================================================

  /**
   * Call when a learning session starts
   */
  const startSession = () => {
    sessionStartTime.value = Date.now()
    sessionStartSeeds.value = completedSeeds.value
    console.log('[BeltProgress] Session started at', sessionStartSeeds.value, 'seeds')
  }

  /**
   * Call when a learning session ends
   */
  const endSession = () => {
    if (sessionStartTime.value === null) return

    const seedsLearned = completedSeeds.value - sessionStartSeeds.value
    const durationMs = Date.now() - sessionStartTime.value

    // Only record if meaningful progress was made
    if (seedsLearned > 0 && durationMs > 60000) { // At least 1 minute
      const record: SessionRecord = {
        timestamp: Date.now(),
        seedsLearned,
        durationMs,
      }
      sessionHistory.value.push(record)
      saveSessionHistory()
      console.log('[BeltProgress] Session ended:', seedsLearned, 'seeds in', Math.round(durationMs / 60000), 'mins')
    }

    sessionStartTime.value = null
    sessionStartSeeds.value = 0
  }

  // ============================================================================
  // PROGRESS UPDATES
  // ============================================================================

  /**
   * Add seeds to progress (call when learner completes content)
   * Returns the previous belt if a promotion just happened
   */
  const addSeeds = (count: number = 1): Belt | null => {
    const previousBelt = currentBelt.value
    completedSeeds.value = Math.min(completedSeeds.value + count, TOTAL_SEEDS)
    saveProgress()

    // Check for belt promotion
    const newBelt = currentBelt.value
    if (newBelt.index > previousBelt.index) {
      console.log(`[BeltProgress] 🎉 Belt promotion: ${previousBelt.name} → ${newBelt.name}`)
      return previousBelt
    }
    return null
  }

  /**
   * Set seeds directly (for sync from server, etc.)
   */
  const setSeeds = (count: number) => {
    completedSeeds.value = Math.min(Math.max(count, 0), TOTAL_SEEDS)
    saveProgress()
  }

  /**
   * Reset progress (for testing/demo)
   */
  const resetProgress = () => {
    completedSeeds.value = 0
    sessionHistory.value = []
    saveProgress()
    saveSessionHistory()
    console.log('[BeltProgress] Progress reset to 0')
  }

  // ============================================================================
  // BELT NAVIGATION
  // ============================================================================

  /**
   * Get the seed number where a specific belt starts
   */
  const getBeltStartSeed = (beltIndex: number): number => {
    if (beltIndex < 0 || beltIndex >= BELTS.length) return 0
    return BELTS[beltIndex].seedsRequired
  }

  /**
   * Get the previous belt's start position (for "go back")
   * Returns null if already at white belt
   */
  const previousBelt = computed((): Belt | null => {
    const prevIndex = currentBelt.value.index - 1
    if (prevIndex < 0) return null
    return { ...BELTS[prevIndex], index: prevIndex }
  })

  /**
   * Skip to the start of the next belt
   * Returns the new seed position, or null if already at black belt
   */
  const skipToNextBelt = (): number | null => {
    if (!nextBelt.value) return null
    const newSeeds = nextBelt.value.seedsRequired
    completedSeeds.value = newSeeds
    saveProgress()
    console.log(`[BeltProgress] Skipped to ${nextBelt.value.name} belt (seed ${newSeeds})`)
    return newSeeds
  }

  /**
   * Go back to the start of the current belt (or previous if at start)
   * Returns the new seed position
   */
  const goBackToBeltStart = (): number => {
    const currentStart = currentBelt.value.seedsRequired
    // If we're more than a few seeds into the current belt, go to its start
    // Otherwise, go to the previous belt's start
    if (completedSeeds.value > currentStart + 2 || !previousBelt.value) {
      completedSeeds.value = currentStart
      saveProgress()
      console.log(`[BeltProgress] Went back to start of ${currentBelt.value.name} belt (seed ${currentStart})`)
      return currentStart
    } else {
      const prevStart = previousBelt.value.seedsRequired
      completedSeeds.value = prevStart
      saveProgress()
      console.log(`[BeltProgress] Went back to ${previousBelt.value.name} belt (seed ${prevStart})`)
      return prevStart
    }
  }

  /**
   * Jump to a specific belt by index
   * Returns the new seed position
   */
  const jumpToBelt = (beltIndex: number): number => {
    const targetSeeds = getBeltStartSeed(beltIndex)
    completedSeeds.value = Math.min(targetSeeds, TOTAL_SEEDS)
    saveProgress()
    console.log(`[BeltProgress] Jumped to ${BELTS[beltIndex]?.name || 'unknown'} belt (seed ${targetSeeds})`)
    return targetSeeds
  }

  // ============================================================================
  // BELT JOURNEY DATA
  // ============================================================================

  /**
   * Get data for displaying the full belt journey
   */
  const beltJourney = computed(() => {
    return BELTS.map((belt, index) => {
      const isComplete = completedSeeds.value >= belt.seedsRequired
      const isCurrent = currentBelt.value.index === index
      const isNext = nextBelt.value?.index === index

      // Progress within this belt (if current)
      let progressInBelt = 0
      if (isCurrent && index < BELTS.length - 1) {
        const beltStart = belt.seedsRequired
        const beltEnd = BELTS[index + 1].seedsRequired
        progressInBelt = ((completedSeeds.value - beltStart) / (beltEnd - beltStart)) * 100
      } else if (isComplete) {
        progressInBelt = 100
      }

      return {
        ...belt,
        index,
        isComplete,
        isCurrent,
        isNext,
        progressInBelt,
      }
    })
  })

  // ============================================================================
  // CSS VARS
  // ============================================================================

  const beltCssVars = computed(() => ({
    '--belt-color': currentBelt.value.color,
    '--belt-color-dark': currentBelt.value.colorDark,
    '--belt-glow': currentBelt.value.glow,
  }))

  // ============================================================================
  // INITIALIZATION
  // ============================================================================

  /**
   * Initialize belt progress - loads from localStorage immediately,
   * then merges with Supabase in background
   */
  const initialize = async (): Promise<void> => {
    if (isLoaded.value) return

    // Load local progress first (sync, instant)
    loadProgressLocal()
    loadSessionHistory()
    isLoaded.value = true

    // Merge with remote in background (async)
    if (canSync()) {
      try {
        await mergeProgress()
      } catch (err) {
        console.warn('[BeltProgress] Remote merge failed:', err)
        // Continue with local progress - offline is fine
      }
    }
  }

  /**
   * Initialize synchronously (for backwards compatibility)
   * Use initialize() for full sync support
   */
  const initializeSync = () => {
    if (isLoaded.value) return
    loadProgressLocal()
    loadSessionHistory()
    isLoaded.value = true
  }

  // Auto-save on changes (both local and remote)
  watch(completedSeeds, () => {
    if (isLoaded.value) saveProgress()
  })

  return {
    // State
    completedSeeds,
    isLoaded,
    isSyncing,
    lastSyncError,

    // Belt info
    currentBelt,
    nextBelt,
    previousBelt,
    beltProgress,
    seedsToNextBelt,
    courseProgress,
    beltJourney,
    beltCssVars,

    // Learning rate
    averageSeedsPerSession,
    averageSessionDuration,
    sessionsToNextBelt,
    timeToNextBelt,

    // Session tracking
    startSession,
    endSession,

    // Actions
    addSeeds,
    setSeeds,
    resetProgress,
    initialize,
    initializeSync,

    // Sync actions
    syncToRemote,
    mergeProgress,
    canSync,

    // Belt navigation
    getBeltStartSeed,
    skipToNextBelt,
    goBackToBeltStart,
    jumpToBelt,

    // Constants
    TOTAL_SEEDS,
    BELTS,
  }
}

// Export singleton-style for sharing across components
let sharedInstance: ReturnType<typeof useBeltProgress> | null = null
let sharedCourseCode: string | null = null
let sharedSyncConfig: BeltProgressSyncConfig | null = null

/**
 * Shared belt progress instance for cross-component state
 * Supports optional Supabase sync when syncConfig is provided
 */
export function useSharedBeltProgress(
  courseCode: string,
  syncConfig?: BeltProgressSyncConfig
): ReturnType<typeof useBeltProgress> {
  // Return existing instance if course code and sync config match
  if (
    sharedInstance &&
    sharedCourseCode === courseCode &&
    JSON.stringify(sharedSyncConfig) === JSON.stringify(syncConfig)
  ) {
    return sharedInstance
  }

  // Create new instance
  sharedInstance = useBeltProgress(courseCode, syncConfig)
  sharedCourseCode = courseCode
  sharedSyncConfig = syncConfig ?? null

  // Initialize (use sync version for backwards compatibility)
  // Caller can await initialize() separately for full sync support
  sharedInstance.initializeSync()

  return sharedInstance
}

/**
 * Get the shared instance without creating a new one
 * Returns null if not initialized
 */
export function getSharedBeltProgress(): ReturnType<typeof useBeltProgress> | null {
  return sharedInstance
}
