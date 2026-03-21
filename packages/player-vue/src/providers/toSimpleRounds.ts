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
  bootUpTimeMs: 1500,
  scaleFactor: 2.5
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

/**
 * Target language playback speed configuration.
 * Set per-course (e.g. from courses table or voice config).
 *
 * Two layers of speed control, multiplied together (floor: 0.7x):
 *
 * 1. CONTEXT SPEED — how familiar is the learner with this item?
 *    - introSpeed:       intro/debut/component_intro/build (first encounter)  default 0.8
 *    - firstReviewSpeed: spaced_rep N-1 (just learned last round)             default 0.9
 *    - reviewSpeed:      spaced_rep N-2+ and USE phrases                      default 1.0
 *
 * 2. SEED RAMP — early seeds get an additional slowdown that fades out.
 *    - rampSeeds: how many seeds to ramp over (0 = disabled)                  default 10
 *    - rampStartSpeed: multiplier at seed 1                                   default 0.88
 *    Linear interpolation from rampStartSpeed to 1.0 over rampSeeds seeds.
 *
 * Final speed = globalSpeed × contextSpeed × seedRamp, clamped to [0.7, globalSpeed].
 *
 * globalSpeed is a base multiplier to compensate for voices recorded at
 * non-standard speeds (e.g. 0.9 for a naturally slow voice, 1.1 for fast).
 */
export interface TargetSpeedConfig {
  globalSpeed?: number        // base multiplier (default 1.0)
  introSpeed?: number         // new items in intro round (default 0.8)
  firstReviewSpeed?: number   // N-1 spaced rep (default 0.9)
  reviewSpeed?: number        // N-2+ spaced rep / USE (default 1.0)
  rampSeeds?: number          // seeds to ramp over, 0=disabled (default 10)
  rampStartSpeed?: number     // ramp multiplier at seed 1 (default 0.88)

  /** @deprecated Use rampSeeds instead. Kept for backwards compat. */
  beltRamp?: boolean
}

const MIN_SPEED = 0.7

/** Extract seed number from seedId like "S0001" → 1 */
function seedNumberFromId(seedId: string): number {
  const match = seedId.match(/\d+/)
  return match ? parseInt(match[0], 10) : 0
}

/** Seed ramp: linear interpolation from rampStartSpeed to 1.0 over rampSeeds */
function seedRampMultiplier(seedNumber: number, config: TargetSpeedConfig): number {
  const rampSeeds = config.rampSeeds ?? (config.beltRamp ? 20 : 10)
  if (rampSeeds <= 0 || seedNumber > rampSeeds) return 1.0
  const startSpeed = config.rampStartSpeed ?? 0.88
  // Linear: seed 1 = startSpeed, seed rampSeeds = 1.0
  const t = Math.max(0, (seedNumber - 1) / (rampSeeds - 1))
  return startSpeed + t * (1.0 - startSpeed)
}

/** Context speed based on item type and review distance */
function contextSpeed(
  type: string,
  roundNumber: number,
  reviewOf: number | undefined,
  config: TargetSpeedConfig
): number {
  // New items: intro, debut, component_intro, build, component_practice
  if (type === 'intro' || type === 'debut' || type === 'component_intro' || type === 'build' || type === 'component_practice') {
    return config.introSpeed ?? 0.8
  }
  // Spaced rep: check review distance
  if (type === 'spaced_rep' && reviewOf !== undefined) {
    const distance = roundNumber - reviewOf
    if (distance <= 1) return config.firstReviewSpeed ?? 0.9
    return config.reviewSpeed ?? 1.0
  }
  // USE phrases (in the intro round) and everything else
  return config.reviewSpeed ?? 1.0
}

/** Compute final playback speed for an item */
function computePlaybackSpeed(
  type: string,
  seedNumber: number,
  roundNumber: number,
  reviewOf: number | undefined,
  config: TargetSpeedConfig
): number {
  const base = config.globalSpeed ?? 1.0
  const ctx = contextSpeed(type, roundNumber, reviewOf, config)
  const ramp = seedRampMultiplier(seedNumber, config)
  const speed = Math.round(base * ctx * ramp * 100) / 100
  return Math.max(MIN_SPEED, Math.min(speed, base))
}

