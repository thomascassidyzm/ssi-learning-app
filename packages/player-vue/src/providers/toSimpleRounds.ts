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
  // Group by roundNumber - each round is a complete learning unit
  // Items within a round share the same roundNumber, but may have different legoKeys
  // (e.g., spaced_rep items review older LEGOs but belong to the current round)
  const byRound = new Map<number, ScriptItem[]>()
  for (const item of items) {
    const key = item.roundNumber
    if (!byRound.has(key)) {
      byRound.set(key, [])
    }
    byRound.get(key)!.push(item)
  }

  const rounds: Round[] = []

  for (const [roundNum, roundItems] of byRound.entries()) {
    // Find the intro item to get the primary LEGO for this round
    const introItem = roundItems.find(i => i.type === 'intro')
    const primaryLegoKey = introItem?.legoKey || roundItems[0]?.legoKey || ''
    const primarySeedId = introItem?.seedId || roundItems[0]?.seedId || ''

    // Build cycles, filtering out items missing critical audio
    // Intro/debut items: structural, always included (SimplePlayer skips broken phases gracefully)
    // Intro items: must have target1Id (voice1)
    // Other items: must have sourceId AND target1Id
    const cycles: Cycle[] = []
    for (const i of roundItems) {
      const isStructural = i.type === 'intro' || i.type === 'debut'

      if (i.type === 'intro') {
        // Intro: target1Id is critical
        if (!i.target1Id) {
          console.error(`[toSimpleRounds] Intro missing target1Id (voice1) in round ${roundNum}: "${i.knownText}" → "${i.targetText}"`)
        }
        if (!i.presentationAudioId) {
          console.warn(`[toSimpleRounds] Intro missing presentationAudioId in round ${roundNum}: "${i.knownText}" → "${i.targetText}"`)
        }
        if (!i.target2Id) {
          console.warn(`[toSimpleRounds] Intro missing target2Id (voice2) in round ${roundNum}: "${i.knownText}" → "${i.targetText}"`)
        }
      } else {
        // All other items: sourceId AND target1Id are critical
        if (!i.sourceId || !i.target1Id) {
          console.error(`[toSimpleRounds] ${i.type} missing critical audio in round ${roundNum}: sourceId=${i.sourceId || 'MISSING'}, target1Id=${i.target1Id || 'MISSING'} — "${i.knownText}" → "${i.targetText}"`)
          if (!isStructural) {
            continue // Skip non-structural items missing critical audio
          }
        }
        if (!i.target2Id) {
          console.warn(`[toSimpleRounds] ${i.type} missing target2Id (voice2) in round ${roundNum}: "${i.knownText}" → "${i.targetText}"`)
        }
      }

      cycles.push({
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
      })
    }

    // Round-level validation: check structural integrity
    const firstCycle = roundItems[0]
    const secondCycle = roundItems[1]
    if (!firstCycle || firstCycle.type !== 'intro') {
      console.error(`[toSimpleRounds] Round ${roundNum} missing intro as first item (got ${firstCycle?.type || 'nothing'})`)
    }
    if (!secondCycle || secondCycle.type !== 'debut') {
      console.error(`[toSimpleRounds] Round ${roundNum} missing debut as second item (got ${secondCycle?.type || 'nothing'})`)
    }
    if (firstCycle?.type === 'intro' && secondCycle?.type === 'debut') {
      if (firstCycle.knownText !== secondCycle.knownText || firstCycle.targetText !== secondCycle.targetText) {
        console.error(`[toSimpleRounds] Round ${roundNum} intro/debut text mismatch:`)
        console.error(`  INTRO: "${firstCycle.knownText}" → "${firstCycle.targetText}" (legoKey: ${firstCycle.legoKey})`)
        console.error(`  DEBUT: "${secondCycle.knownText}" → "${secondCycle.targetText}" (legoKey: ${secondCycle.legoKey})`)
      }
    }

    rounds.push({
      roundNumber: roundNum,
      legoId: primaryLegoKey,
      seedId: primarySeedId,
      cycles
    })
  }

  // Sort by roundNumber to maintain learning sequence
  rounds.sort((a, b) => a.roundNumber - b.roundNumber)

  return rounds
}
