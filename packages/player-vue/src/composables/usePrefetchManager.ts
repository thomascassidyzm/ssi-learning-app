/**
 * usePrefetchManager - Smart prefetching for 30-minute audio buffer
 *
 * Maintains a rolling buffer of cached audio ahead of playback position.
 * Ensures smooth playback even with network interruptions.
 *
 * Strategy:
 * 1. When cycle completes, check buffer health
 * 2. If buffer < 30 min, prefetch next batch of cycles
 * 3. Prefetch in priority order: known → target1 → target2
 * 4. Fire-and-forget - never interrupt playback for prefetch
 */

import { ref, computed, type Ref, type ComputedRef } from 'vue'
import type { Cycle } from '../types/Cycle'
import { AUDIO_CONFIG } from '../config/audioConfig'

// ============================================================================
// TYPES
// ============================================================================

export interface PrefetchManagerState {
  /** Estimated buffer in minutes */
  bufferMinutes: number
  /** Set of prefetched cycle IDs */
  prefetchedCycleIds: Set<string>
  /** Currently prefetching */
  isPrefetching: boolean
  /** Last prefetch error (null if none) */
  lastError: string | null
  /** Number of audio files prefetched this session */
  totalPrefetched: number
}

export interface PrefetchManagerConfig {
  /** Target buffer in minutes (default: 30) */
  targetBufferMinutes?: number
  /** Number of cycles to prefetch per batch (default: 20) */
  batchSize?: number
  /** Function to cache audio by ID */
  cacheAudio: (audioId: string) => Promise<void>
  /** Function to check if audio is cached */
  isAudioCached: (audioId: string) => boolean
  /** Average cycle duration in ms (default: 11000) */
  avgCycleDurationMs?: number
}

// ============================================================================
// COMPOSABLE
// ============================================================================

