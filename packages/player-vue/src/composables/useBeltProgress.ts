/**
 * useBeltProgress - Belt progression system with localStorage persistence
 *
 * Tracks:
 * - completedSeeds per course (persisted)
 * - Session history for learning rate calculation
 * - Rolling average for time-to-next-belt estimates
 *
 * Belt System (from APML):
 * - 8 belts: White → Yellow → Orange → Green → Blue → Purple → Brown → Black
 * - Thresholds: 0, 8, 20, 40, 80, 150, 280, 400 seeds
 */

import { ref, computed, watch } from 'vue'

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
const APP_VERSION_KEY = 'ssi_app_version'

// Increment this when you want to reset all user progress on deployment
// This ensures belt status resets when cache is invalidated
const CURRENT_APP_VERSION = '2025-01-06-v1'

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
// COMPOSABLE
// ============================================================================

export function useBeltProgress(courseCode: string) {
  // Core state
  const completedSeeds = ref(0)
  const sessionHistory = ref<SessionRecord[]>([])
  const isLoaded = ref(false)

  // Current session tracking
  const sessionStartTime = ref<number | null>(null)
  const sessionStartSeeds = ref(0)

  // ============================================================================
  // PERSISTENCE
  // ============================================================================

  const loadProgress = () => {
    try {
      const key = `${PROGRESS_KEY_PREFIX}${courseCode}`
      const stored = localStorage.getItem(key)
      if (stored) {
        const data: StoredProgress = JSON.parse(stored)
        completedSeeds.value = data.completedSeeds || 0
        console.log(`[BeltProgress] Loaded ${completedSeeds.value} seeds for ${courseCode}`)
      } else {
        completedSeeds.value = 0
        console.log(`[BeltProgress] No saved progress for ${courseCode}, starting at 0`)
      }
    } catch (err) {
      console.warn('[BeltProgress] Failed to load progress:', err)
      completedSeeds.value = 0
    }
  }

  const saveProgress = () => {
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
   * Check if app version changed (new deployment) and reset progress if so
   */
  const checkVersionAndReset = () => {
    try {
      const storedVersion = localStorage.getItem(APP_VERSION_KEY)
      if (storedVersion !== CURRENT_APP_VERSION) {
        console.log(`[BeltProgress] New deployment detected (${storedVersion} → ${CURRENT_APP_VERSION}), resetting progress`)
        // Clear all belt progress for all courses
        const keysToRemove: string[] = []
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i)
          if (key && (key.startsWith(PROGRESS_KEY_PREFIX) || key.startsWith(SESSION_HISTORY_KEY_PREFIX))) {
            keysToRemove.push(key)
          }
        }
        keysToRemove.forEach(key => localStorage.removeItem(key))
        // Update stored version
        localStorage.setItem(APP_VERSION_KEY, CURRENT_APP_VERSION)
        return true // Progress was reset
      }
      return false
    } catch (err) {
      console.warn('[BeltProgress] Failed to check version:', err)
      return false
    }
  }

  const initialize = () => {
    if (isLoaded.value) return
    checkVersionAndReset()
    loadProgress()
    loadSessionHistory()
    isLoaded.value = true
  }

  // Auto-save on changes
  watch(completedSeeds, () => {
    if (isLoaded.value) saveProgress()
  })

  return {
    // State
    completedSeeds,
    isLoaded,

    // Belt info
    currentBelt,
    nextBelt,
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

    // Constants
    TOTAL_SEEDS,
    BELTS,
  }
}

// Export singleton-style for sharing across components
let sharedInstance: ReturnType<typeof useBeltProgress> | null = null
let sharedCourseCode: string | null = null

export function useSharedBeltProgress(courseCode: string) {
  if (sharedInstance && sharedCourseCode === courseCode) {
    return sharedInstance
  }
  sharedInstance = useBeltProgress(courseCode)
  sharedCourseCode = courseCode
  sharedInstance.initialize()
  return sharedInstance
}
