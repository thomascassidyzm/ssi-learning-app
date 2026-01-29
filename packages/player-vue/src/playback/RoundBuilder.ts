/**
 * RoundBuilder - Builds rounds in LearningPlayer's exact format
 *
 * Output goes directly to LearningPlayer's cachedRounds - no bridge needed.
 *
 * Round structure: INTRO → DEBUT → BUILD (×7) → REVIEW (×N) → CONSOLIDATE (×2)
 */

import type { LegoPair, SeedPair, ClassifiedBasket, PracticePhrase, AudioRef } from '@ssi/core'
import type { Round, ScriptItem, ScriptItemType, ThreadId } from './types'
import type { PlaybackConfig } from './PlaybackConfig'
import type { ThreadManager } from './ThreadManager'

// Fibonacci sequence for spaced rep scheduling
const FIBONACCI = [1, 2, 3, 5, 8, 13, 21, 34, 55, 89]

// Prevent console spam - warn once per unique issue
const warnedOnce = new Set<string>()

export interface BuildRoundOptions {
  lego: LegoPair
  seed: SeedPair
  basket: ClassifiedBasket | null
  legoIndex: number  // 1-based position in course
  roundNumber: number
  config: PlaybackConfig
  /** Function to build audio URLs from IDs */
  buildAudioUrl: (audioId: string) => string
  /** For spaced rep: get LEGOs from other threads */
  getSpacedRepLegos?: (excludeThread: ThreadId, count: number) => Array<{
    lego: LegoPair
    seed: SeedPair
    basket: ClassifiedBasket | null
    legoIndex: number
    fibonacciPosition: number
  }>
}

/**
 * Build a complete round in LearningPlayer's exact format
 */
export function buildRound(options: BuildRoundOptions): Round {
  const {
    lego,
    seed,
    basket,
    legoIndex,
    roundNumber,
    config,
    buildAudioUrl,
    getSpacedRepLegos,
  } = options

  const items: ScriptItem[] = []
  const spacedRepReviews: number[] = []

  // 1. INTRO - "The Spanish for X is..."
  if (basket?.introduction_audio && !config.skipIntros && !config.turboMode) {
    items.push(createIntroItem({
      lego,
      seed,
      legoIndex,
      roundNumber,
      introAudio: basket.introduction_audio,
      buildAudioUrl,
    }))
  }

  // 2. DEBUT - Practice the LEGO itself
  if (basket?.debut) {
    items.push(createPracticeItem({
      type: 'debut',
      phrase: basket.debut,
      lego,
      seed,
      legoIndex,
      roundNumber,
      buildAudioUrl,
    }))
  } else {
    // Fallback: use LEGO directly as debut
    items.push(createLegoItem({
      type: 'debut',
      lego,
      seed,
      legoIndex,
      roundNumber,
      buildAudioUrl,
    }))
  }

  // Track phrases used in this round to avoid duplicates
  // Normalize target text for comparison (lowercase, trim)
  const normalizeText = (text: string) => text?.toLowerCase().trim() || ''
  const usedInRound = new Set<string>()

  // Mark LEGO itself as used
  usedInRound.add(normalizeText(lego.lego.target))

  // 3. BUILD - Up to maxBuildPhrases practice phrases (no duplicates within round)
  const allBuildPhrases = basket?.debut_phrases ?? []
  let buildCount = 0
  for (const phrase of allBuildPhrases) {
    if (buildCount >= config.maxBuildPhrases) break
    const normalized = normalizeText(phrase.phrase.target)
    if (usedInRound.has(normalized)) continue

    items.push(createPracticeItem({
      type: 'debut_phrase',
      phrase,
      lego,
      seed,
      legoIndex,
      roundNumber,
      buildAudioUrl,
    }))
    usedInRound.add(normalized)
    buildCount++
  }

  // 4. REVIEW - Spaced rep items from other threads (no duplicates within round)
  if (getSpacedRepLegos && roundNumber > 1) {
    const srItems = getSpacedRepLegos('A', config.spacedRepCount) // Thread is ignored for now
    for (const sr of srItems) {
      // Use eternal phrase if available, otherwise LEGO itself
      const phrase = sr.basket?.eternal_phrases?.[0]

      if (phrase) {
        const normalized = normalizeText(phrase.phrase.target)
        if (usedInRound.has(normalized)) continue

        spacedRepReviews.push(sr.legoIndex)
        items.push(createPracticeItem({
          type: 'spaced_rep',
          phrase,
          lego: sr.lego,
          seed: sr.seed,
          legoIndex: sr.legoIndex,
          roundNumber,
          buildAudioUrl,
          reviewOf: sr.legoIndex,
          fibonacciPosition: sr.fibonacciPosition,
        }))
        usedInRound.add(normalized)
      } else {
        const normalized = normalizeText(sr.lego.lego.target)
        if (usedInRound.has(normalized)) continue

        spacedRepReviews.push(sr.legoIndex)
        items.push(createLegoItem({
          type: 'spaced_rep',
          lego: sr.lego,
          seed: sr.seed,
          legoIndex: sr.legoIndex,
          roundNumber,
          buildAudioUrl,
          reviewOf: sr.legoIndex,
          fibonacciPosition: sr.fibonacciPosition,
        }))
        usedInRound.add(normalized)
      }
    }
  }

  // 5. CONSOLIDATION - Final reinforcement
  // CAN reuse BUILD phrases (REVIEW gap provides separation)
  // Only avoid: LEGO itself and duplicates within CONSOLIDATE
  const usedInConsolidate = new Set<string>()
  usedInConsolidate.add(normalizeText(lego.lego.target)) // Avoid LEGO itself

  const allEternalPhrases = basket?.eternal_phrases ?? []
  let consolidateCount = 0
  for (const phrase of allEternalPhrases) {
    if (consolidateCount >= config.consolidationCount) break
    const normalized = normalizeText(phrase.phrase.target)
    if (usedInConsolidate.has(normalized)) continue

    items.push(createPracticeItem({
      type: 'consolidation',
      phrase,
      lego,
      seed,
      legoIndex,
      roundNumber,
      buildAudioUrl,
    }))
    usedInConsolidate.add(normalized)
    consolidateCount++
  }

  return {
    roundNumber,
    legoId: lego.id,
    legoIndex,
    seedId: seed.seed_id,
    items,
    spacedRepReviews,
  }
}

