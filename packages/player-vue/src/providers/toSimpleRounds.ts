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
  // Group by roundNumber
  const byRound = new Map<number, ScriptItem[]>()
  for (const item of items) {
    if (!byRound.has(item.roundNumber)) {
      byRound.set(item.roundNumber, [])
    }
    byRound.get(item.roundNumber)!.push(item)
  }

  const rounds: Round[] = []

  for (const [roundNum, roundItems] of byRound.entries()) {
    const intro = roundItems.find(i => i.type === 'intro')

    const cycles: Cycle[] = roundItems
      .filter(i => i.type !== 'intro' && i.hasAudio)
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
        pauseDuration: 4000
      }))

    rounds.push({
      roundNumber: roundNum,
      legoId: intro?.legoKey || roundItems[0]?.legoKey || '',
      seedId: intro?.seedId || roundItems[0]?.seedId || '',
      introAudioUrl: intro?.presentationAudioId ? audioUrl(intro.presentationAudioId) : undefined,
      cycles
    })
  }

  // Sort by round number
  rounds.sort((a, b) => a.roundNumber - b.roundNumber)

  return rounds
}
