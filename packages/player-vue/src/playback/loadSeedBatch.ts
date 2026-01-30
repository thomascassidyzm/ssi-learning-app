/**
 * loadSeedBatch - Load a range of seeds and build rounds for SimplePlayer
 *
 * Used by priority loading to load seeds in batches.
 * Each batch is independent - can be loaded and added to SimplePlayer separately.
 */

import type { LegoPair, SeedPair, ClassifiedBasket } from '@ssi/core'
import type { CourseDataProvider, LearningItem } from '../providers/CourseDataProvider'
import type { Round as BuilderRound } from './types'
import type { Round as SimpleRound } from './SimplePlayer'
import { buildRounds } from './RoundBuilder'
import { adaptRoundsForPlayer } from './roundAdapter'
import { DEFAULT_PLAYBACK_CONFIG, type PlaybackConfig } from './PlaybackConfig'

export interface BatchLoadResult {
  simpleRounds: SimpleRound[]
  builderRounds: BuilderRound[]
  legoMap: Map<string, LegoPair>
  seedMap: Map<string, SeedPair>
  baskets: Map<string, ClassifiedBasket>
  seedCount: number
  legoCount: number
}

export interface BatchLoadOptions {
  provider: CourseDataProvider
  startSeed: number
  endSeed: number
  startRoundNumber?: number
  config?: PlaybackConfig
  /** Existing data from previous batches (for spaced rep) */
  existingLegoMap?: Map<string, LegoPair>
  existingSeedMap?: Map<string, SeedPair>
  existingBaskets?: Map<string, ClassifiedBasket>
}

/**
 * Load a range of seeds and build rounds for SimplePlayer
 */
export async function loadSeedBatch(options: BatchLoadOptions): Promise<BatchLoadResult | null> {
  const {
    provider,
    startSeed,
    endSeed,
    startRoundNumber = 1,
    config = DEFAULT_PLAYBACK_CONFIG,
    existingLegoMap = new Map(),
    existingSeedMap = new Map(),
    existingBaskets = new Map(),
  } = options

  // 1. Load learning items for this seed range
  const items = await provider.loadLegoRange(startSeed, endSeed)

  if (!items || items.length === 0) {
    console.log(`[loadSeedBatch] No items found for seeds ${startSeed}-${endSeed}`)
    return null
  }

  console.log(`[loadSeedBatch] Loaded ${items.length} items for seeds ${startSeed}-${endSeed}`)

  // 2. Convert to LegoPair[] and SeedPair[], merging with existing data
  const legoMap = new Map(existingLegoMap)
  const seedMap = new Map(existingSeedMap)

  for (const item of items) {
    // Convert to LegoPair format
    if (!legoMap.has(item.lego.id)) {
      legoMap.set(item.lego.id, {
        id: item.lego.id,
        type: item.lego.type as 'A' | 'M',
        new: item.lego.new,
        lego: item.lego.lego,
        audioRefs: {
          known: { id: item.lego.audioRefs.known.id, url: item.lego.audioRefs.known.url },
          target: {
            voice1: { id: item.lego.audioRefs.target.voice1.id, url: item.lego.audioRefs.target.voice1.url },
            voice2: { id: item.lego.audioRefs.target.voice2.id, url: item.lego.audioRefs.target.voice2.url },
          },
        },
      })
    }

    // Convert to SeedPair format
    if (!seedMap.has(item.seed.seed_id)) {
      seedMap.set(item.seed.seed_id, {
        seed_id: item.seed.seed_id,
        seed_pair: item.seed.seed_pair,
        legos: [],
      })
    }
  }

  // Link LEGOs to seeds (only for new items in this batch)
  for (const item of items) {
    const seed = seedMap.get(item.seed.seed_id)
    const lego = legoMap.get(item.lego.id)
    if (seed && lego && !seed.legos.find((l: LegoPair) => l.id === lego.id)) {
      seed.legos.push(lego)
    }
  }

  // Get only the NEW legos/seeds from this batch for building rounds
  const newLegoIds = new Set(items.map(i => i.lego.id))
  const newLegos = Array.from(legoMap.values()).filter(l => newLegoIds.has(l.id))
  const newSeedIds = new Set(items.map(i => i.seed.seed_id))
  const newSeeds = Array.from(seedMap.values()).filter(s => newSeedIds.has(s.seed_id))

  console.log(`[loadSeedBatch] Extracted ${newLegos.length} LEGOs and ${newSeeds.length} seeds from batch`)

  // 3. Load baskets for new LEGOs
  const baskets = new Map(existingBaskets)
  const legoIdsToLoad = newLegos.map(l => l.id).filter(id => !baskets.has(id))

  if (legoIdsToLoad.length > 0) {
    try {
      const newBaskets = await provider.getBasketsBatch(legoIdsToLoad, legoMap)
      for (const [id, basket] of newBaskets) {
        baskets.set(id, basket)
      }
      console.log(`[loadSeedBatch] Loaded baskets for ${newBaskets.size} LEGOs`)
    } catch (err) {
      console.warn('[loadSeedBatch] Failed to load baskets:', err)
    }
  }

  // 4. Load introduction audio for new LEGOs
  try {
    const introAudioMap = await provider.getIntroductionAudioBatch(legoIdsToLoad)
    for (const [legoId, introAudio] of introAudioMap) {
      const basket = baskets.get(legoId)
      if (basket) {
        basket.introduction_audio = {
          id: introAudio.id,
          url: introAudio.url,
          duration_ms: introAudio.duration_ms,
        }
      }
    }
    console.log(`[loadSeedBatch] Loaded intro audio for ${introAudioMap.size} LEGOs`)
  } catch (err) {
    console.warn('[loadSeedBatch] Failed to load intro audio:', err)
  }

  // 5. Build audio URL helper
  const buildAudioUrl = (audioId: string): string => {
    if (!audioId) return ''
    return `/api/audio/${audioId}`
  }

  // 6. Build rounds for this batch
  // Use all accumulated data for spaced rep, but only build rounds for new LEGOs
  const builderRounds = buildRounds(
    newLegos,
    newSeeds,
    baskets,
    config,
    buildAudioUrl,
    startRoundNumber
  )
  console.log(`[loadSeedBatch] Built ${builderRounds.length} rounds`)

  // 7. Adapt for SimplePlayer
  const simpleRounds = adaptRoundsForPlayer(builderRounds)

  return {
    simpleRounds,
    builderRounds,
    legoMap,
    seedMap,
    baskets,
    seedCount: newSeeds.length,
    legoCount: newLegos.length,
  }
}

