/**
 * toSimpleRounds - Convert ScriptItem[] to SimplePlayer's Round[] format
 *
 * This is the only conversion layer needed. No RoundBuilder. No roundAdapter.
 *
 * generateLearningScript() → toSimpleRounds() → SimplePlayer.initialize()
 */

import type { ScriptItem } from './generateLearningScript'
import type { Round, Cycle } from '../playback/SimplePlayer'

const audioUrl = (uuid: string | undefined): string => {
  if (!uuid) return ''
  return `/api/audio/${uuid}`
}

export function toSimpleRounds(items: ScriptItem[]): Round[] {
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
    // Debut/other cycles: sourceId=known_audio, target1/target2, 4s pause
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
        // Intro has no pause (learner doesn't know it yet), other cycles have 4s pause
        pauseDuration: i.type === 'intro' ? 0 : 4000
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
