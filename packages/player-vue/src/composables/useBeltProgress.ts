/**
 * useBeltProgress - Belt progression system with localStorage + Supabase sync
 *
 * Simple model - tracks only TWO things:
 * 1. highestBeltIndex (0-7) - Achievement level, only ever increases
 * 2. lastLegoId - Resume position, e.g., "S0045L03"
 *
 * Current playing position is read from the player at runtime, not stored here.
 *
 * Sync Strategy:
 * - localStorage is primary (instant, works offline)
 * - Supabase is background sync (cross-device)
 * - On load: merge local + remote, take highest belt
 * - Belt never goes backward (max wins)
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
  { name: 'black',  seedsRequired: 400, color: '#d4a853', colorDark: '#b8860b', glow: 'rgba(212, 168, 83, 0.4)' },  // Gold accent
]

export const TOTAL_SEEDS = 668 // Total seeds in a typical course

// ============================================================================
// STORAGE KEYS
// ============================================================================

const PROGRESS_KEY_PREFIX = 'ssi_belt_progress_'
const SESSION_HISTORY_KEY_PREFIX = 'ssi_session_history_'

// ============================================================================
// TYPES
// ============================================================================

interface StoredProgress {
  highestBeltIndex: number  // 0-7, the belt ACHIEVED
  lastLegoId: string | null // Resume position, e.g., "S0045L03"
  highestLegoId: string | null // High-water mark, only goes forward
  lastUpdated: number
}

interface SessionRecord {
  timestamp: number
  seedsLearned: number
  durationMs: number
  phrasesSpoken?: number // Cycles where VAD detected speech
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
// HELPER: Parse seed from LEGO ID
// ============================================================================

/**
 * Parse seed number from LEGO ID
 * "S0045L03" → 45
 */
export function getSeedFromLegoId(legoId: string | null): number | null {
  if (!legoId) return null
  const match = legoId.match(/^S(\d{4})L/)
  return match ? parseInt(match[1], 10) : null
}

/**
 * Get belt index for a seed number
 */
export function getBeltIndexForSeed(seedNumber: number): number {
  for (let i = BELTS.length - 1; i >= 0; i--) {
    if (seedNumber >= BELTS[i].seedsRequired) {
      return i
    }
  }
  return 0
}

// ============================================================================
// COMPOSABLE
// ============================================================================

