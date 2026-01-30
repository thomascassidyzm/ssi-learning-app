/**
 * Round Adapter - Converts RoundBuilder output to SimplePlayer format
 *
 * RoundBuilder produces detailed ScriptItems with full audio refs.
 * SimplePlayer needs a flat Cycle format with direct URLs.
 */

import type { Round as BuilderRound, ScriptItem } from './types'

// Simple types for SimplePlayer
export interface SimpleCycle {
  id: string
  known: { text: string; audioUrl: string }
  target: { text: string; voice1Url: string; voice2Url: string }
  pauseDuration?: number
}

export interface SimpleRound {
  roundNumber: number
  legoId: string
  seedId: string
  introAudioUrl?: string  // "The Spanish for X is..." - voice1/voice2 come from cycles[0]
  cycles: SimpleCycle[]
}

/**
 * Convert RoundBuilder rounds to SimplePlayer format
 */
export function adaptRoundsForPlayer(builderRounds: BuilderRound[]): SimpleRound[] {
  return builderRounds.map(adaptRound)
}

/**
 * Convert a single BuilderRound to SimpleRound
 */
function adaptRound(round: BuilderRound): SimpleRound {
  let introAudioUrl: string | undefined
  const cycles: SimpleCycle[] = []

  for (const item of round.items) {
    if (item.type === 'intro') {
      // Extract presentation audio URL only
      // voice1/voice2 for intro come from cycles[0] (the LEGO debut)
      introAudioUrl = item.presentationAudio?.url
    } else {
      // Convert to cycle
      const cycle = adaptScriptItemToCycle(item)
      if (cycle) {
        cycles.push(cycle)
      }
    }
  }

  return {
    roundNumber: round.roundNumber,
    legoId: round.legoId,
    seedId: round.seedId,
    introAudioUrl,
    cycles,
  }
}

/**
 * Convert a ScriptItem to a SimpleCycle
 * Returns null if the item lacks required audio refs
 */
function adaptScriptItemToCycle(item: ScriptItem): SimpleCycle | null {
  const { audioRefs, knownText, targetText, audioDurations } = item

  // Validate required audio URLs exist
  const knownUrl = audioRefs?.known?.url
  const voice1Url = audioRefs?.target?.voice1?.url
  const voice2Url = audioRefs?.target?.voice2?.url

  if (!knownUrl || !voice1Url || !voice2Url) {
    return null
  }

  // Calculate pause duration: 2x target audio length, or default 4000ms
  // audioDurations are in seconds, SimplePlayer expects milliseconds
  const pauseDuration = audioDurations
    ? Math.round((audioDurations.target1 + audioDurations.target2) * 1000)
    : 4000

  return {
    id: `${item.legoId}-${item.type}-${item.roundNumber}`,
    known: {
      text: knownText,
      audioUrl: knownUrl,
    },
    target: {
      text: targetText,
      voice1Url,
      voice2Url,
    },
    pauseDuration,
  }
}