/**
 * Create an INTRO item (presentation audio only)
 */
function createIntroItem(options: {
  lego: LegoPair
  seed: SeedPair
  legoIndex: number
  roundNumber: number
  introAudio: AudioRef
  buildAudioUrl: (id: string) => string
}): ScriptItem {
  const { lego, seed, legoIndex, roundNumber, introAudio, buildAudioUrl } = options

  // Validate lego has required audio refs
  if (!lego.audioRefs?.known?.id || !lego.audioRefs?.target?.voice1?.id || !lego.audioRefs?.target?.voice2?.id) {
    const warnKey = `lego-intro-${lego.id}`
    if (!warnedOnce.has(warnKey)) {
      warnedOnce.add(warnKey)
      // console.warn('[RoundBuilder] Lego missing audio refs in createIntroItem:', lego.id || 'unknown')
    }
  }

  return {
    type: 'intro',
    roundNumber,
    legoId: lego.id,
    legoIndex,
    seedId: seed.seed_id,
    knownText: lego.lego.known,
    targetText: lego.lego.target,
    audioRefs: {
      known: { id: lego.audioRefs?.known?.id || '', url: buildAudioUrl(lego.audioRefs?.known?.id || '') },
      target: {
        voice1: { id: lego.audioRefs?.target?.voice1?.id || '', url: buildAudioUrl(lego.audioRefs?.target?.voice1?.id || '') },
        voice2: { id: lego.audioRefs?.target?.voice2?.id || '', url: buildAudioUrl(lego.audioRefs?.target?.voice2?.id || '') },
      },
    },
    presentationAudio: {
      id: introAudio.id,
      url: buildAudioUrl(introAudio.id),
    },
    components: lego.type === 'M' && lego.components
      ? lego.components.map(c => ({ known: c.known, target: c.target }))
      : undefined,
  }
}

/**
 * Create a practice item from a PracticePhrase
 */
function createPracticeItem(options: {
  type: ScriptItemType
  phrase: PracticePhrase
  lego: LegoPair
  seed: SeedPair
  legoIndex: number
  roundNumber: number
  buildAudioUrl: (id: string) => string
  reviewOf?: number
  fibonacciPosition?: number
}): ScriptItem {
  const { type, phrase, lego, seed, legoIndex, roundNumber, buildAudioUrl, reviewOf, fibonacciPosition } = options

  // Validate phrase has required audio refs
  if (!phrase.audioRefs?.known?.id || !phrase.audioRefs?.target?.voice1?.id || !phrase.audioRefs?.target?.voice2?.id) {
    const warnKey = `phrase-${phrase.id}`
    if (!warnedOnce.has(warnKey)) {
      warnedOnce.add(warnKey)
      // console.warn('[RoundBuilder] Phrase missing audio refs:', phrase.id || 'unknown')
    }
  }

  return {
    type,
    roundNumber,
    legoId: lego.id,
    legoIndex,
    seedId: seed.seed_id,
    knownText: phrase.phrase.known,
    targetText: phrase.phrase.target,
    audioRefs: {
      known: { id: phrase.audioRefs?.known?.id || '', url: buildAudioUrl(phrase.audioRefs?.known?.id || '') },
      target: {
        voice1: { id: phrase.audioRefs?.target?.voice1?.id || '', url: buildAudioUrl(phrase.audioRefs?.target?.voice1?.id || '') },
        voice2: { id: phrase.audioRefs?.target?.voice2?.id || '', url: buildAudioUrl(phrase.audioRefs?.target?.voice2?.id || '') },
      },
    },
    audioDurations: phrase.audioRefs.known.duration_ms ? {
      source: phrase.audioRefs.known.duration_ms / 1000,
      target1: (phrase.audioRefs.target.voice1.duration_ms ?? 2000) / 1000,
      target2: (phrase.audioRefs.target.voice2.duration_ms ?? 2000) / 1000,
    } : undefined,
    reviewOf,
    fibonacciPosition,
  }
}

