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

const CJK_REGEX = /[\u3000-\u9fff\uac00-\ud7af\uff00-\uffef]/

export interface PauseConfig {
  bootUpTimeMs: number    // Cognitive boot-up time (default: 2000ms)
  scaleFactor: number     // Scale factor for target audio duration (default: 0.75)
}

export const DEFAULT_PAUSE_CONFIG: PauseConfig = {
  bootUpTimeMs: 2000,
  scaleFactor: 1.5
}

const audioUrl = (uuid: string | undefined): string => {
  if (!uuid) return ''
  return `/api/audio/${uuid}`
}

/**
 * Estimate speech duration from text when DB duration is missing.
 * CJK: ~300ms per character. Other: ~250ms per word.
 */
function estimateDurationMs(targetText: string): number {
  if (!targetText) return 2000
  if (CJK_REGEX.test(targetText)) {
    const chars = [...targetText].filter(c => CJK_REGEX.test(c)).length
    return Math.max(800, chars * 300)
  }
  const words = targetText.trim().split(/\s+/).length
  return Math.max(800, words * 250)
}

/**
 * Calculate pause duration based on target audio length
 * Formula: bootUpTime + scaleFactor * target1Duration
 */
function calculatePauseDuration(
  target1DurationMs: number | undefined,
  target2DurationMs: number | undefined,
  config: PauseConfig,
  targetText?: string
): number {
  const t1 = target1DurationMs || estimateDurationMs(targetText || '')

  // bootUp (2s) + 1.5x target1 duration
  return Math.round(config.bootUpTimeMs + config.scaleFactor * t1)
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

    // Build cycles — intros always included (define round structure),
    // non-intro items need all three audio IDs
    const cycles: Cycle[] = []
    for (const i of roundItems) {
      if (i.type !== 'intro') {
        if (!i.knownAudioId || !i.target1Id || !i.target2Id) continue
      }

      cycles.push({
        id: i.uuid,
        legoId: i.legoKey,
        known: {
          text: i.knownText,
          audioUrl: audioUrl(i.knownAudioId)
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
          : calculatePauseDuration(i.target1DurationMs, i.target2DurationMs, pauseConfig, i.targetText),
        ...(i.componentLegoIds ? { componentLegoIds: i.componentLegoIds } : {}),
        ...(i.componentLegoTexts ? { componentLegoTexts: i.componentLegoTexts } : {})
      })
    }

    if (cycles.length === 0) continue

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
