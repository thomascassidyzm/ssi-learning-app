/**
 * toSimpleRounds - Convert ScriptItem[] to SimplePlayer's Round[] format
 *
 * This is the only conversion layer needed. No RoundBuilder. No roundAdapter.
 *
 * generateLearningScript() → toSimpleRounds() → SimplePlayer.initialize()
 *
 * Pause duration formula:
 *   pauseDuration = bootUpTimeMs + scaleFactor * (target1DurationMs + target2DurationMs)
 *
 * bootUpTimeMs: Cognitive boot-up time before learner starts speaking (default: 2000ms)
 * scaleFactor: How much of the target audio length to allow for response (default: 0.75)
 */

import type { ScriptItem } from './generateLearningScript'
import type { Round, Cycle } from '../playback/SimplePlayer'

export interface PauseConfig {
  bootUpTimeMs: number    // Cognitive boot-up time (default: 2000ms)
  scaleFactor: number     // Scale factor for target audio duration (default: 0.75)
}

export const DEFAULT_PAUSE_CONFIG: PauseConfig = {
  bootUpTimeMs: 2000,
  scaleFactor: 0.75
}

const audioUrl = (uuid: string | undefined): string => {
  if (!uuid) return ''
  return `/api/audio/${uuid}`
}

/**
 * Calculate pause duration based on target audio lengths
 * Formula: bootUpTime + scaleFactor * (target1Duration + target2Duration)
 */
function calculatePauseDuration(
  target1DurationMs: number | undefined,
  target2DurationMs: number | undefined,
  config: PauseConfig
): number {
  const t1 = target1DurationMs || 0
  const t2 = target2DurationMs || 0
  const totalTargetDuration = t1 + t2

  // If no duration data, fall back to 4 seconds
  if (totalTargetDuration === 0) return 4000

  return Math.round(config.bootUpTimeMs + config.scaleFactor * totalTargetDuration)
}

export function toSimpleRounds(
  items: ScriptItem[],
  pauseConfig: PauseConfig = DEFAULT_PAUSE_CONFIG
): Round[] {
  // Group by legoKey - this is the true round identifier (e.g., S0045L02)
  // LEGO IDs encode seed and lego index, so sorting them gives correct order
  const byLego = new Map<string, ScriptItem[]>()
  for (const item of items) {
    const key = item.legoKey
    if (!byLego.has(key)) {
      byLego.set(key, [])
    }
    byLego.get(key)!.push(item)
  }

  const rounds: Round[] = []

  for (const [legoKey, roundItems] of byLego.entries()) {
    // Build ALL cycles with audio (including intro as first cycle)
    // Intro cycle: sourceId=presentation_audio, target1/target2 same as debut, NO PAUSE
    // Debut/other cycles: sourceId=known_audio, target1/target2, dynamic pause
    // All use the same audio pattern: sourceId → target1 → target2
    const cycles: Cycle[] = roundItems
      .filter(i => i.hasAudio)
      .map(i => ({
        id: i.uuid,
        known: {
          text: i.knownText,
          audioUrl: audioUrl(i.sourceId)
        },
        target: {
          text: i.targetText,
          voice1Url: audioUrl(i.target1Id),
          voice2Url: audioUrl(i.target2Id)
        },
        // Intro has no pause (learner doesn't know it yet)
        // Other cycles: dynamic pause based on target audio lengths
        pauseDuration: i.type === 'intro'
          ? 0
          : calculatePauseDuration(i.target1DurationMs, i.target2DurationMs, pauseConfig)
      }))

    // Extract seed number from legoKey for roundNumber (for backwards compat)
    // S0045L02 → 45
    const seedMatch = legoKey.match(/S(\d+)/)
    const seedNum = seedMatch ? parseInt(seedMatch[1], 10) : 0

    rounds.push({
      roundNumber: seedNum, // Use seed number for backwards compat
      legoId: legoKey,
      seedId: roundItems[0]?.seedId || '',
      cycles
    })
  }

  // Sort by legoId string - zero-padded so string sort is correct
  // S0001L01 < S0001L02 < S0002L01 etc.
  rounds.sort((a, b) => a.legoId.localeCompare(b.legoId))

  return rounds
}
