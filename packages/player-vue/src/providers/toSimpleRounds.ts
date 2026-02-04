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

  // DEBUG: Check for text mismatches between intro and debut
  // Check first 3 rounds AND any round that starts a new seed (L01)
  let checkedCount = 0
  for (const [roundNum, roundItems] of byRound.entries()) {
    const intro = roundItems.find(i => i.type === 'intro')
    const debut = roundItems.find(i => i.type === 'debut')

    // Check first 3 rounds, plus any belt-start rounds (seeds 8, 20, 40, 80, 150, 280)
    const beltStarts = [8, 20, 40, 80, 150, 280]
    const seedNum = intro ? parseInt(intro.seedId?.replace('S', '') || '0') : 0
    const isBeltStart = beltStarts.includes(seedNum)

    if (checkedCount < 3 || isBeltStart) {
      if (intro && debut) {
        if (intro.knownText !== debut.knownText || intro.targetText !== debut.targetText) {
          console.error(`[toSimpleRounds] TEXT MISMATCH in round ${roundNum} (seed ${seedNum}):`)
          console.error(`  INTRO: "${intro.knownText}" → "${intro.targetText}" (legoKey: ${intro.legoKey})`)
          console.error(`  DEBUT: "${debut.knownText}" → "${debut.targetText}" (legoKey: ${debut.legoKey})`)
        } else {
          console.log(`[toSimpleRounds] Round ${roundNum} (seed ${seedNum}) OK: "${intro.knownText}" → "${intro.targetText}"`)
        }
        checkedCount++
      }

      // Also log the cycle order for belt-start rounds
      if (isBeltStart) {
        console.log(`[toSimpleRounds] Round ${roundNum} cycle order:`)
        roundItems.slice(0, 3).forEach((item, idx) => {
          console.log(`  [${idx}] ${item.type}: "${item.knownText}" → "${item.targetText}"`)
        })
      }
    }
  }

  const rounds: Round[] = []

  for (const [roundNum, roundItems] of byRound.entries()) {
    // Find the intro item to get the primary LEGO for this round
    const introItem = roundItems.find(i => i.type === 'intro')
    const primaryLegoKey = introItem?.legoKey || roundItems[0]?.legoKey || ''
    const primarySeedId = introItem?.seedId || roundItems[0]?.seedId || ''

    // Build ALL cycles with audio (including intro as first cycle)
    // Intro cycle: sourceId=presentation_audio, target1/target2 same as debut, NO PAUSE
    // Debut/other cycles: sourceId=known_audio, target1/target2, dynamic pause
    // All use the same audio pattern: sourceId → target1 → target2
    // Include ALL items - don't filter by hasAudio
    // Content structure must be correct first, audio validation happens at playback
    const cycles: Cycle[] = roundItems
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
