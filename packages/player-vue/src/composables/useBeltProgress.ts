/**
 * useBeltProgress - Belt progression system with localStorage + Supabase sync
 *
 * Cursor-only model (2026-07-04) - tracks only TWO things:
 * 1. highestBeltIndex (0-7) - the belt for the CURRENT cursor position;
 *    moves forward AND back with the cursor, no ratchet
 * 2. lastLegoId - Resume position, e.g., "S0045L03"
 *
 * Current playing position is read from the player at runtime, not stored here.
 *
 * Sync Strategy:
 * - localStorage is primary (instant, works offline)
 * - Supabase is background sync (cross-device)
 * - On load: adopt the remote cursor position directly (remote is
 *   authoritative) — no "take the furthest of local vs remote"
 *
 * Belt System (from APML):
 * - 8 belts: White → Yellow → Orange → Green → Blue → Purple → Brown → Black
 * - Thresholds: 0, 8, 20, 40, 80, 150, 280, 400 seeds
 */

import { ref, shallowRef, computed, watch, type Ref } from 'vue'
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
  { name: 'white',  seedsRequired: 0,   color: '#ffffff', colorDark: '#e0e0e0', glow: 'rgba(255, 255, 255, 0.3)' },
  { name: 'yellow', seedsRequired: 8,   color: '#fcd34d', colorDark: '#f59e0b', glow: 'rgba(252, 211, 77, 0.4)' },
  { name: 'orange', seedsRequired: 20,  color: '#fb923c', colorDark: '#ea580c', glow: 'rgba(251, 146, 60, 0.4)' },
  { name: 'green',  seedsRequired: 40,  color: '#4ade80', colorDark: '#16a34a', glow: 'rgba(74, 222, 128, 0.4)' },
  { name: 'blue',   seedsRequired: 80,  color: '#60a5fa', colorDark: '#2563eb', glow: 'rgba(96, 165, 250, 0.4)' },
  { name: 'purple', seedsRequired: 150, color: '#a78bfa', colorDark: '#7c3aed', glow: 'rgba(167, 139, 250, 0.4)' },
  { name: 'brown',  seedsRequired: 280, color: '#a8856c', colorDark: '#78350f', glow: 'rgba(168, 133, 108, 0.4)' },
  { name: 'black',  seedsRequired: 400, color: '#1a1a1a', colorDark: '#000000', glow: 'rgba(255, 255, 255, 0.3)' },
]

export const TOTAL_SEEDS = 668 // Fallback — overridden per course by setCourseSeedCount()

// ============================================================================
// STORAGE KEYS
// ============================================================================

const PROGRESS_KEY_PREFIX = 'ssi_belt_progress_'
const SESSION_HISTORY_KEY_PREFIX = 'ssi_session_history_'

// ============================================================================
// TYPES
// ============================================================================

interface StoredProgress {
  highestBeltIndex: number  // 0-7, the belt for the current cursor position
  lastLegoId: string | null // Resume position, e.g., "S0045L03"
  highestLegoId: string | null // Mirrors lastLegoId (cursor-only model)
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
  const highestBeltIndex = ref(0)  // 0-7, belt for the current cursor position
  const lastLegoId = ref<string | null>(null)  // Resume position
  const highestLegoId = ref<string | null>(null)  // Mirrors lastLegoId (cursor-only model)

  // Course seed count — determines which belts are reachable
  const courseSeedCount = ref(TOTAL_SEEDS) // Fallback until set from DB

  const setCourseSeedCount = (count: number) => {
    courseSeedCount.value = count
  }

  // Only belts whose seedsRequired is reachable within this course's seed count
  const availableBelts = computed(() => {
    return BELTS.filter(b => b.seedsRequired < courseSeedCount.value)
  })

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