export function usePrefetchManager(config: PrefetchManagerConfig) {
  const {
    targetBufferMinutes = AUDIO_CONFIG.prefetchBufferMinutes,
    batchSize = AUDIO_CONFIG.prefetchBatchSize,
    cacheAudio,
    isAudioCached,
    avgCycleDurationMs = 11000,  // ~11 seconds per cycle
  } = config

  // State
  const bufferMinutes = ref(0)
  const prefetchedCycleIds = ref<Set<string>>(new Set())
  const isPrefetching = ref(false)
  const lastError = ref<string | null>(null)
  const totalPrefetched = ref(0)

  // ============================================================================
  // BUFFER CALCULATION
  // ============================================================================

  /**
   * Calculate buffer in minutes from current position
   */
  function calculateBuffer(currentIndex: number, allCycles: Cycle[]): number {
    let cachedCount = 0
    const remaining = allCycles.slice(currentIndex + 1)

    for (const cycle of remaining) {
      if (isCycleFullyCached(cycle)) {
        cachedCount++
      } else {
        break  // Stop counting at first uncached cycle
      }
    }

    // Convert cycles to minutes
    const bufferMs = cachedCount * avgCycleDurationMs
    return bufferMs / 60000
  }

  /**
   * Check if all audio for a cycle is cached
   */
  function isCycleFullyCached(cycle: Cycle): boolean {
    return (
      isAudioCached(cycle.known.audioId) &&
      isAudioCached(cycle.target.voice1AudioId) &&
      isAudioCached(cycle.target.voice2AudioId)
    )
  }

  // ============================================================================
  // PREFETCHING
  // ============================================================================

  /**
   * Prefetch a single cycle's audio files
   * Priority: known → target1 → target2
   */
  async function prefetchCycle(cycle: Cycle): Promise<void> {
    const audioIds = [
      cycle.known.audioId,
      cycle.target.voice1AudioId,
      cycle.target.voice2AudioId,
    ]

    for (const audioId of audioIds) {
      if (!isAudioCached(audioId)) {
        try {
          await cacheAudio(audioId)
          totalPrefetched.value++
        } catch (err) {
          // Log but don't fail - continue with other files
          console.warn(`[Prefetch] Failed to cache ${audioId}:`, err)
        }
      }
    }

    prefetchedCycleIds.value.add(cycle.id)
  }

  /**
   * Ensure buffer is maintained - call this after each cycle completes
   * Silent operation - errors are logged but don't interrupt playback
   */
  async function ensureBuffer(
    currentCycleIndex: number,
    allCycles: Cycle[]
  ): Promise<void> {
    // Update buffer calculation
    bufferMinutes.value = calculateBuffer(currentCycleIndex, allCycles)

    // Check if buffer is healthy
    if (bufferMinutes.value >= targetBufferMinutes) {
      return  // Buffer is healthy
    }

    // Already prefetching
    if (isPrefetching.value) {
      return
    }

    isPrefetching.value = true
    lastError.value = null

    try {
      // Find cycles that need prefetching
      const startIndex = currentCycleIndex + 1
      const cyclesToPrefetch: Cycle[] = []

      for (let i = startIndex; i < allCycles.length && cyclesToPrefetch.length < batchSize; i++) {
        const cycle = allCycles[i]
        if (!prefetchedCycleIds.value.has(cycle.id) && !isCycleFullyCached(cycle)) {
          cyclesToPrefetch.push(cycle)
        }
      }

      if (cyclesToPrefetch.length === 0) {
        // Nothing to prefetch
        return
      }

      console.log(`[Prefetch] Prefetching ${cyclesToPrefetch.length} cycles (buffer: ${bufferMinutes.value.toFixed(1)} min)`)

      // Prefetch in parallel (but not too many at once)
      const parallelLimit = 3
      for (let i = 0; i < cyclesToPrefetch.length; i += parallelLimit) {
        const batch = cyclesToPrefetch.slice(i, i + parallelLimit)
        await Promise.allSettled(batch.map(cycle => prefetchCycle(cycle)))
      }

      // Recalculate buffer after prefetch
      bufferMinutes.value = calculateBuffer(currentCycleIndex, allCycles)
      console.log(`[Prefetch] Complete. Buffer now: ${bufferMinutes.value.toFixed(1)} min`)

    } catch (err) {
      lastError.value = err instanceof Error ? err.message : 'Prefetch failed'
      console.warn('[Prefetch] Error during prefetch:', err)
      // Don't throw - prefetch errors should never interrupt playback
    } finally {
      isPrefetching.value = false
    }
  }

  /**
   * Force prefetch a specific cycle immediately
   * Use this when about to play a cycle that might not be cached
   */
  async function prefetchNow(cycle: Cycle): Promise<boolean> {
    try {
      await prefetchCycle(cycle)
      return isCycleFullyCached(cycle)
    } catch (err) {
      console.warn('[Prefetch] prefetchNow failed:', err)
      return false
    }
  }

  /**
   * Get all audio IDs for a cycle
   */
  function getCycleAudioIds(cycle: Cycle): string[] {
    return [
      cycle.known.audioId,
      cycle.target.voice1AudioId,
      cycle.target.voice2AudioId,
    ]
  }

  /**
   * Check which audio IDs are missing for a cycle
   */
  function getMissingAudioIds(cycle: Cycle): string[] {
    return getCycleAudioIds(cycle).filter(id => !isAudioCached(id))
  }

  /**
   * Reset prefetch state (e.g., when switching courses)
   */
  function reset(): void {
    bufferMinutes.value = 0
    prefetchedCycleIds.value.clear()
    isPrefetching.value = false
    lastError.value = null
    totalPrefetched.value = 0
  }

  // ============================================================================
  // COMPUTED
  // ============================================================================

  const isBufferHealthy = computed(() => {
    return bufferMinutes.value >= targetBufferMinutes * 0.67  // 20 min for 30 min target
  })

  const isBufferCritical = computed(() => {
    return bufferMinutes.value < 5  // Less than 5 minutes
  })

  const state = computed<PrefetchManagerState>(() => ({
    bufferMinutes: bufferMinutes.value,
    prefetchedCycleIds: prefetchedCycleIds.value,
    isPrefetching: isPrefetching.value,
    lastError: lastError.value,
    totalPrefetched: totalPrefetched.value,
  }))

  // ============================================================================
  // RETURN
  // ============================================================================

  return {
    // State
    state,
    bufferMinutes,
    isPrefetching,
    lastError,
    totalPrefetched,

    // Computed
    isBufferHealthy,
    isBufferCritical,

    // Actions
    ensureBuffer,
    prefetchNow,
    prefetchCycle,
    isCycleFullyCached,
    getMissingAudioIds,
    getCycleAudioIds,
    reset,
  }
}

export type PrefetchManager = ReturnType<typeof usePrefetchManager>
