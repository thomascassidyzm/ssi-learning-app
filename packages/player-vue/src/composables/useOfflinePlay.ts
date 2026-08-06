/**
 * useOfflinePlay - Graceful degradation for never-fail playback
 *
 * When network fails or buffer depletes, seamlessly switches to infinite play
 * from cached content. User never sees an error - audio keeps playing.
 *
 * Degradation Hierarchy:
 * 1. Normal: Play next scheduled cycle
 * 2. Belt-only: Play any cached cycle from current belt
 * 3. USE phrases: Play any cached USE phrase (already mastered)
 * 4. Repeat: Keep repeating last successfully played cycle
 *
 * Features:
 * - Automatic online/offline detection
 * - Graceful degradation through hierarchy
 * - Recent item avoidance (don't repeat last 10)
 * - Seamless transition when coming back online
 * - Never shows connection errors - always keeps playing
 */

import { ref, computed, onMounted, onUnmounted } from 'vue'
import type { ScriptItem } from './useScriptCache'
import type { Cycle } from '../types/Cycle'

// ============================================================================
// TYPES
// ============================================================================

export type DegradationLevel = 'normal' | 'belt-only' | 'use-phrases' | 'repeat'

export interface OfflinePlayState {
  /** Is the device currently offline */
  isOffline: boolean
  /** Is infinite play mode active (offline or forced) */
  isInfinitePlay: boolean
  /** Number of items available for infinite play */
  cachedItemCount: number
  /** Recently played items (to avoid immediate repeats) */
  recentItemIds: string[]
  /** Current degradation level */
  degradationLevel: DegradationLevel
  /** Last successfully played cycle (for repeat fallback) */
  lastPlayedCycle: Cycle | null
}

export interface OfflinePlayConfig {
  /** Function to get all cached items from belt loader */
  getCachedItems: () => ScriptItem[]
  /** Function to get all cached cycles (for Cycle-based playback) */
  getCachedCycles?: () => Cycle[]
  /** Function to check if a cycle is fully cached */
  isCycleCached?: (cycle: Cycle) => boolean
  /** How many recent items to avoid repeating (default: 10) */
  recentAvoidCount?: number
  /** Force infinite play mode regardless of online status */
  forceInfinitePlay?: boolean
}

// ============================================================================
// COMPOSABLE
// ============================================================================

