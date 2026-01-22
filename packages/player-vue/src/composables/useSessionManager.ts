/**
 * useSessionManager.ts - Session and cycle queue management
 *
 * Handles progression through a sequence of cycles without managing playback.
 * Playback is delegated to CyclePlayer/useCyclePlayback.
 */

import { ref, computed, type Ref } from 'vue'
import type { Cycle } from '../types/Cycle'

export interface UseSessionManagerOptions {
  /** Initial cycle array */
  cycles: Cycle[]
  /** Optional starting index */
  startIndex?: number
}

export interface UseSessionManager {
  /** Current cycle index in the session */
  currentIndex: Ref<number>
  /** All cycles in this session */
  cycles: Ref<Cycle[]>
  /** Whether the session is complete */
  isComplete: Ref<boolean>
  /** Progress percentage (0-100) */
  progressPercent: Ref<number>

  /** Get the current cycle, or null if session complete */
  getCurrentCycle: () => Cycle | null
  /** Get the next cycle without advancing, or null if at end */
  getNextCycle: () => Cycle | null
  /** Mark current cycle as complete and advance to next */
  markCycleComplete: () => void
  /** Skip current cycle without marking complete */
  skipToNext: () => void
  /** Jump to specific cycle index */
  jumpTo: (index: number) => void
  /** Reset session to beginning */
  reset: () => void
}

/**
 * Composable for managing session progression through cycles
 */
export function useSessionManager(
  options: UseSessionManagerOptions
): UseSessionManager {
  const currentIndex = ref(options.startIndex ?? 0)
  const cycles = ref(options.cycles)

  const isComplete = computed(() => currentIndex.value >= cycles.value.length)

  const progressPercent = computed(() => {
    if (cycles.value.length === 0) return 0
    return Math.round((currentIndex.value / cycles.value.length) * 100)
  })

  function getCurrentCycle(): Cycle | null {
    if (isComplete.value) return null
    return cycles.value[currentIndex.value] ?? null
  }

  function getNextCycle(): Cycle | null {
    const nextIndex = currentIndex.value + 1
    if (nextIndex >= cycles.value.length) return null
    return cycles.value[nextIndex] ?? null
  }

  function markCycleComplete(): void {
    if (!isComplete.value) {
      currentIndex.value++
    }
  }

  function skipToNext(): void {
    if (!isComplete.value) {
      currentIndex.value++
    }
  }

  function jumpTo(index: number): void {
    if (index >= 0 && index < cycles.value.length) {
      currentIndex.value = index
    }
  }

  function reset(): void {
    currentIndex.value = options.startIndex ?? 0
  }

  return {
    currentIndex,
    cycles,
    isComplete,
    progressPercent,
    getCurrentCycle,
    getNextCycle,
    markCycleComplete,
    skipToNext,
    jumpTo,
    reset
  }
}
