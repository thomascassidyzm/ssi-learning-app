/**
 * useFullCourseScript - Generate complete course script using RoundBuilder
 *
 * Used by CourseExplorer for admin/QA viewing of the full course structure.
 * Uses the same round building logic as the player (buildRounds from RoundBuilder).
 *
 * Features:
 * - Loads ALL LEGOs for a course (not paginated)
 * - Loads baskets for each LEGO
 * - Generates rounds using the player's exact logic
 * - Reports progress during loading (for large courses)
 */

import { ref, type Ref } from 'vue'
import type { LegoPair, SeedPair, ClassifiedBasket } from '@ssi/core'
import type { CourseDataProvider, LearningItem } from '../providers/CourseDataProvider'
import { buildRounds } from '../playback/RoundBuilder'
import { DEFAULT_PLAYBACK_CONFIG } from '../playback/PlaybackConfig'
import type { Round, ScriptItem } from '../playback/types'

export interface FullCourseScriptResult {
  rounds: Round[]
  allItems: FlatScriptItem[]
  totalLegos: number
  totalSeeds: number
}

export interface FlatScriptItem extends ScriptItem {
  roundNumber: number
  isRoundHeader?: boolean
  spacedRepReviews?: number[]
}

export interface LoadProgress {
  stage: 'legos' | 'baskets' | 'building' | 'done'
  current: number
  total: number
  message: string
}

/**
 * Generate complete course script using the player's exact round building logic
 */