export function useOfflinePlay(config: OfflinePlayConfig) {
  const {
    getCachedItems,
    getCachedCycles,
    isCycleCached,
    recentAvoidCount = 10,
  } = config

  // State
  const isOnline = ref(navigator.onLine)
  const forceInfinitePlay = ref(false)
  const recentItemIds = ref<string[]>([])
  const degradationLevel = ref<DegradationLevel>('normal')
  const lastPlayedCycle = ref<Cycle | null>(null)
  const cachedCyclePool = ref<Cycle[]>([])

  // ============================================================================
  // ONLINE/OFFLINE DETECTION
  // ============================================================================

  const handleOnline = () => {
    console.log('[OfflinePlay] Network: online')
    isOnline.value = true
  }

  const handleOffline = () => {
    console.log('[OfflinePlay] Network: offline - switching to infinite play')
    isOnline.value = false
  }

  onMounted(() => {
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
  })

  onUnmounted(() => {
    window.removeEventListener('online', handleOnline)
    window.removeEventListener('offline', handleOffline)
  })

  // ============================================================================
  // INFINITE PLAY MODE
  // ============================================================================

  const isInfinitePlay = computed(() => {
    return !isOnline.value || forceInfinitePlay.value
  })

  const cachedItemCount = computed(() => {
    return getCachedItems().length
  })

  /**
   * Get the next item for infinite play mode.
   * Shuffles through cached items, avoiding recently played items.
   *
   * @returns ScriptItem or null if no cached items available
   */
  function getNextItemInfinite(): ScriptItem | null {
    const allItems = getCachedItems()

    if (allItems.length === 0) {
      console.warn('[OfflinePlay] No cached items available for infinite play')
      return null
    }

    // Filter out recently played items
    const recentSet = new Set(recentItemIds.value)
    const availableItems = allItems.filter(item => {
      const itemId = item.legoId || `${item.roundNumber}-${item.legoIndex}`
      return !recentSet.has(itemId)
    })

    // If all items are recent, just use all items
    const pool = availableItems.length > 0 ? availableItems : allItems

    // Random selection
    const randomIndex = Math.floor(Math.random() * pool.length)
    const selectedItem = pool[randomIndex]

    // Track as recently played
    const itemId = selectedItem.legoId || `${selectedItem.roundNumber}-${selectedItem.legoIndex}`
    recentItemIds.value.push(itemId)

    // Trim recent list to configured size
    if (recentItemIds.value.length > recentAvoidCount) {
      recentItemIds.value = recentItemIds.value.slice(-recentAvoidCount)
    }

    return selectedItem
  }

  /**
   * Enable forced infinite play mode (for testing/demo)
   */
  function enableInfinitePlay(): void {
    console.log('[OfflinePlay] Forcing infinite play mode')
    forceInfinitePlay.value = true
  }

  /**
   * Disable forced infinite play mode
   */
  function disableInfinitePlay(): void {
    console.log('[OfflinePlay] Disabling forced infinite play mode')
    forceInfinitePlay.value = false
  }

  /**
   * Toggle forced infinite play mode
   */
  function toggleInfinitePlay(): boolean {
    forceInfinitePlay.value = !forceInfinitePlay.value
    console.log('[OfflinePlay] Infinite play:', forceInfinitePlay.value ? 'enabled' : 'disabled')
    return forceInfinitePlay.value
  }

  /**
   * Clear recent items history (useful when resuming normal playback)
   */
  function clearRecentHistory(): void {
    recentItemIds.value = []
  }

  /**
   * Mark an item as recently played (for external tracking)
   */
  function markAsPlayed(item: ScriptItem): void {
    const itemId = item.legoId || `${item.roundNumber}-${item.legoIndex}`
    recentItemIds.value.push(itemId)

    if (recentItemIds.value.length > recentAvoidCount) {
      recentItemIds.value = recentItemIds.value.slice(-recentAvoidCount)
    }
  }

  // ============================================================================
  // GRACEFUL DEGRADATION (Cycle-based)
  // ============================================================================

  /**
   * Refresh the pool of cached cycles available for fallback playback
   */
  function refreshCachedPool(): void {
    if (!getCachedCycles || !isCycleCached) {
      cachedCyclePool.value = []
      return
    }

    const allCycles = getCachedCycles()
    cachedCyclePool.value = allCycles.filter(cycle => isCycleCached(cycle))
    console.log(`[OfflinePlay] Refreshed cached pool: ${cachedCyclePool.value.length} cycles available`)
  }

  /**
   * Mark a cycle as successfully played (for last-resort repeat fallback)
   */
  function markCycleAsPlayed(cycle: Cycle): void {
    lastPlayedCycle.value = cycle
    recentItemIds.value.push(cycle.id)

    if (recentItemIds.value.length > recentAvoidCount) {
      recentItemIds.value = recentItemIds.value.slice(-recentAvoidCount)
    }

    // Reset degradation level on successful play
    degradationLevel.value = 'normal'
  }

  /**
   * A-64 consecutive-repeat guard for the degradation ladder. `a64Recent`
   * holds the ids of the last two cycles handed out; when both are the same,
   * that id may not be handed out again.
   */
  const a64Recent: string[] = []
  const a64BannedCycleId = (): string | null =>
    a64Recent.length === 2 && a64Recent[0] === a64Recent[1] ? a64Recent[0] : null
  const noteA64 = (cycle: Cycle): Cycle => {
    a64Recent.push(cycle.id)
    if (a64Recent.length > 2) a64Recent.shift()
    return cycle
  }

  /**
   * Get next playable cycle using graceful degradation
   * NEVER returns null - always finds something to play
   *
   * Priority:
   * 1. scheduledCycle if provided and cached
   * 2. Any cached cycle from the pool (avoiding recent)
   * 3. Last successfully played cycle (repeat mode)
   */
  function getNextPlayableCycle(scheduledCycle?: Cycle): Cycle | null {
    // A-64 (Tom, 2026-08-06): the law binds the degradation ladder too — a
    // fallback that loops one cycle is the most literal breach in the app.
    // `bannedId` is the cycle we may not hand back again because it has
    // already played twice in a row.
    const bannedId = a64BannedCycleId()

    // Level 1: Try scheduled cycle
    if (scheduledCycle && isCycleCached?.(scheduledCycle)) {
      if (scheduledCycle.id !== bannedId) {
        degradationLevel.value = 'normal'
        return noteA64(scheduledCycle)
      }
      // Scheduled cycle would be a third consecutive play — fall through and
      // rotate to something else, then it comes back on the next call.
    }

    // Level 2: Try any cached cycle (belt-only mode)
    if (cachedCyclePool.value.length > 0) {
      const lawful = cachedCyclePool.value.filter(c => c.id !== bannedId)
      const recentSet = new Set(recentItemIds.value)
      const available = lawful.filter(c => !recentSet.has(c.id))

      // If all are recent, use any (still excluding the A-64-banned one)
      const pool = available.length > 0 ? available : lawful

      if (pool.length > 0) {
        const randomIndex = Math.floor(Math.random() * pool.length)
        degradationLevel.value = 'belt-only'
        console.log(`[OfflinePlay] Degraded to belt-only mode, ${pool.length} cycles available`)
        return noteA64(pool[randomIndex])
      }
    }

    // Level 3: Repeat last played cycle. Only one cycle exists to play, so the
    // cap and "never stall the session" collide — Tom's ruling is that the
    // session wins. Flag it loudly rather than going silent.
    if (lastPlayedCycle.value) {
      degradationLevel.value = 'repeat'
      if (lastPlayedCycle.value.id === bannedId) {
        console.warn('[OfflinePlay] A-64: only one cached cycle left — replaying it a third time to keep the session alive')
      } else {
        console.log('[OfflinePlay] Degraded to repeat mode - playing last successful cycle')
      }
      return noteA64(lastPlayedCycle.value)
    }

    // No fallback available (should be rare - only on first play offline with no cache)
    console.warn('[OfflinePlay] No cached cycles available for fallback')
    return null
  }

  /**
   * Check if we can play a specific cycle
   * Returns true if cached or online
   */
  function canPlayCycle(cycle: Cycle): boolean {
    if (isCycleCached?.(cycle)) {
      return true
    }
    return isOnline.value
  }

  /**
   * Get degradation status message for UI feedback
   */
  function getDegradationMessage(): string | null {
    switch (degradationLevel.value) {
      case 'normal':
        return null
      case 'belt-only':
        return 'Playing from your offline library'
      case 'use-phrases':
        return 'Reviewing mastered content while offline'
      case 'repeat':
        return 'Repeating last lesson - go online to continue'
      default:
        return null
    }
  }

  // ============================================================================
  // STATE
  // ============================================================================

  const state = computed<OfflinePlayState>(() => ({
    isOffline: !isOnline.value,
    isInfinitePlay: isInfinitePlay.value,
    cachedItemCount: cachedItemCount.value,
    recentItemIds: recentItemIds.value,
    degradationLevel: degradationLevel.value,
    lastPlayedCycle: lastPlayedCycle.value,
  }))

  return {
    // State
    state,
    isOnline,
    isInfinitePlay,
    forceInfinitePlay,
    cachedItemCount,
    recentItemIds,
    degradationLevel,
    lastPlayedCycle,

    // Actions (legacy ScriptItem-based)
    getNextItemInfinite,
    enableInfinitePlay,
    disableInfinitePlay,
    toggleInfinitePlay,
    clearRecentHistory,
    markAsPlayed,

    // Actions (Cycle-based graceful degradation)
    refreshCachedPool,
    markCycleAsPlayed,
    getNextPlayableCycle,
    canPlayCycle,
    getDegradationMessage,
  }
}

export type OfflinePlay = ReturnType<typeof useOfflinePlay>