/**
 * Create a practice item directly from a LegoPair (fallback when no phrase available)
 */
function createLegoItem(options: {
  type: ScriptItemType
  lego: LegoPair
  seed: SeedPair
  legoIndex: number
  roundNumber: number
  buildAudioUrl: (id: string) => string
  reviewOf?: number
  fibonacciPosition?: number
}): ScriptItem {
  const { type, lego, seed, legoIndex, roundNumber, buildAudioUrl, reviewOf, fibonacciPosition } = options

  // Validate lego has required audio refs
  if (!lego.audioRefs?.known?.id || !lego.audioRefs?.target?.voice1?.id || !lego.audioRefs?.target?.voice2?.id) {
    const warnKey = `lego-${lego.id}`
    if (!warnedOnce.has(warnKey)) {
      warnedOnce.add(warnKey)
      // console.warn('[RoundBuilder] Lego missing audio refs:', lego.id || 'unknown')
    }
  }

  return {
    type,
    roundNumber,
    legoId: lego.id,
    legoIndex,
    seedId: seed.seed_id,
    knownText: lego.lego.known,
    targetText: lego.lego.target,
    audioRefs: {
      known: { id: lego.audioRefs?.known?.id || '', url: buildAudioUrl(lego.audioRefs?.known?.id || '') },
      target: {
        voice1: { id: lego.audioRefs?.target?.voice1?.id || '', url: buildAudioUrl(lego.audioRefs?.target?.voice1?.id || '') },
        voice2: { id: lego.audioRefs?.target?.voice2?.id || '', url: buildAudioUrl(lego.audioRefs?.target?.voice2?.id || '') },
      },
    },
    audioDurations: lego.audioRefs.known.duration_ms ? {
      source: lego.audioRefs.known.duration_ms / 1000,
      target1: (lego.audioRefs.target.voice1.duration_ms ?? 2000) / 1000,
      target2: (lego.audioRefs.target.voice2.duration_ms ?? 2000) / 1000,
    } : undefined,
    reviewOf,
    fibonacciPosition,
  }
}

/**
 * Calculate which previous LEGOs to review during this round
 * Based on Fibonacci: review LEGO at position (roundNumber - fib[i])
 */
export function calculateSpacedRepReviews(roundNumber: number): Array<{ legoIndex: number; fibPosition: number }> {
  const reviews: Array<{ legoIndex: number; fibPosition: number }> = []
  const seen = new Set<number>()

  for (let i = 0; i < FIBONACCI.length; i++) {
    const skip = FIBONACCI[i]
    const reviewLego = roundNumber - skip

    if (reviewLego < 1) break
    if (seen.has(reviewLego)) continue

    seen.add(reviewLego)
    reviews.push({ legoIndex: reviewLego, fibPosition: i })
  }

  return reviews
}

/**
 * Build multiple rounds at once
 */
export function buildRounds(
  legos: LegoPair[],
  seeds: SeedPair[],
  baskets: Map<string, ClassifiedBasket>,
  config: PlaybackConfig,
  buildAudioUrl: (audioId: string) => string,
  startRound: number = 1
): Round[] {
  const rounds: Round[] = []

  // Create a seed lookup
  const seedForLego = new Map<string, SeedPair>()
  for (const seed of seeds) {
    for (const l of seed.legos) {
      seedForLego.set(l.id, seed)
    }
  }

  for (let i = 0; i < legos.length; i++) {
    const lego = legos[i]
    const seed = seedForLego.get(lego.id) ?? seeds[0]
    const basket = baskets.get(lego.id) ?? null
    const legoIndex = i + 1  // 1-based
    const roundNumber = startRound + i

    // Spaced rep callback: get previous LEGOs for review
    const getSpacedRepLegos = (excludeThread: ThreadId, count: number) => {
      const reviews = calculateSpacedRepReviews(roundNumber)
      return reviews
        .map(r => {
          const srLego = legos[r.legoIndex - 1]  // Convert to 0-based
          if (!srLego) return null  // LEGO doesn't exist
          return {
            lego: srLego,
            seed: seedForLego.get(srLego.id) ?? seeds[0],
            basket: baskets.get(srLego.id) ?? null,
            legoIndex: r.legoIndex,
            fibonacciPosition: r.fibPosition,
          }
        })
        .filter((sr): sr is NonNullable<typeof sr> => sr !== null)
        .slice(0, count)
    }

    rounds.push(buildRound({
      lego,
      seed,
      basket,
      legoIndex,
      roundNumber,
      config,
      buildAudioUrl,
      getSpacedRepLegos,
    }))
  }

  return rounds
}
