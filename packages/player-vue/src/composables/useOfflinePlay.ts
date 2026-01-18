/**
 * useOfflinePlay - Infinite play mode for offline resilience
 *
 * When offline, seamlessly cycles through all cached content indefinitely.
 * No blocking, no waiting - degradation is invisible to the user.
 *
 * Features:
 * - Automatic online/offline detection
 * - Shuffled playback from cached items
 * - Recent item avoidance (don't repeat last 10)
 * - Seamless transition when coming back online
 */

import { ref, computed, onMounted, onUnmounted } from 'vue'
import type { ScriptItem } from './useScriptCache'

// ============================================================================
// TYPES
// ============================================================================

export interface OfflinePlayState {
  /** Is the device currently offline */
  isOffline: boolean
  /** Is infinite play mode active (offline or forced) */
  isInfinitePlay: boolean
  /** Number of items available for infinite play */
  cachedItemCount: number
  /** Recently played items (to avoid immediate repeats) */
  recentItemIds: string[]
}

export interface OfflinePlayConfig {
  /** Function to get all cached items from belt loader */
  getCachedItems: () => ScriptItem[]
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
    recentAvoidCount = 10,
  } = config

  // State
  const isOnline = ref(navigator.onLine)
  const forceInfinitePlay = ref(false)
  const recentItemIds = ref<string[]>([])

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
  // STATE
  // ============================================================================

  const state = computed<OfflinePlayState>(() => ({
    isOffline: !isOnline.value,
    isInfinitePlay: isInfinitePlay.value,
    cachedItemCount: cachedItemCount.value,
    recentItemIds: recentItemIds.value,
  }))

  return {
    // State
    state,
    isOnline,
    isInfinitePlay,
    forceInfinitePlay,
    cachedItemCount,
    recentItemIds,

    // Actions
    getNextItemInfinite,
    enableInfinitePlay,
    disableInfinitePlay,
    toggleInfinitePlay,
    clearRecentHistory,
    markAsPlayed,
  }
}

export type OfflinePlay = ReturnType<typeof useOfflinePlay>