export function toSimpleRounds(
  items: ScriptItem[],
  pauseConfig: PauseConfig = DEFAULT_PAUSE_CONFIG,
  targetSpeed: TargetSpeedConfig = {}
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
    // listening items only need target audio, other items need all three audio IDs
    const cycles: Cycle[] = []
    let skippedNoAudio = 0
    for (const i of roundItems) {
      if (i.type === 'listening' || i.type === 'component_intro') {
        if (!i.target1Id) { skippedNoAudio++; continue }
      } else if (i.type !== 'intro') {
        if (!i.knownAudioId || !i.target1Id || !i.target2Id) { skippedNoAudio++; continue }
      }

      // Intro/component_intro: use presentationAudioId as prompt audio
      // ("The Spanish for 'want', as in 'I want to learn', is:")
      // Regular items: use knownAudioId (the known-language prompt)
      const promptAudioId = (i.type === 'intro' || i.type === 'component_intro')
        ? (i.presentationAudioId || i.knownAudioId)
        : i.knownAudioId

      // Target speed: explicit (listening mode) → context-aware ramp → 1.0
      const speed = i.playbackSpeed ?? computePlaybackSpeed(
        i.type,
        seedNumberFromId(i.seedId || primarySeedId),
        i.roundNumber,
        i.reviewOf,
        targetSpeed
      )

      cycles.push({
        id: i.uuid,
        legoId: i.legoKey,
        known: {
          text: i.knownText,
          audioUrl: audioUrl(promptAudioId)
        },
        target: {
          text: i.targetText,
          ...(i.targetTextNative ? { textNative: i.targetTextNative } : {}),
          voice1Url: audioUrl(i.target1Id),
          voice2Url: audioUrl(i.target2Id)
        },
        // Intro/listening/component_intro has no pause (learner doesn't know it yet / passive listening)
        // Other cycles: dynamic pause based on target audio lengths
        pauseDuration: (i.type === 'intro' || i.type === 'listening' || i.type === 'component_intro')
          ? 0
          : calculatePauseDuration(i.target1DurationMs, i.target2DurationMs, pauseConfig, i.targetText),
        // Intro/component_intro: linger after voice2 so learner can read
        ...(i.type === 'intro' ? { lingerMs: 2000 } : {}),
        ...(i.type === 'component_intro' ? { lingerMs: 1500 } : {}),
        ...(i.componentLegoIds ? { componentLegoIds: i.componentLegoIds } : {}),
        ...(i.componentLegoTexts ? { componentLegoTexts: i.componentLegoTexts } : {}),
        ...(i.componentLegoTextsNative ? { componentLegoTextsNative: i.componentLegoTextsNative } : {}),
        ...(i.components ? { components: i.components } : {}),
        ...(i.componentsNative ? { componentsNative: i.componentsNative } : {}),
        ...(speed !== 1.0 ? { playbackSpeed: speed } : {})
      })
    }

    if (skippedNoAudio > 0) {
      console.warn(`[toSimpleRounds] Round ${roundNum}: skipped ${skippedNoAudio}/${roundItems.length} items due to missing audio IDs`)
    }
    if (cycles.length === 0) continue

    rounds.push({
      roundNumber: roundNum,
      legoId: primaryLegoKey,
      seedId: primarySeedId,
      // Canonical LEGO text from intro item — avoids fragile cycle-ID scanning
      ...(introItem ? {
        legoTargetText: introItem.targetText,
        legoKnownText: introItem.knownText,
        ...(introItem.targetTextNative ? { legoTargetTextNative: introItem.targetTextNative } : {})
      } : {}),
      cycles
    })
  }

  // Sort by roundNumber to maintain learning sequence
  rounds.sort((a, b) => a.roundNumber - b.roundNumber)

  return rounds
}