  const fetchRemoteProgress = async (): Promise<{ beltIndex: number; lastLegoId: string | null } | null> => {
    // Skip for guests — `course_enrollments.learner_id` is uuid-typed and the
    // `guest-{uuid}` prefix breaks the column constraint (400 from Supabase).
    // canSync() applies the same guard for the write path; mirror it here.
    if (!canSync()) return null

    const supabase = getSupabase()
    const learnerId = getLearnerId()

    // Guests are localStorage-only and have no remote enrollment. Their
    // `guest-<uuid>` id is not a valid uuid, so querying it against the uuid
    // learner_id column 400s — skip cleanly (matches useContribution).
    if (!supabase || !learnerId || learnerId.startsWith('guest-')) return null

    try {
      const { data, error } = await supabase
        .from('course_enrollments')
        .select('last_completed_lego_id')
        .eq('learner_id', learnerId)
        .eq('course_id', courseCode)
        .maybeSingle()

      if (error) {
        console.warn('[BeltProgress] Remote fetch error:', error.message)
        return null
      }

      // Belt is derived from the cursor (last_completed_lego_id) — the
      // ONLY position (cursor-only model, 2026-07-04). Previously this read
      // the ratcheted highest_completed_lego_id ceiling, which meant a
      // learner who moved their cursor back on another device would still
      // see the OLD, further-ahead belt here. The seed number is encoded
      // inside the lego id (S0044L03 → 44).
      const cursorLegoId = data?.last_completed_lego_id ?? null
      const cursorSeed = cursorLegoId ? getSeedFromLegoId(cursorLegoId) : null
      if (cursorSeed === null) return null
      return {
        beltIndex: getBeltIndexForSeed(cursorSeed),
        lastLegoId: cursorLegoId,
      }
    } catch (err) {
      console.warn('[BeltProgress] Remote fetch failed:', err)
      return null
    }
  }

