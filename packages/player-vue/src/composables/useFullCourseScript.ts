/**
 * useFullCourseScript - Generate complete course script using generateLearningScript
 *
 * Used by CourseExplorer for admin/QA viewing of the full course structure.
 *
 * **Now uses the same generator the player uses** — `generateLearningScript`
 * via the providers/ module. This is critical: the script viewer must show
 * what the player actually plays, including Listening Pods (Layer 2),
 * bookends, and Layer 1 listening cycles, with the correct ordering and
 * per-cycle playback speeds. The previous implementation used RoundBuilder
 * which had no pod / bookend handling and silently diverged from playback.
 *
 * The output is shaped to the legacy `Round[]` interface CourseExplorer
 * already consumes (audioRefs object, presentationAudio object, items
 * grouped per round) so the consuming UI didn't need to change.
 */

import { ref } from 'vue'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  generateLearningScript,
  type ScriptItem,
} from '../providers/generateLearningScript'

export interface AdaptedAudioRef {
  id: string
  url: string
}

export interface AdaptedItem {
  type: string
  legoId: string
  seedId: string
  legoIndex: number
  knownText: string
  targetText: string
  audioRefs: {
    known: AdaptedAudioRef | null
    target: {
      voice1: AdaptedAudioRef | null
      voice2: AdaptedAudioRef | null
    }
  }
  presentationAudio: AdaptedAudioRef | null
  components?: unknown
  reviewOf: string | null
  fibonacciPosition: number | null
  playbackSpeed?: number
  // Carry the original ScriptItem too so consumers can read pod-specific fields
  uuid: string
}

export interface AdaptedRound {
  roundNumber: number
  legoId: string
  seedId: string
  legoIndex: number
  spacedRepReviews: number[]
  items: AdaptedItem[]
}

export interface FullCourseScriptResult {
  rounds: AdaptedRound[]
  allItems: AdaptedItem[]
  totalLegos: number
  totalSeeds: number
}

export interface LoadProgress {
  stage: 'loading' | 'building' | 'done'
  current: number
  total: number
  message: string
}

export function useFullCourseScript() {
  const isLoading = ref(false)
  const progress = ref<LoadProgress>({ stage: 'loading', current: 0, total: 0, message: '' })
  const error = ref<string | null>(null)

  const audioUrl = (id: string | undefined, courseCode: string): string =>
    id ? `/api/audio/${id}?courseId=${encodeURIComponent(courseCode)}` : ''

  const audioRef = (id: string | undefined, courseCode: string): AdaptedAudioRef | null =>
    id ? { id, url: audioUrl(id, courseCode) } : null

  const adaptItem = (item: ScriptItem, courseCode: string): AdaptedItem => ({
    type: item.type,
    legoId: item.legoKey || '',
    seedId: item.seedId || '',
    legoIndex: 0, // not on ScriptItem in the new path; legoKey carries the position
    knownText: item.knownText || '',
    targetText: item.targetText || '',
    audioRefs: {
      known: audioRef(item.knownAudioId, courseCode),
      target: {
        voice1: audioRef(item.target1Id, courseCode),
        voice2: audioRef(item.target2Id, courseCode),
      },
    },
    presentationAudio: audioRef(item.presentationAudioId, courseCode),
    components: (item as any).components,
    reviewOf: (item as any).reviewOf ?? null,
    fibonacciPosition: (item as any).fibonacciPosition ?? null,
    playbackSpeed: item.playbackSpeed,
    uuid: item.uuid,
  })

  /**
   * Generate the full course script via the player's generator.
   *
   * `endSeed = 9999` covers any course size (the generator caps internally
   * at the actual seeds available). `emitFromRound = 1` ensures we emit
   * the entire script, not a subset.
   */
  async function generateScript(
    supabase: SupabaseClient | null,
    courseCode: string
  ): Promise<FullCourseScriptResult> {
    isLoading.value = true
    error.value = null

    if (!supabase) {
      error.value = 'No supabase client available'
      isLoading.value = false
      throw new Error(error.value)
    }

    try {
      progress.value = { stage: 'loading', current: 0, total: 0, message: 'Generating full course script...' }

      const result = await generateLearningScript(supabase, courseCode)

      progress.value = { stage: 'building', current: 0, total: result.items.length, message: 'Grouping rounds...' }

      // Group items by roundNumber
      const roundMap = new Map<number, ScriptItem[]>()
      for (const item of result.items) {
        if (!roundMap.has(item.roundNumber)) roundMap.set(item.roundNumber, [])
        roundMap.get(item.roundNumber)!.push(item)
      }

      const rounds: AdaptedRound[] = []
      const allItems: AdaptedItem[] = []
      const sortedRoundNums = [...roundMap.keys()].sort((a, b) => a - b)
      const seedSet = new Set<string>()

      for (const r of sortedRoundNums) {
        const roundItems = roundMap.get(r)!
        // Pick the round's "primary" lego/seed from the first non-listening item
        const primary = roundItems.find(i => i.type === 'intro') || roundItems[0]
        const adaptedItems = roundItems.map(i => adaptItem(i, courseCode))
        rounds.push({
          roundNumber: r,
          legoId: primary?.legoKey || '',
          seedId: primary?.seedId || '',
          legoIndex: 0,
          spacedRepReviews: [],
          items: adaptedItems,
        })
        for (const item of roundItems) if (item.seedId) seedSet.add(item.seedId)
        allItems.push(...adaptedItems)
      }

      progress.value = {
        stage: 'done',
        current: rounds.length,
        total: rounds.length,
        message: `Generated ${rounds.length} rounds with ${allItems.length} items`,
      }

      return {
        rounds,
        allItems,
        totalLegos: rounds.length, // 1 LEGO introduction = 1 round in the new model
        totalSeeds: seedSet.size,
      }
    } catch (err) {
      console.error('[useFullCourseScript] Error generating script:', err)
      error.value = err instanceof Error ? err.message : 'Failed to generate script'
      throw err
    } finally {
      isLoading.value = false
    }
  }

  return {
    generateScript,
    isLoading,
    progress,
    error,
  }
}