export function useFullCourseScript() {
  const isLoading = ref(false)
  const progress = ref<LoadProgress>({ stage: 'legos', current: 0, total: 0, message: '' })
  const error = ref<string | null>(null)

  /**
   * Convert CourseDataProvider's LearningItem.lego to @ssi/core LegoPair
   */
  function convertToLegoPair(lego: LearningItem['lego']): LegoPair {
    return {
      id: lego.id,
      type: lego.type as 'A' | 'M',
      new: lego.new,
      lego: lego.lego,
      audioRefs: {
        known: { id: lego.audioRefs.known.id, url: lego.audioRefs.known.url },
        target: {
          voice1: { id: lego.audioRefs.target.voice1.id, url: lego.audioRefs.target.voice1.url },
          voice2: { id: lego.audioRefs.target.voice2.id, url: lego.audioRefs.target.voice2.url },
        },
      },
    }
  }

  /**
   * Extract unique seeds from LearningItems and convert to SeedPair
   */
  function extractSeedsFromLearningItems(items: LearningItem[]): SeedPair[] {
    const seedMap = new Map<string, { seed_id: string; legos: LegoPair[]; seed_pair: { known: string; target: string } }>()

    for (const item of items) {
      const seedData = item.seed
      if (!seedData) continue

      if (!seedMap.has(seedData.seed_id)) {
        seedMap.set(seedData.seed_id, {
          seed_id: seedData.seed_id,
          seed_pair: seedData.seed_pair,
          legos: [],
        })
      }

      // Add this LEGO to the seed's legos array
      const seedEntry = seedMap.get(seedData.seed_id)!
      const legoPair = convertToLegoPair(item.lego)
      if (!seedEntry.legos.some(l => l.id === legoPair.id)) {
        seedEntry.legos.push(legoPair)
      }
    }

    return Array.from(seedMap.values()).map(entry => ({
      seed_id: entry.seed_id,
      seed_pair: entry.seed_pair,
      legos: entry.legos,
    }))
  }

  /**
   * Extract LEGOs from LearningItems and convert to LegoPair
   */
  function extractLegosFromLearningItems(items: LearningItem[]): LegoPair[] {
    const legoMap = new Map<string, LegoPair>()

    for (const item of items) {
      if (item.lego && !legoMap.has(item.lego.id)) {
        legoMap.set(item.lego.id, convertToLegoPair(item.lego))
      }
    }

    return Array.from(legoMap.values())
  }

  /**
   * Build audio URL from audio ID (using proxy for CORS)
   */
  function buildAudioUrl(audioId: string, courseId: string): string {
    if (!audioId) return ''
    return `/api/audio/${audioId}?courseId=${encodeURIComponent(courseId)}`
  }

  /**
   * Load all LEGOs for a course (handles pagination internally)
   */
  async function loadAllLegos(
    provider: CourseDataProvider
  ): Promise<LearningItem[]> {
    const allItems: LearningItem[] = []
    const pageSize = 500
    let offset = 0
    let hasMore = true

    while (hasMore) {
      progress.value = {
        stage: 'legos',
        current: allItems.length,
        total: 0, // Unknown until we're done
        message: `Loading LEGOs... (${allItems.length} loaded)`,
      }

      const items = await provider.loadAllUniqueLegos(pageSize, offset)

      if (items.length === 0) {
        hasMore = false
      } else {
        allItems.push(...items)
        offset += pageSize

        // If we got fewer items than requested, we're done
        if (items.length < pageSize) {
          hasMore = false
        }
      }
    }

    progress.value = {
      stage: 'legos',
      current: allItems.length,
      total: allItems.length,
      message: `Loaded ${allItems.length} LEGOs`,
    }

    return allItems
  }

  /**
   * Load baskets for all LEGOs
   */
  async function loadAllBaskets(
    provider: CourseDataProvider,
    legos: LegoPair[]
  ): Promise<Map<string, ClassifiedBasket>> {
    const basketMap = new Map<string, ClassifiedBasket>()
    const total = legos.length

    // Load baskets in batches to avoid overwhelming the server
    const batchSize = 10
    for (let i = 0; i < legos.length; i += batchSize) {
      const batch = legos.slice(i, i + batchSize)

      progress.value = {
        stage: 'baskets',
        current: i,
        total,
        message: `Loading practice phrases... (${i}/${total})`,
      }

      // Load batch in parallel
      const promises = batch.map(async (lego) => {
        try {
          const basket = await provider.getLegoBasket(lego.id, lego)
          if (basket) {
            basketMap.set(lego.id, basket)
          }
        } catch (err) {
          console.warn(`[useFullCourseScript] Failed to load basket for ${lego.id}:`, err)
        }
      })

      await Promise.all(promises)
    }

    progress.value = {
      stage: 'baskets',
      current: total,
      total,
      message: `Loaded ${basketMap.size} baskets`,
    }

    return basketMap
  }

  /**
   * Flatten rounds into single item list with round markers
   */
  function flattenRounds(rounds: Round[]): FlatScriptItem[] {
    const flat: FlatScriptItem[] = []

    for (const round of rounds) {
      // Add round header as special item
      // Cast through unknown since this is intentionally a header-only item
      flat.push({
        isRoundHeader: true,
        roundNumber: round.roundNumber,
        legoId: round.legoId,
        seedId: round.seedId,
        spacedRepReviews: round.spacedRepReviews || [],
        type: 'intro',
        legoIndex: round.legoIndex,
      } as unknown as FlatScriptItem)

      // Add all items with round context
      for (const item of round.items) {
        flat.push({
          ...item,
          roundNumber: round.roundNumber,
        } as FlatScriptItem)
      }
    }

    return flat
  }

  /**
   * Generate the full course script
   */
  async function generateScript(
    provider: CourseDataProvider,
    courseCode: string
  ): Promise<FullCourseScriptResult> {
    isLoading.value = true
    error.value = null

    try {
      // 1. Load all LEGOs
      console.log('[useFullCourseScript] Loading all LEGOs...')
      const learningItems = await loadAllLegos(provider)
      console.log(`[useFullCourseScript] Loaded ${learningItems.length} learning items`)

      // 2. Extract LEGOs and Seeds
      const legos = extractLegosFromLearningItems(learningItems)
      const seeds = extractSeedsFromLearningItems(learningItems)
      console.log(`[useFullCourseScript] Extracted ${legos.length} LEGOs, ${seeds.length} seeds`)

      // 3. Load baskets for each LEGO
      console.log('[useFullCourseScript] Loading baskets...')
      const baskets = await loadAllBaskets(provider, legos)
      console.log(`[useFullCourseScript] Loaded ${baskets.size} baskets`)

      // 4. Build rounds using the player's exact logic
      progress.value = {
        stage: 'building',
        current: 0,
        total: legos.length,
        message: 'Building rounds...',
      }

      console.log('[useFullCourseScript] Building rounds...')
      const rounds = buildRounds(
        legos,
        seeds,
        baskets,
        {
          ...DEFAULT_PLAYBACK_CONFIG,
          // For QA view, include everything
          skipIntros: false,
          turboMode: false,
          maxBuildPhrases: 7, // Show all build phrases
          consolidationCount: 2, // Show consolidation
        },
        (audioId) => buildAudioUrl(audioId, courseCode),
        1 // Start from round 1
      )
      console.log(`[useFullCourseScript] Built ${rounds.length} rounds`)

      // 5. Flatten for display
      const allItems = flattenRounds(rounds)

      progress.value = {
        stage: 'done',
        current: rounds.length,
        total: rounds.length,
        message: `Generated ${rounds.length} rounds with ${allItems.length} items`,
      }

      return {
        rounds,
        allItems,
        totalLegos: legos.length,
        totalSeeds: seeds.length,
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
