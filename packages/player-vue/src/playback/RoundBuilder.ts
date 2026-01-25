/**
 * RoundBuilder - Builds immutable round templates
 *
 * Templates built once. Config changes flip `playable` flags, don't rebuild.
 *
 * Round structure: INTRO → DEBUT → BUILD (×7) → REVIEW (×3) → CONSOLIDATE (×2)
 */

import type { LegoPair, SeedPair, ClassifiedBasket, PracticePhrase } from '@ssi/core'
import type { Cycle } from '../types/Cycle'
import type {
  ThreadId,
  RoundTemplate,
  RoundItem,
  RoundItemType,
  ComponentPair,
} from './types'
import type { PlaybackConfig } from './PlaybackConfig'
import type { ThreadManager } from './ThreadManager'

/**
 * Build a complete round template for a LEGO
 */
export function buildRound(
  lego: LegoPair,
  seed: SeedPair,
  basket: ClassifiedBasket,
  thread: ThreadId,
  roundNumber: number,
  threadManager: ThreadManager,
  config: PlaybackConfig
): RoundTemplate {
  const items: RoundItem[] = []
  let itemIndex = 0

  // 1. INTRO phase - "The Spanish for X is..."
  if (basket.introduction_audio) {
    const introItem: RoundItem = {
      id: `${lego.id}-intro`,
      type: 'intro',
      playable: !config.skipIntros && !config.turboMode,
      cycle: null, // Intro is audio-only, not a 4-phase cycle
      components: lego.type === 'M' && lego.components
        ? lego.components.map(c => ({ known: c.known, target: c.target }))
        : undefined,
    }
    items.push(introItem)
  }

  // 2. DEBUT phase - Practice the LEGO phrase itself
  if (basket.debut) {
    const debutCycle = phraseToCycle(basket.debut, lego, seed, 'debut', itemIndex++)
    items.push({
      id: `${lego.id}-debut`,
      type: 'debut',
      playable: true,
      cycle: debutCycle,
      phrase: basket.debut,
    })
  }

  // 3. BUILD phase - Up to maxBuildPhrases practice phrases
  const buildPhrases = basket.debut_phrases.slice(0, config.maxBuildPhrases)
  for (let i = 0; i < buildPhrases.length; i++) {
    const phrase = buildPhrases[i]
    const cycle = phraseToCycle(phrase, lego, seed, 'practice', itemIndex++)
    items.push({
      id: `${lego.id}-build-${i}`,
      type: 'practice',
      playable: true,
      cycle,
      phrase,
    })
  }

  // 4. REVIEW phase - Spaced rep items from OTHER threads
  const otherThreads = getOtherThreads(thread)
  let spacedRepAdded = 0

  for (const otherThread of otherThreads) {
    if (spacedRepAdded >= config.spacedRepCount) break

    const spacedRepLegos = threadManager.getSpacedRepItems(
      otherThread,
      config.spacedRepCount - spacedRepAdded
    )

    for (const srLego of spacedRepLegos) {
      // Get a phrase for this spaced rep LEGO
      // In production, this would use the basket's eternal_phrases
      const srCycle = legoToCycle(srLego, seed, 'review', itemIndex++)
      items.push({
        id: `${lego.id}-sr-${spacedRepAdded}`,
        type: 'spaced_rep',
        playable: true,
        cycle: srCycle,
      })
      spacedRepAdded++
    }
  }

  // 5. CONSOLIDATION phase - Final reinforcement
  const consolidationPhrases = basket.eternal_phrases.slice(0, config.consolidationCount)
  for (let i = 0; i < consolidationPhrases.length; i++) {
    const phrase = consolidationPhrases[i]
    const cycle = phraseToCycle(phrase, lego, seed, 'practice', itemIndex++)
    items.push({
      id: `${lego.id}-consolidate-${i}`,
      type: 'consolidation',
      playable: true,
      cycle,
      phrase,
    })
  }

  // Calculate playable count
  const playableCount = items.filter(item => item.playable).length

  return {
    roundNumber,
    legoId: lego.id,
    thread,
    items,
    playableCount,
  }
}