  // Background sync of last_practiced_at + last_completed_lego_id (the lego
  // high-water mark, used for cross-device resume). highest_completed_seed
  // is no longer written: belt is now derived purely from current playing
  // position, and the column is being deprecated.
  const syncToRemote = async (_beltIndex: number): Promise<void> => {
    if (!canSync()) return

    const supabase = getSupabase()
    const learnerId = getLearnerId()

    // Guests are localStorage-only; their `guest-<uuid>` id 400s against the
    // uuid learner_id column. Nothing to sync remotely — skip cleanly.
    if (!supabase || !learnerId || learnerId.startsWith('guest-')) return

    isSyncing.value = true
    lastSyncError.value = null

    try {
      // NOTE: deliberately does NOT write last_completed_lego_id. That column is
      // the resume cursor ("where you are"), owned solely by
      // ProgressStore.setLivePosition. This belt sync used to write highestLegoId
      // ("furthest reached") into the same column — two writers, two meanings —
      // which is how the resume cursor drifted (Aran, 2026-06-01). Highest is
      // maintained from the cursor by the ratchet trigger, so it's not lost.
      const { error } = await supabase
        .from('course_enrollments')
        .upsert({
          learner_id: learnerId,
          course_id: courseCode,
          last_practiced_at: new Date().toISOString(),
        }, {
          onConflict: 'learner_id,course_id',
        })

      if (error) {
        const { error: updateError } = await supabase
          .from('course_enrollments')
          .update({
            last_practiced_at: new Date().toISOString(),
          })
          .eq('learner_id', learnerId)
          .eq('course_id', courseCode)

        if (updateError) {
          console.warn('[BeltProgress] Remote sync failed:', updateError.message)
          lastSyncError.value = updateError.message
        }
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
    const remoteData = await fetchRemoteProgress()

    if (remoteData === null) {
      console.log('[BeltProgress] No remote progress, using local belt:', localBelt)
      return localBelt
    }

    // Cursor-only model (2026-07-04): the remote cursor IS the position —
    // no ratchet, no "furthest of local vs remote wins". localStorage is
    // just an instant-load cache of the last-known cursor; the DB row is
    // authoritative whenever it's reachable. A learner who moved their
    // cursor back on another device is simply AT that belt here too —
    // adopting a stale, further-ahead local value would violate "moving
    // the cursor back is simply AT that belt, no snap-forward".
    const remoteBelt = remoteData.beltIndex
    const remoteLegoId = remoteData.lastLegoId

    if (remoteBelt !== localBelt || remoteLegoId !== highestLegoId.value) {
      console.log('[BeltProgress] Adopting remote cursor position: belt', remoteBelt, 'lego', remoteLegoId)
      highestBeltIndex.value = remoteBelt
      highestLegoId.value = remoteLegoId
      lastLegoId.value = remoteLegoId
      saveProgressLocal()
    }

    return remoteBelt
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
  // PLAYING BELT (follows currently-playing content, not highest achieved)
  // ============================================================================

  const playingBeltIndex = ref(0)
  const playingSeedNumber = ref(0)

  const playingBelt = computed((): Belt => {
    const idx = Math.min(Math.max(playingBeltIndex.value, 0), BELTS.length - 1)
    return { ...BELTS[idx], index: idx }
  })

  // Progress within the current playing belt (0-100%)
  const playingBeltProgress = computed(() => {
    const idx = playingBeltIndex.value
    const currentThreshold = BELTS[idx]?.seedsRequired ?? 0
    const nextThreshold = idx + 1 < BELTS.length ? BELTS[idx + 1].seedsRequired : courseSeedCount.value
    const range = nextThreshold - currentThreshold
    if (range <= 0) return 100
    const progress = ((playingSeedNumber.value - currentThreshold) / range) * 100
    return Math.min(Math.max(progress, 0), 100)
  })

  const setPlayingPosition = (seedNumber: number) => {
    // Cap at the course's published max. Some callers (the manual
    // belt-skip button before the 2026-05-18 clamp) used to pass the
    // next belt's threshold verbatim, which for short courses (e.g.
    // zho_for_eng tops out at seed 350) would set the visual belt to
    // Black even though the course can't reach black. Cap here so any
    // future caller is safe by default.
    const cappedSeed = Math.min(Math.max(seedNumber, 0), courseSeedCount.value)
    playingBeltIndex.value = getBeltIndexForSeed(cappedSeed)
    playingSeedNumber.value = cappedSeed
  }

  // ============================================================================
  // BELT INFO (your belt = the current cursor position — no ratchet)
  //
  // The displayed belt IS the playing position — the belt of the LEGO the
  // current round introduced. ONE position, ONE belt. Belts are a POSITION
  // measure, NOT an award: jump-to-belt, LEGO-skip and cycle-skip give all the
  // nav flexibility, so a ratchet (max with highest) was unnecessary and
  // actively confusing — when the cursor moves back, the belt follows it
  // back. De-ratcheted with Tom 2026-05-30; highestBeltIndex itself stopped
  // ratcheting on 2026-07-04 (cursor-only model) — it now mirrors the same
  // cursor position as currentBelt, just fed via setLastLegoId instead of
  // setPlayingPosition.
  // ============================================================================

  const currentBelt = computed((): Belt => {
    const idx = Math.min(Math.max(playingBeltIndex.value, 0), BELTS.length - 1)
    return { ...BELTS[idx], index: idx }
  })

  // next/previous are relative to currentBelt (= the playing position) so
  // prompts like "next belt: green" stay coherent with the badge.
  const nextBelt = computed((): Belt | null => {
    const nextIndex = currentBelt.value.index + 1
    if (nextIndex >= availableBelts.value.length) return null
    return { ...BELTS[nextIndex], index: nextIndex }
  })

  const previousBelt = computed((): Belt | null => {
    const prevIndex = currentBelt.value.index - 1
    if (prevIndex < 0) return null
    return { ...BELTS[prevIndex], index: prevIndex }
  })

  // ============================================================================
  // PROGRESS CALCULATIONS (for display)
  // ============================================================================

  // Seed gap from current belt threshold to next belt threshold
  const seedsToNextBelt = computed(() => {
    if (!nextBelt.value) return 0
    return nextBelt.value.seedsRequired - currentBelt.value.seedsRequired
  })

  // Course progress based on current playing position
  const courseProgress = computed(() => {
    return Math.min((playingSeedNumber.value / courseSeedCount.value) * 100, 100)
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

    // Flush any pending debounced position sync immediately
    if (positionSyncTimer) {
      clearTimeout(positionSyncTimer)
      positionSyncTimer = null
      if (canSync()) {
        syncToRemote(highestBeltIndex.value)
      }
    }

    sessionStartTime.value = null
    sessionStartSeed.value = 0
  }

  // ============================================================================
  // PROGRESS UPDATES
  // ============================================================================

  /**
   * Move the belt to match a seed number — cursor-only model (2026-07-04):
   * highestBeltIndex mirrors the CURRENT cursor position, moving both
   * forward and back, rather than ratcheting to a "furthest ever" high
   * water mark. Still logs + returns the previous belt on a forward
   * crossing so callers can drive a promotion celebration.
   */
  const checkBeltPromotion = (seedNumber: number): Belt | null => {
    const beltForSeed = getBeltIndexForSeed(seedNumber)
    if (beltForSeed === highestBeltIndex.value) return null

    const previousBeltValue = currentBelt.value
    const promoted = beltForSeed > highestBeltIndex.value
    highestBeltIndex.value = beltForSeed
    saveProgress()
    if (promoted) {
      console.log(`[BeltProgress] 🎉 Belt promotion: ${previousBeltValue.name} → ${BELTS[beltForSeed].name}`)
      return previousBeltValue
    }
    return null
  }

  // Debounced remote sync for position updates (every 30s max)
  let positionSyncTimer: ReturnType<typeof setTimeout> | null = null

  const debouncedPositionSync = () => {
    if (!canSync()) return
    if (positionSyncTimer) return // Already scheduled
    positionSyncTimer = setTimeout(() => {
      positionSyncTimer = null
      syncToRemote(highestBeltIndex.value)
    }, 30000)
  }

  /**
   * Update resume position (call when player moves to a new LEGO).
   * Cursor-only model (2026-07-04): highestLegoId mirrors the CURRENT
   * cursor, moving both forward and back — there's no separate "furthest
   * reached" copy to preserve here (CourseBrowser / SettingsScreen /
   * PlayerContainer all read this as "where am I", not "how far did I get").
   */
  const setLastLegoId = (legoId: string | null) => {
    lastLegoId.value = legoId
    highestLegoId.value = legoId

    saveProgressLocal()

    // Debounced sync of position to Supabase for cross-device resume
    debouncedPositionSync()

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

  // highestBeltIndex mirrors the cursor (cursor-only model, 2026-07-04), so
  // "complete" here means "at or behind the cursor" — not a ratcheted
  // lifetime achievement. Moving the cursor back correctly un-completes belts.
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

  // Source from playingBelt (current cursor position), not currentBelt.
  //
  // Tom 2026-05-23: the TOP progress bar (chevron+counter) shows the
  // learner's current position in the course; manual skip back/forward
  // should visibly change the bar's belt colour. The pill (resting-state
  // belt badge) is the achievement view and ratchets via currentBelt.
  // These two surfaces are intentionally different.
  //
  // INFPLAY stays stable automatically: visualLegoIdForRound returns
  // lastMainLoopLegoId for infplay rounds (not the random USE), so the
  // setPlayingPosition fed to playingBeltIndex stays anchored at the
  // course-end belt — no flicker, even though INF PLAY samples random
  // earlier LEGOs.
  const beltCssVars = computed(() => ({
    '--belt-color': playingBelt.value.color,
    '--belt-color-dark': playingBelt.value.colorDark,
    '--belt-glow': playingBelt.value.glow,
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
    playingBelt,
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
    setPlayingPosition,
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

    // Course-aware belt filtering
    courseSeedCount,
    setCourseSeedCount,
    availableBelts,

    // Constants
    TOTAL_SEEDS,
    BELTS,

    // Backwards compatibility (deprecated, will be removed)
    // KEPT: "deprecated" label is aspirational — completedRounds /
    // setCurrentLegoId / etc. are ACTIVELY consumed (SettingsScreen,
    // LearningPlayer, HomeScreen). Future refactor, not a dead delete.
    completedRounds,
    currentLegoId,
    setCurrentLegoId,
    currentSeedNumber: computed(() => getSeedFromLegoId(lastLegoId.value)),
    getSeedFromLegoId: (id: string | null) => getSeedFromLegoId(id),
    beltProgress: playingBeltProgress,
  }
}

// ============================================================================
// SHARED INSTANCE
// ============================================================================

const sharedInstanceRef = shallowRef<ReturnType<typeof useBeltProgress> | null>(null)
let sharedCourseCode: string | null = null
let sharedSyncConfig: BeltProgressSyncConfig | null = null

// Unwrap a Ref-or-raw value the same way useBeltProgress' internal helpers do
// (lines 153-164). Lets us compare configs by leaf value instead of by
// reference identity — necessary because LearningPlayer creates a fresh
// `computed(() => learnerId.value)` on every mount.
function unwrapMaybeRef<T>(v: Ref<T> | T | null | undefined): T | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'object' && v !== null && 'value' in v) {
    return (v as Ref<T>).value
  }
  return v as T
}

function syncConfigsMatch(
  a: BeltProgressSyncConfig | null,
  b: BeltProgressSyncConfig | undefined,
): boolean {
  // unwrapMaybeRef pulls primitives or the underlying client out of a Ref;
  // comparing those by === is safe (and avoids JSON.stringify, which crashes
  // on Vue's reactive proxy graph: 'deps' → 'sub' → cycle).
  const aSb = unwrapMaybeRef(a?.supabase)
  const bSb = unwrapMaybeRef(b?.supabase)
  const aLi = unwrapMaybeRef(a?.learnerId)
  const bLi = unwrapMaybeRef(b?.learnerId)
  return aSb === bSb && aLi === bLi
}

export function useSharedBeltProgress(
  courseCode: string,
  syncConfig?: BeltProgressSyncConfig
): ReturnType<typeof useBeltProgress> {
  if (
    sharedInstanceRef.value &&
    sharedCourseCode === courseCode &&
    syncConfigsMatch(sharedSyncConfig, syncConfig)
  ) {
    return sharedInstanceRef.value
  }

  const instance = useBeltProgress(courseCode, syncConfig)
  sharedCourseCode = courseCode
  sharedSyncConfig = syncConfig ?? null
  instance.initializeSync()
  sharedInstanceRef.value = instance

  return instance
}

export function getSharedBeltProgress(): ReturnType<typeof useBeltProgress> | null {
  return sharedInstanceRef.value
}
