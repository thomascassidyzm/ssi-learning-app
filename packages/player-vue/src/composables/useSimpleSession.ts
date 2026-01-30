/**
 * useSimpleSession - Simple session management using generateLearningScript
 *
 * Replaces the complex RoundBuilder/adapter chain with direct database queries.
 * Same logic as dashboard's Script Viewer.
 */

import { ref, computed } from 'vue'
import type { SupabaseClient } from '@supabase/supabase-js'
import { generateLearningScript, type ScriptItem } from '../providers/generateLearningScript'
import { toSimpleRounds } from '../providers/toSimpleRounds'
import type { Round } from '../playback/SimplePlayer'

export interface UseSimpleSessionOptions {
  supabase: SupabaseClient
  courseCode: string
}

export function useSimpleSession(options: UseSimpleSessionOptions) {
  const { supabase, courseCode } = options

  // State
  const isLoading = ref(false)
  const error = ref<string | null>(null)
  const rounds = ref<Round[]>([])
  const scriptItems = ref<ScriptItem[]>([])

  // Stats
  const totalRounds = computed(() => rounds.value.length)
  const totalItems = computed(() => scriptItems.value.length)
  const itemsWithAudio = computed(() => scriptItems.value.filter(i => i.hasAudio).length)

  // Storage key for resume
  const STORAGE_KEY = `ssi_session_${courseCode}`

  /**
   * Get last position from localStorage
   */
  function getLastPosition(): { roundNumber: number; legoKey: string } | null {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        return JSON.parse(stored)
      }
    } catch {
      // Ignore parse errors
    }
    return null
  }

  /**
   * Save current position to localStorage
   */
  function savePosition(roundNumber: number, legoKey: string): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ roundNumber, legoKey }))
    } catch {
      // Ignore storage errors
    }
  }

  /**
   * Clear saved position
   */
  function clearPosition(): void {
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {
      // Ignore
    }
  }

  /**
   * Load session from a starting seed
   * Returns the round index to start from (for resume)
   */
  async function loadSession(startSeed: number = 1, endSeed: number = 50): Promise<number> {
    isLoading.value = true
    error.value = null

    try {
      console.log(`[useSimpleSession] Loading ${courseCode} seeds ${startSeed}-${endSeed}`)

      const result = await generateLearningScript(supabase, courseCode, startSeed, endSeed)
      scriptItems.value = result.items
      rounds.value = toSimpleRounds(result.items)

      console.log(`[useSimpleSession] Loaded ${rounds.value.length} rounds, ${result.items.length} items (${itemsWithAudio.value} with audio)`)

      // Check for resume position
      const lastPos = getLastPosition()
      if (lastPos) {
        const resumeIndex = rounds.value.findIndex(r => r.roundNumber === lastPos.roundNumber)
        if (resumeIndex >= 0) {
          console.log(`[useSimpleSession] Resuming at round ${lastPos.roundNumber} (index ${resumeIndex})`)
          return resumeIndex
        }
      }

      return 0
    } catch (err) {
      console.error('[useSimpleSession] Error:', err)
      error.value = err instanceof Error ? err.message : 'Failed to load session'
      throw err
    } finally {
      isLoading.value = false
    }
  }

  /**
   * Load more rounds (for lazy loading)
   */
  async function loadMore(startSeed: number, endSeed: number): Promise<void> {
    try {
      const result = await generateLearningScript(supabase, courseCode, startSeed, endSeed)

      // Merge new items (avoid duplicates by roundNumber)
      const existingRoundNumbers = new Set(rounds.value.map(r => r.roundNumber))
      const newRounds = toSimpleRounds(result.items).filter(r => !existingRoundNumbers.has(r.roundNumber))

      if (newRounds.length > 0) {
        rounds.value = [...rounds.value, ...newRounds].sort((a, b) => a.roundNumber - b.roundNumber)
        scriptItems.value = [...scriptItems.value, ...result.items]
        console.log(`[useSimpleSession] Loaded ${newRounds.length} more rounds (total: ${rounds.value.length})`)
      }
    } catch (err) {
      console.error('[useSimpleSession] Error loading more:', err)
    }
  }

  /**
   * Get round by number
   */
  function getRound(roundNumber: number): Round | undefined {
    return rounds.value.find(r => r.roundNumber === roundNumber)
  }

  /**
   * Get round by index
   */
  function getRoundByIndex(index: number): Round | undefined {
    return rounds.value[index]
  }

  /**
   * Check if a round is loaded
   */
  function hasRound(roundNumber: number): boolean {
    return rounds.value.some(r => r.roundNumber === roundNumber)
  }

  return {
    // State
    isLoading,
    error,
    rounds,
    scriptItems,

    // Computed
    totalRounds,
    totalItems,
    itemsWithAudio,

    // Methods
    loadSession,
    loadMore,
    getRound,
    getRoundByIndex,
    hasRound,
    savePosition,
    clearPosition,
    getLastPosition,
  }
}