export function useBeltProgress(courseCode: string, syncConfig?: BeltProgressSyncConfig) {
  // Core state
  const highestBeltIndex = ref(0)  // 0-7, only ever increases
  const lastLegoId = ref<string | null>(null)  // Resume position
  const highestLegoId = ref<string | null>(null)  // High-water mark, only goes forward

  // Session history for learning rate calculations
  const sessionHistory = ref<SessionRecord[]>([])
  const isLoaded = ref(false)
  const isSyncing = ref(false)
  const lastSyncError = ref<string | null>(null)

  // Current session tracking (for learning rate)
  const sessionStartTime = ref<number | null>(null)
  const sessionStartSeed = ref(0)

  // ============================================================================
  // SYNC HELPERS
  // ============================================================================

  const getSupabase = (): SupabaseClient | null => {
    if (!syncConfig?.supabase) return null
    return 'value' in syncConfig.supabase
      ? syncConfig.supabase.value
      : syncConfig.supabase
  }

  const getLearnerId = (): string | null => {
    if (!syncConfig?.learnerId) return null
    if (typeof syncConfig.learnerId === 'object' && syncConfig.learnerId !== null && 'value' in syncConfig.learnerId) {
      return syncConfig.learnerId.value
    }
    return syncConfig.learnerId as string
  }

  const canSync = (): boolean => {
    const supabase = getSupabase()
    const learnerId = getLearnerId()
    return !!(supabase && learnerId && !learnerId.startsWith('guest-'))
  }

  // ============================================================================
  // SUPABASE SYNC
  // ============================================================================

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

      // Convert seed to belt index
      const remoteSeed = data?.highest_completed_seed ?? null
      if (remoteSeed === null) return null
      return getBeltIndexForSeed(remoteSeed)
    } catch (err) {
      console.warn('[BeltProgress] Remote fetch failed:', err)
      return null
    }
  }

  const syncToRemote = async (beltIndex: number): Promise<void> => {
    if (!canSync()) return

    const supabase = getSupabase()
    const learnerId = getLearnerId()

    if (!supabase || !learnerId) return

    isSyncing.value = true
    lastSyncError.value = null

    // Convert belt index to seed threshold for storage
    const seedsForBelt = BELTS[beltIndex]?.seedsRequired ?? 0

    try {
      const { error } = await supabase
        .from('course_enrollments')
        .upsert({
          learner_id: learnerId,
          course_id: courseCode,
          highest_completed_seed: seedsForBelt,
          last_practiced_at: new Date().toISOString(),
        }, {
          onConflict: 'learner_id,course_id',
        })

      if (error) {
        const { error: updateError } = await supabase
          .from('course_enrollments')
          .update({
            highest_completed_seed: seedsForBelt,
            last_practiced_at: new Date().toISOString(),
          })
          .eq('learner_id', learnerId)
          .eq('course_id', courseCode)

        if (updateError) {
          console.warn('[BeltProgress] Remote sync failed:', updateError.message)
          lastSyncError.value = updateError.message
        } else {
          console.log('[BeltProgress] Synced to remote: belt', beltIndex, `(${BELTS[beltIndex]?.name})`)
        }
      } else {
        console.log('[BeltProgress] Synced to remote: belt', beltIndex, `(${BELTS[beltIndex]?.name})`)
      }
    } catch (err) {
      console.warn('[BeltProgress] Remote sync error:', err)
      lastSyncError.value = String(err)
    } finally {
      isSyncing.value = false
    }
  }

  const mergeProgress = async (): Promise<number> => {
    const localBelt = highestBeltIndex.value
    const remoteBelt = await fetchRemoteProgress()

    if (remoteBelt === null) {
      console.log('[BeltProgress] No remote progress, using local belt:', localBelt)
      return localBelt
    }

    const mergedBelt = Math.max(localBelt, remoteBelt)

    if (mergedBelt !== localBelt) {
      console.log('[BeltProgress] Merged: local belt', localBelt, '+ remote belt', remoteBelt, '=', mergedBelt)
      highestBeltIndex.value = mergedBelt
      saveProgressLocal()
    }

    if (mergedBelt > remoteBelt) {
      syncToRemote(mergedBelt)
    }

    return mergedBelt
  }

  // ============================================================================
  // PERSISTENCE (localStorage)
  // ============================================================================

  const loadProgressLocal = () => {
    try {
      const key = `${PROGRESS_KEY_PREFIX}${courseCode}`
      const stored = localStorage.getItem(key)
      if (stored) {
        const data = JSON.parse(stored)

        // Handle migration from old format (completedRounds) to new format (highestBeltIndex)
        if ('completedRounds' in data && !('highestBeltIndex' in data)) {
          // Migrate: convert completedRounds (seed count) to belt index
          highestBeltIndex.value = getBeltIndexForSeed(data.completedRounds || 0)
          lastLegoId.value = data.currentLegoId || null
          highestLegoId.value = data.currentLegoId || null
          console.log(`[BeltProgress] Migrated from completedRounds ${data.completedRounds} to belt ${highestBeltIndex.value}`)
          saveProgressLocal() // Save in new format
        } else {
          highestBeltIndex.value = data.highestBeltIndex ?? 0
          lastLegoId.value = data.lastLegoId || null
          // Migrate: if no highestLegoId stored yet, seed from lastLegoId
          highestLegoId.value = data.highestLegoId ?? data.lastLegoId ?? null
        }

        console.log(`[BeltProgress] Loaded: belt ${highestBeltIndex.value} (${BELTS[highestBeltIndex.value]?.name}), resume: ${lastLegoId.value || 'start'}, highest: ${highestLegoId.value || 'none'}`)
      } else {
        highestBeltIndex.value = 0
        lastLegoId.value = null
        highestLegoId.value = null
        console.log(`[BeltProgress] No saved progress for ${courseCode}, starting at white belt`)
      }
    } catch (err) {
      console.warn('[BeltProgress] Failed to load progress:', err)
      highestBeltIndex.value = 0
      lastLegoId.value = null
      highestLegoId.value = null
    }
  }

  const saveProgressLocal = () => {
    try {
      const key = `${PROGRESS_KEY_PREFIX}${courseCode}`
      const data: StoredProgress = {
        highestBeltIndex: highestBeltIndex.value,
        lastLegoId: lastLegoId.value,
        highestLegoId: highestLegoId.value,
        lastUpdated: Date.now(),
      }
      localStorage.setItem(key, JSON.stringify(data))
    } catch (err) {
      console.warn('[BeltProgress] Failed to save progress:', err)
    }
  }

  const saveProgress = () => {
    saveProgressLocal()
    if (canSync()) {
      syncToRemote(highestBeltIndex.value)
    }
  }

  const loadSessionHistory = () => {
    try {
      const key = `${SESSION_HISTORY_KEY_PREFIX}${courseCode}`
      const stored = localStorage.getItem(key)
      if (stored) {
        const data: StoredSessionHistory = JSON.parse(stored)
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
  // BELT INFO (computed from highestBeltIndex)
  // ============================================================================

  const currentBelt = computed((): Belt => {
    const idx = Math.min(Math.max(highestBeltIndex.value, 0), BELTS.length - 1)
    return { ...BELTS[idx], index: idx }
  })

  const nextBelt = computed((): Belt | null => {
    const nextIndex = highestBeltIndex.value + 1
    if (nextIndex >= BELTS.length) return null
    return { ...BELTS[nextIndex], index: nextIndex }
  })

  const previousBelt = computed((): Belt | null => {
    const prevIndex = highestBeltIndex.value - 1
    if (prevIndex < 0) return null
    return { ...BELTS[prevIndex], index: prevIndex }
  })

  // ============================================================================
  // PROGRESS CALCULATIONS (for display)
  // ============================================================================

  // Seeds needed to reach next belt (from current belt's threshold)
  const seedsToNextBelt = computed(() => {
    if (!nextBelt.value) return 0
    return nextBelt.value.seedsRequired - currentBelt.value.seedsRequired
  })

  // Course progress based on highest belt achieved
  const courseProgress = computed(() => {
    const beltSeed = currentBelt.value.seedsRequired
    return Math.min((beltSeed / TOTAL_SEEDS) * 100, 100)
  })

  // ============================================================================
  // AGGREGATE STATS (for UsageStats display)
  // ============================================================================

  const totalLearningMinutes = computed(() => {
    return Math.round(sessionHistory.value.reduce((sum, s) => sum + s.durationMs, 0) / 60000)
  })

  const totalPhrasesSpoken = computed(() => {
    return sessionHistory.value.reduce((sum, s) => sum + (s.phrasesSpoken ?? 0), 0)
  })

  const totalSessionCount = computed(() => sessionHistory.value.length)

  // ============================================================================
  // LEARNING RATE & TIME ESTIMATES
  // ============================================================================

  const averageSeedsPerSession = computed(() => {
    const recent = sessionHistory.value.slice(-10)
    if (recent.length === 0) return 0
    const total = recent.reduce((sum, s) => sum + s.seedsLearned, 0)
    return total / recent.length
  })

  const averageSessionDuration = computed(() => {
    const recent = sessionHistory.value.slice(-10)
    if (recent.length === 0) return 30
    const total = recent.reduce((sum, s) => sum + s.durationMs, 0)
    return (total / recent.length) / 60000
  })

  const sessionsToNextBelt = computed(() => {
    if (!nextBelt.value) return 0
    if (averageSeedsPerSession.value <= 0) return null
    return Math.ceil(seedsToNextBelt.value / averageSeedsPerSession.value)
  })

  const timeToNextBelt = computed(() => {
    if (!nextBelt.value) return 'Complete!'
    if (sessionsToNextBelt.value === null) return 'Keep learning to see estimate'

    const sessions = sessionsToNextBelt.value
    if (sessions <= 1) return 'Almost there!'
    if (sessions <= 3) return `~${sessions} sessions`
    if (sessions <= 7) return `~${Math.ceil(sessions / 2)} days`
    if (sessions <= 14) return `~${Math.ceil(sessions / 7)} week${sessions > 7 ? 's' : ''}`
    return `~${Math.ceil(sessions / 30)} month${sessions > 30 ? 's' : ''}`
  })

  // ============================================================================
  // SESSION TRACKING
  // ============================================================================

  const startSession = (currentSeed: number = 0) => {
    sessionStartTime.value = Date.now()
    sessionStartSeed.value = currentSeed
    console.log('[BeltProgress] Session started at seed', currentSeed)
  }

  const endSession = (currentSeed: number = 0, phrasesSpoken: number = 0) => {
    if (sessionStartTime.value === null) return

    const seedsLearned = currentSeed - sessionStartSeed.value
    const durationMs = Date.now() - sessionStartTime.value

    if (seedsLearned > 0 && durationMs > 60000) {
      const record: SessionRecord = {
        timestamp: Date.now(),
        seedsLearned,
        durationMs,
        phrasesSpoken,
      }
      sessionHistory.value.push(record)
      saveSessionHistory()
      console.log('[BeltProgress] Session ended:', seedsLearned, 'seeds,', phrasesSpoken, 'phrases spoken in', Math.round(durationMs / 60000), 'mins')
    }

    sessionStartTime.value = null
    sessionStartSeed.value = 0
  }

  // ============================================================================
  // PROGRESS UPDATES
  // ============================================================================

  /**
   * Check if a seed number warrants a belt promotion
   * Only updates if the seed crosses into a higher belt than current
   * Returns the previous belt if promotion happened, null otherwise
   */
  const checkBeltPromotion = (seedNumber: number): Belt | null => {
    const beltForSeed = getBeltIndexForSeed(seedNumber)

    if (beltForSeed > highestBeltIndex.value) {
      const previousBeltValue = currentBelt.value
      highestBeltIndex.value = beltForSeed
      saveProgress()
      console.log(`[BeltProgress] 🎉 Belt promotion: ${previousBeltValue.name} → ${BELTS[beltForSeed].name}`)
      return previousBeltValue
    }
    return null
  }

  /**
   * Update resume position (call when player moves to a new LEGO)
   * Also updates highestLegoId if this is further than we've ever been
   */
  const setLastLegoId = (legoId: string | null) => {
    lastLegoId.value = legoId

    // Update high-water mark (only goes forward)
    if (legoId && (!highestLegoId.value || legoId > highestLegoId.value)) {
      highestLegoId.value = legoId
    }

    saveProgressLocal() // Just save locally, no remote sync for position

    // Check for belt promotion based on the LEGO's seed
    if (legoId) {
      const seed = getSeedFromLegoId(legoId)
      if (seed !== null) {
        checkBeltPromotion(seed)
      }
    }
  }

  /**
   * Reset progress (for testing/demo)
   */
  const resetProgress = () => {
    highestBeltIndex.value = 0
    lastLegoId.value = null
    highestLegoId.value = null
    sessionHistory.value = []
    saveProgress()
    saveSessionHistory()
    console.log('[BeltProgress] Progress reset to white belt')
  }

  // ============================================================================
  // BELT NAVIGATION HELPERS (for skip buttons in UI)
  // ============================================================================

  /**
   * Get the seed number where a specific belt starts
   */
  const getBeltStartSeed = (beltIndex: number): number => {
    if (beltIndex < 0 || beltIndex >= BELTS.length) return 1
    const threshold = BELTS[beltIndex].seedsRequired
    return threshold === 0 ? 1 : threshold
  }

  // ============================================================================
  // BELT JOURNEY DATA (for progress visualization)
  // ============================================================================

  const beltJourney = computed(() => {
    return BELTS.map((belt, index) => {
      const isComplete = highestBeltIndex.value >= index
      const isCurrent = highestBeltIndex.value === index
      const isNext = highestBeltIndex.value + 1 === index

      return {
        ...belt,
        index,
        isComplete,
        isCurrent,
        isNext,
        progressInBelt: isComplete ? 100 : 0, // Simplified: belt is achieved or not
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

  const initialize = async (): Promise<void> => {
    if (isLoaded.value) return

    loadProgressLocal()
    loadSessionHistory()
    isLoaded.value = true

    if (canSync()) {
      try {
        await mergeProgress()
      } catch (err) {
        console.warn('[BeltProgress] Remote merge failed:', err)
      }
    }
  }

  const initializeSync = () => {
    if (isLoaded.value) return
    loadProgressLocal()
    loadSessionHistory()
    isLoaded.value = true
  }

  // ============================================================================
  // BACKWARDS COMPATIBILITY
  // ============================================================================

  // These provide compatibility with existing code that uses the old API
  const completedRounds = computed(() => currentBelt.value.seedsRequired)

  const setSeeds = (count: number) => {
    // Convert seed count to belt and update
    const beltIndex = getBeltIndexForSeed(count)
    if (beltIndex > highestBeltIndex.value) {
      highestBeltIndex.value = beltIndex
      saveProgress()
    }
  }

  const addSeeds = (count: number = 1): Belt | null => {
    // This is now handled by checkBeltPromotion via setLastLegoId
    // Kept for backwards compatibility but does nothing meaningful
    return null
  }

  // Legacy aliases
  const currentLegoId = lastLegoId
  const setCurrentLegoId = setLastLegoId

  return {
    // Core state
    highestBeltIndex,
    lastLegoId,
    highestLegoId,
    isLoaded,
    isSyncing,
    lastSyncError,

    // Belt info
    currentBelt,
    nextBelt,
    previousBelt,
    beltJourney,
    beltCssVars,

    // Progress info
    seedsToNextBelt,
    courseProgress,

    // Aggregate stats
    totalLearningMinutes,
    totalPhrasesSpoken,
    totalSessionCount,
    sessionHistory,

    // Learning rate
    averageSeedsPerSession,
    averageSessionDuration,
    sessionsToNextBelt,
    timeToNextBelt,

    // Session tracking
    startSession,
    endSession,

    // Actions
    setLastLegoId,
    checkBeltPromotion,
    resetProgress,
    initialize,
    initializeSync,

    // Sync
    syncToRemote,
    mergeProgress,
    canSync,

    // Helpers
    getBeltStartSeed,

    // Constants
    TOTAL_SEEDS,
    BELTS,

    // Backwards compatibility (deprecated, will be removed)
    completedRounds,
    currentLegoId,
    setCurrentLegoId,
    setSeeds,
    addSeeds,
    currentSeedNumber: computed(() => getSeedFromLegoId(lastLegoId.value)),
    getSeedFromLegoId: (id: string | null) => getSeedFromLegoId(id),
    beltProgress: computed(() => 100), // Always 100% - belt is achieved or not
    skipToNextBelt: () => null, // No longer managed here - handled by player
    goBackToBeltStart: () => 0, // No longer managed here - handled by player
    jumpToBelt: () => 0, // No longer managed here - handled by player
  }
}

// ============================================================================
// SHARED INSTANCE
// ============================================================================

let sharedInstance: ReturnType<typeof useBeltProgress> | null = null
let sharedCourseCode: string | null = null
let sharedSyncConfig: BeltProgressSyncConfig | null = null

export function useSharedBeltProgress(
  courseCode: string,
  syncConfig?: BeltProgressSyncConfig
): ReturnType<typeof useBeltProgress> {
  if (
    sharedInstance &&
    sharedCourseCode === courseCode &&
    JSON.stringify(sharedSyncConfig) === JSON.stringify(syncConfig)
  ) {
    return sharedInstance
  }

  sharedInstance = useBeltProgress(courseCode, syncConfig)
  sharedCourseCode = courseCode
  sharedSyncConfig = syncConfig ?? null
  sharedInstance.initializeSync()

  return sharedInstance
}

export function getSharedBeltProgress(): ReturnType<typeof useBeltProgress> | null {
  return sharedInstance
}
