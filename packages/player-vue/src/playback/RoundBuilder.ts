/**
 * @deprecated Replaced by `generateLearningScript` + `toSimpleRounds` pipeline.
 * Retained because CourseExplorer still uses RoundBuilder via useFullCourseScript.
 *
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
    phraseCount: number  // 3 for N-1, 1 for others
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
  // Normalize text for comparison: lowercase, strip punctuation, trim
  // This ensures "I want" and "I want." are treated as identical
  const normalizeText = (text: string) =>
    text?.toLowerCase().replace(/[^\w\s]/g, '').trim() || ''

  // Track audio fingerprints (known|target pairs) to prevent identical consecutive audio
  // Two cycles are "audio identical" if both known AND target normalize to the same text
  const usedAudioFingerprints = new Set<string>()

  // Track known→target mappings to detect ZUT violations
  // A ZUT violation is when the same known text maps to different targets
  const knownToTarget = new Map<string, string>()

  // Helper to create audio fingerprint
  const getAudioFingerprint = (known: string, target: string) =>
    `${normalizeText(known)}|${normalizeText(target)}`

  // Helper to check and add phrase, returns false if duplicate or ZUT violation
  const canAddPhrase = (known: string, target: string, context: string): boolean => {
    const normalizedKnown = normalizeText(known)
    const normalizedTarget = normalizeText(target)
    const fingerprint = `${normalizedKnown}|${normalizedTarget}`

    // Check for ZUT violation: same known, different target
    const existingTarget = knownToTarget.get(normalizedKnown)
    if (existingTarget && existingTarget !== normalizedTarget) {
      console.warn(`[RoundBuilder] ZUT VIOLATION in ${context}: "${known}" maps to both "${existingTarget}" and "${normalizedTarget}"`)
      return false
    }

    // Check for audio duplicate
    if (usedAudioFingerprints.has(fingerprint)) {
      return false
    }

    // Track this phrase
    knownToTarget.set(normalizedKnown, normalizedTarget)
    usedAudioFingerprints.add(fingerprint)
    return true
  }

  // Mark LEGO itself as used (both known and target)
  canAddPhrase(lego.lego.known, lego.lego.target, 'LEGO debut')

  // 3. BUILD - Up to maxBuildPhrases practice phrases (no duplicates within round)
  const allBuildPhrases = basket?.debut_phrases ?? []
  let buildCount = 0
  for (const phrase of allBuildPhrases) {
    if (buildCount >= config.maxBuildPhrases) break

    // Check both known AND target to prevent audio-identical cycles
    if (!canAddPhrase(phrase.phrase.known, phrase.phrase.target, `BUILD-${buildCount + 1}`)) {
      continue
    }

    items.push(createPracticeItem({
      type: 'debut_phrase',
      phrase,
      lego,
      seed,
      legoIndex,
      roundNumber,
      buildAudioUrl,
    }))
    buildCount++
  }

  // 4. REVIEW - Spaced rep items (Fibonacci pattern: 3x N-1, 1x for others)
  // Pattern: N-1, N-2, N-3, N-5, N-8, N-13, N-21, N-34, N-55, N-89 (max)
  if (getSpacedRepLegos && roundNumber > 1) {
    const srItems = getSpacedRepLegos('A', 0) // Get all scheduled reviews (count ignored)
    for (const sr of srItems) {
      // Get USE phrases from the reviewed LEGO's basket
      const eternalPhrases = sr.basket?.eternal_phrases ?? []
      let addedForThisLego = false

      // Add phraseCount phrases for this LEGO (3 for N-1, 1 for others)
      let phrasesAdded = 0
      for (const phrase of eternalPhrases) {
        if (phrasesAdded >= sr.phraseCount) break

        // Check both known AND target to prevent audio-identical cycles
        if (!canAddPhrase(phrase.phrase.known, phrase.phrase.target, `REVIEW-R${sr.legoIndex}`)) {
          continue
        }

        if (!addedForThisLego) {
          spacedRepReviews.push(sr.legoIndex)
          addedForThisLego = true
        }
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
        phrasesAdded++
      }

      // Fallback: if no USE phrases available, use LEGO itself (max 1)
      if (phrasesAdded === 0) {
        // Check both known AND target
        if (!canAddPhrase(sr.lego.lego.known, sr.lego.lego.target, `REVIEW-R${sr.legoIndex} fallback`)) {
          continue
        }

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
      }
    }
  }

  // 5. CONSOLIDATION - Final reinforcement
  // CAN reuse BUILD phrases (REVIEW gap provides separation)
  // But still check for ZUT violations and consecutive audio duplicates
  const usedInConsolidate = new Set<string>()
  // Track LEGO's audio fingerprint to avoid it in consolidation
  usedInConsolidate.add(getAudioFingerprint(lego.lego.known, lego.lego.target))

  const allEternalPhrases = basket?.eternal_phrases ?? []
  let consolidateCount = 0
  for (const phrase of allEternalPhrases) {
    if (consolidateCount >= config.consolidationCount) break

    const fingerprint = getAudioFingerprint(phrase.phrase.known, phrase.phrase.target)
    if (usedInConsolidate.has(fingerprint)) continue

    // Still check for ZUT violations (same known, different target)
    const normalizedKnown = normalizeText(phrase.phrase.known)
    const normalizedTarget = normalizeText(phrase.phrase.target)
    const existingTarget = knownToTarget.get(normalizedKnown)
    if (existingTarget && existingTarget !== normalizedTarget) {
      console.warn(`[RoundBuilder] ZUT VIOLATION in CONSOLIDATE: "${phrase.phrase.known}" maps to both "${existingTarget}" and "${normalizedTarget}"`)
      continue
    }

    items.push(createPracticeItem({
      type: 'consolidation',
      phrase,
      lego,
      seed,
      legoIndex,
      roundNumber,
      buildAudioUrl,
    }))
    usedInConsolidate.add(fingerprint)
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
 * Based on Fibonacci offsets: N-1, N-2, N-3, N-5, N-8, N-13, N-21, N-34, N-55, N-89
 *
 * Pattern:
 * - 3x N-1 (three USE phrases from the LEGO one round ago)
 * - 1x for all others (N-2, N-3, N-5, etc.)
 * - Max offset is N-89 (stops there to avoid always reviewing early LEGOs)
 */
export function calculateSpacedRepReviews(roundNumber: number): Array<{ legoIndex: number; fibPosition: number; phraseCount: number }> {
  const reviews: Array<{ legoIndex: number; fibPosition: number; phraseCount: number }> = []
  const seen = new Set<number>()

  for (let i = 0; i < FIBONACCI.length; i++) {
    const skip = FIBONACCI[i]
    const reviewLego = roundNumber - skip

    if (reviewLego < 1) break
    if (seen.has(reviewLego)) continue

    seen.add(reviewLego)
    // N-1 gets 3 phrases, all others get 1
    const phraseCount = skip === 1 ? 3 : 1
    reviews.push({ legoIndex: reviewLego, fibPosition: i, phraseCount })
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
    // Returns Fibonacci-scheduled LEGOs with phraseCount (3 for N-1, 1 for others)
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
            phraseCount: r.phraseCount,  // 3 for N-1, 1 for others
          }
        })
        .filter((sr): sr is NonNullable<typeof sr> => sr !== null)
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