/**
 * Belt thresholds (seed numbers) - matching PriorityRoundLoader
 */
export const BELT_THRESHOLDS = [0, 8, 20, 40, 80, 150, 280, 400]
export const BELT_NAMES = ['White', 'Yellow', 'Orange', 'Green', 'Blue', 'Purple', 'Brown', 'Black']

/**
 * Get the belt containing a seed number
 */
export function getBeltForSeed(seedNumber: number): { index: number; name: string; start: number; end: number } {
  for (let i = BELT_THRESHOLDS.length - 1; i >= 0; i--) {
    if (seedNumber >= BELT_THRESHOLDS[i]) {
      const start = BELT_THRESHOLDS[i] === 0 ? 1 : BELT_THRESHOLDS[i]
      const end = i < BELT_THRESHOLDS.length - 1 ? BELT_THRESHOLDS[i + 1] - 1 : Infinity
      return { index: i, name: BELT_NAMES[i], start, end: end === Infinity ? 10000 : end }
    }
  }
  return { index: 0, name: 'White', start: 1, end: 7 }
}

/**
 * Build priority loading queue based on current seed position
 */
export function buildPriorityQueue(currentSeed: number, totalSeeds: number = 1000): number[][] {
  const batches: number[][] = []
  const currentBelt = getBeltForSeed(currentSeed)
  const nextBeltStart = currentBelt.index < BELT_THRESHOLDS.length - 1
    ? BELT_THRESHOLDS[currentBelt.index + 1]
    : null

  // Batch 1: Current seed + next few seeds (immediate - for seamless playback)
  const immediateBatch: number[] = []
  for (let s = currentSeed; s <= Math.min(currentSeed + 5, totalSeeds); s++) {
    immediateBatch.push(s)
  }
  if (immediateBatch.length > 0) batches.push(immediateBatch)

  // Batch 2: Rest of current belt + first seed of next belt
  const currentBeltRest: number[] = []
  for (let s = currentSeed + 6; s <= Math.min(currentBelt.end, totalSeeds); s++) {
    currentBeltRest.push(s)
  }
  if (nextBeltStart && nextBeltStart <= totalSeeds) {
    currentBeltRest.push(nextBeltStart)
  }
  if (currentBeltRest.length > 0) batches.push(currentBeltRest)

  // Batch 3: Rest of next belt
  if (nextBeltStart) {
    const nextBelt = getBeltForSeed(nextBeltStart)
    const nextBeltRest: number[] = []
    for (let s = nextBeltStart + 1; s <= Math.min(nextBelt.end, totalSeeds); s++) {
      nextBeltRest.push(s)
    }
    if (nextBeltRest.length > 0) batches.push(nextBeltRest)
  }

  // Batch 4+: Continue belt-by-belt forward
  let beltIndex = currentBelt.index + 2
  while (beltIndex < BELT_THRESHOLDS.length) {
    const beltStart = BELT_THRESHOLDS[beltIndex]
    if (beltStart > totalSeeds) break

    const belt = getBeltForSeed(beltStart)
    const beltBatch: number[] = []
    for (let s = belt.start; s <= Math.min(belt.end, totalSeeds); s++) {
      beltBatch.push(s)
    }
    if (beltBatch.length > 0) batches.push(beltBatch)
    beltIndex++
  }

  // Final batch: Backfill earlier seeds (for skip-back)
  if (currentSeed > 1) {
    const backfillBatch: number[] = []
    for (let s = 1; s < currentSeed; s++) {
      backfillBatch.push(s)
    }
    if (backfillBatch.length > 0) batches.push(backfillBatch)
  }

  return batches
}