/**
 * Apply config changes to a round template (flips playable flags)
 */
export function applyConfig(round: RoundTemplate, config: PlaybackConfig): RoundTemplate {
  const updatedItems = round.items.map(item => {
    // Skip intros based on config
    if (item.type === 'intro') {
      return {
        ...item,
        playable: !config.skipIntros && !config.turboMode,
      }
    }
    return item
  })

  const playableCount = updatedItems.filter(item => item.playable).length

  return {
    ...round,
    items: updatedItems,
    playableCount,
  }
}

/**
 * Get playable items from a round
 */
export function getPlayableItems(round: RoundTemplate): RoundItem[] {
  return round.items.filter(item => item.playable)
}

/**
 * Convert a PracticePhrase to a Cycle
 */
function phraseToCycle(
  phrase: PracticePhrase,
  lego: LegoPair,
  seed: SeedPair,
  type: 'debut' | 'practice' | 'review',
  index: number
): Cycle {
  // Calculate pause duration (2x target1 duration, default 4s if not available)
  const target1Duration = phrase.audioRefs.target.voice1.duration_ms ?? 2000
  const pauseDurationMs = target1Duration * 2

  return {
    id: `${lego.id}-${type}-${index}`,
    seedId: seed.seed_id,
    legoId: lego.id,
    type,
    known: {
      text: phrase.phrase.known,
      audioId: phrase.audioRefs.known.id,
      durationMs: phrase.audioRefs.known.duration_ms ?? 2000,
    },
    target: {
      text: phrase.phrase.target,
      voice1AudioId: phrase.audioRefs.target.voice1.id,
      voice1DurationMs: phrase.audioRefs.target.voice1.duration_ms ?? 2000,
      voice2AudioId: phrase.audioRefs.target.voice2.id,
      voice2DurationMs: phrase.audioRefs.target.voice2.duration_ms ?? 2000,
    },
    pauseDurationMs,
  }
}

/**
 * Convert a LegoPair directly to a Cycle (for spaced rep when basket not available)
 */
function legoToCycle(
  lego: LegoPair,
  seed: SeedPair,
  type: 'review',
  index: number
): Cycle {
  const target1Duration = lego.audioRefs.target.voice1.duration_ms ?? 2000
  const pauseDurationMs = target1Duration * 2

  return {
    id: `${lego.id}-${type}-${index}`,
    seedId: seed.seed_id,
    legoId: lego.id,
    type,
    known: {
      text: lego.lego.known,
      audioId: lego.audioRefs.known.id,
      durationMs: lego.audioRefs.known.duration_ms ?? 2000,
    },
    target: {
      text: lego.lego.target,
      voice1AudioId: lego.audioRefs.target.voice1.id,
      voice1DurationMs: lego.audioRefs.target.voice1.duration_ms ?? 2000,
      voice2AudioId: lego.audioRefs.target.voice2.id,
      voice2DurationMs: lego.audioRefs.target.voice2.duration_ms ?? 2000,
    },
    pauseDurationMs,
  }
}

/**
 * Get other threads (for spaced rep interleaving)
 */
function getOtherThreads(current: ThreadId): ThreadId[] {
  const all: ThreadId[] = ['A', 'B', 'C']
  return all.filter(t => t !== current)
}

/**
 * Build a simple round from just a LEGO (when basket not available)
 */
export function buildSimpleRound(
  lego: LegoPair,
  seed: SeedPair,
  thread: ThreadId,
  roundNumber: number
): RoundTemplate {
  const cycle = legoToCycle(lego, seed, 'review', 0)

  return {
    roundNumber,
    legoId: lego.id,
    thread,
    items: [
      {
        id: `${lego.id}-simple`,
        type: 'debut',
        playable: true,
        cycle,
      },
    ],
    playableCount: 1,
  }
}
