/**
 * toSimpleRounds - Convert ScriptItem[] to SimplePlayer's Round[] format
 *
 * This is the only conversion layer needed. No RoundBuilder. No roundAdapter.
 *
 * generateLearningScript() → toSimpleRounds() → SimplePlayer.initialize()
 *
 * Pause duration: see computePauseDuration.ts — single helper driven by the
 * admin-controlled ModeConfig (algorithm_config table). The baked value below
 * uses DEFAULT_FAST as a fallback; LearningPlayer's runtime override
 * recomputes from the live config so admin tweaks affect both the visible
 * countdown and the actual setTimeout in lockstep.
 */

import type { ScriptItem } from './generateLearningScript'
import type { Round, Cycle } from '../playback/SimplePlayer'
import { computePauseDuration } from '../playback/computePauseDuration'
import { DEFAULT_FAST } from '../composables/useAlgorithmConfig'
import { reportIntroAudioMissing } from '../playback/introAudioTelemetry'

const audioUrl = (uuid: string | undefined): string => {
  if (!uuid) return ''
  return `/api/audio/${uuid}`
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
  nativeSpeed?: boolean       // true = recorded at 1.0x, apply belt ramp. false = legacy, no ramp.
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

/**
 * Belt-based speed: the belt determines the speed. One simple ramp for ALL items
 * (new and spaced-rep alike), keyed to the canonical belt seed boundaries
 * (BELT_MAX_SEEDS: white ≤7, yellow ≤19, orange ≤39, green 40+):
 *
 *   White 0.8 → Yellow 0.9 → Orange 0.95 → Green+ 1.0
 */
export function beltSpeed(seedNumber: number): number {
  if (seedNumber < 8) return 0.8    // White  (seeds 1-7)
  if (seedNumber < 20) return 0.9   // Yellow (seeds 8-19)
  if (seedNumber < 40) return 0.95  // Orange (seeds 20-39)
  return 1.0                        // Green+ (seeds 40+)
}

/**
 * Final baked target-voice speed for a cycle at `seedNumber`.
 *
 * THE one speed curve. Both round-builders call it — the legacy
 * `toSimpleRounds` (script-gen path) and `backendCyclesToRounds` (the
 * instant-playback path). Keeping it in one exported place is what stops
 * the two builders drifting apart again: they were out of sync from the
 * instant-playback cutover until 2026-08-04, and every learner on the new
 * path silently played at a flat 1.0×.
 *
 * The value is BAKED onto the cycle as `cycle.playbackSpeed`. Two runtime
 * consumers depend on it being the truth of what the voice plays at:
 *   • The mode override's `getPlaybackSpeedMultiplier` cancels it (target / baked).
 *   • `getPauseDuration` uses it as the BELT PROXY — `beltProgress(speed)`
 *     maps 0.8→White … 1.0→Green. An absent speed therefore reads as Green
 *     and hands a beginner the fully-tapered green-belt pause.
 * So the curve must be applied HERE, at bake time — a play-time-only
 * multiplier would fix the voice and leave the pause wrong.
 */
export function computeCycleSpeed(
  seedNumber: number,
  config: TargetSpeedConfig
): number {
  const base = config.globalSpeed ?? 1.0

  // Legacy courses (recorded at slower speeds): no belt ramp, play at base speed
  if (!config.nativeSpeed) return base

  // Native speed courses: apply the single belt-based ramp (new + review alike)
  const speed = Math.round(base * beltSpeed(seedNumber) * 100) / 100
  return Math.max(MIN_SPEED, Math.min(speed, base))
}

/** Compute final playback speed for a script item */
function computePlaybackSpeed(
  _type: string,
  seedNumber: number,
  _roundNumber: number,
  _reviewOf: number | undefined,
  config: TargetSpeedConfig
): number {
  return computeCycleSpeed(seedNumber, config)
}

/**
 * Generator core shared by the sync and cooperative converters. Yields a
 * checkpoint per round so the cooperative wrapper can hand the main thread
 * back mid-conversion (post-READY interactivity, founder 2026-07-30) while
 * the sync wrapper drains it in one pass, byte-identical to the old code.
 */
function* toSimpleRoundsGen(
  items: ScriptItem[],
  targetSpeed: TargetSpeedConfig
): Generator<void, Round[], void> {
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
    yield
    // Find the intro item to get the primary LEGO for this round
    const introItem = roundItems.find(i => i.type === 'intro')
    const primaryLegoKey = introItem?.legoKey || roundItems[0]?.legoKey || ''
    const primarySeedId = introItem?.seedId || roundItems[0]?.seedId || ''

    // Build cycles — intros always included (define round structure),
    // listening items only need target audio, other items need all three audio IDs
    const cycles: Cycle[] = []
    let skippedNoAudio = 0
    for (const i of roundItems) {
      if (i.type === 'listening') {
        // Listening cycles now carry one audio per cycle (one playlist
        // entry: ps/ps2x → target1Id, trans → knownAudioId). Either is
        // acceptable; missing both means a stale row to skip.
        if (!i.knownAudioId && !i.target1Id) { skippedNoAudio++; continue }
      } else if (i.type === 'component_intro') {
        if (!i.target1Id) { skippedNoAudio++; continue }
      } else if (i.type === 'listen_intro' || i.type === 'listen_outro') {
        // Bookends play one known-language clip with no target voices.
        if (!i.knownAudioId) { skippedNoAudio++; continue }
      } else if (i.type === 'pod') {
        // Pod plays carry exactly one of {knownAudioId (translation play),
        // target1Id (target play at slow/fast/2× via playbackSpeed)}.
        if (!i.knownAudioId && !i.target1Id) { skippedNoAudio++; continue }
      } else if (i.type === 'spaced_rep' && i.reviewItemKind === 'seed') {
        // Drained SEED-PHASE review sub-cycles (the t→k→t→t sandwich) carry
        // exactly one of {knownAudioId, target1Id}, same shape as pod plays.
        if (!i.knownAudioId && !i.target1Id) { skippedNoAudio++; continue }
      } else if (i.type !== 'intro') {
        if (!i.knownAudioId || !i.target1Id || !i.target2Id) { skippedNoAudio++; continue }
      }

      // Intro/component_intro: use presentationAudioId as prompt audio
      // ("The Spanish for 'want', as in 'I want to learn', is:")
      // Regular items: use knownAudioId (the known-language prompt)
      const isIntroLike = i.type === 'intro' || i.type === 'component_intro'
      const promptAudioId = isIntroLike
        ? (i.presentationAudioId || i.knownAudioId)
        : i.knownAudioId

      // The fallback point. Until 2026-08-04 this branch was silent in both
      // senses: it quietly degraded to known audio (or to nothing), and it
      // emitted no telemetry, so a course-wide presentation-audio gap was
      // invisible until a learner reported it. See introAudioTelemetry.ts.
      if (isIntroLike && !i.presentationAudioId) {
        reportIntroAudioMissing({
          legoId: i.legoKey,
          cycleId: i.uuid,
          cycleType: i.type,
          tier: i.knownAudioId ? 'known_fallback' : 'silent',
          source: 'script',
        })
      }

      // Target speed: explicit (listening mode) → context-aware ramp → 1.0
      const speed = i.playbackSpeed ?? computePlaybackSpeed(
        i.type,
        seedNumberFromId(i.seedId || primarySeedId),
        i.roundNumber,
        i.reviewOf,
        targetSpeed
      )

      const isBookend = i.type === 'listen_intro' || i.type === 'listen_outro'
      const isPod = i.type === 'pod'
      const isSeedSandwich = i.type === 'spaced_rep' && i.reviewItemKind === 'seed'

      cycles.push({
        id: i.uuid,
        type: i.type,
        legoId: i.legoKey,
        known: {
          text: i.knownText,
          audioUrl: audioUrl(promptAudioId)
        },
        target: {
          // Bookends carry no target text/audio — SimplePlayer's voice1/voice2
          // phases gracefully skip when URLs are empty.
          // Pods: target1 holds the play audio for slow/fast/2× (with
          // playbackSpeed); voice2 always empty (single-play cycle).
          text: i.targetText,
          ...(i.targetTextNative ? { textNative: i.targetTextNative } : {}),
          voice1Url: isBookend ? '' : audioUrl(i.target1Id),
          voice2Url: (isBookend || isPod) ? '' : audioUrl(i.target2Id)
        },
        // Expose raw target durations so the runtime mode override can
        // recompute pauseDuration with their own formula instead of just
        // scaling the baked value.
        ...(i.target1DurationMs ? { target1DurationMs: i.target1DurationMs } : {}),
        ...(i.target2DurationMs ? { target2DurationMs: i.target2DurationMs } : {}),
        // At-most-one-audio-track cycles: lets SimplePlayer suppress its
        // "no audio, skipping" warnings for the phases left empty by design.
        ...((isBookend || isPod || i.type === 'listening' || isSeedSandwich) ? { singleAudio: true } : {}),
        // Intro/listening/component_intro/bookends/pods/drained-seed-sandwich:
        // no pause — each sub-cycle carries at most one audio track, chained
        // straight through on 'ended' (no production-recall gap). Other
        // cycles: dynamic pause based on target audio lengths.
        pauseDuration: (i.type === 'intro' || i.type === 'listening' || i.type === 'component_intro' || isBookend || isPod || isSeedSandwich)
          ? 0
          : computePauseDuration(i.target1DurationMs ?? 0, i.target2DurationMs ?? 0, DEFAULT_FAST, speed),
        // Intro/component_intro: linger after voice2 so learner can read
        ...(i.type === 'intro' ? { lingerMs: 2000 } : {}),
        ...(i.type === 'component_intro' ? { lingerMs: 1500 } : {}),
        ...(i.componentLegoIds ? { componentLegoIds: i.componentLegoIds } : {}),
        ...(i.componentLegoTexts ? { componentLegoTexts: i.componentLegoTexts } : {}),
        ...(i.componentLegoTextsNative ? { componentLegoTextsNative: i.componentLegoTextsNative } : {}),
        ...(i.decomposition ? { decomposition: i.decomposition } : {}),
        ...(i.displayTiling ? { displayTiling: i.displayTiling } : {}),
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

export function toSimpleRounds(
  items: ScriptItem[],
  targetSpeed: TargetSpeedConfig = {}
): Round[] {
  const gen = toSimpleRoundsGen(items, targetSpeed)
  for (;;) {
    const step = gen.next()
    if (step.done) return step.value
  }
}

/**
 * Cooperative variant for the ready-gated deferred handoff: identical output
 * to toSimpleRounds, but awaits `yieldTick` at each per-round checkpoint so
 * a whole-course conversion can't hold the main thread past the tick's
 * slice budget (see generateLearningScript's makeSliceYielder).
 */
export async function toSimpleRoundsCooperative(
  items: ScriptItem[],
  targetSpeed: TargetSpeedConfig = {},
  yieldTick?: () => Promise<void>
): Promise<Round[]> {
  const gen = toSimpleRoundsGen(items, targetSpeed)
  for (;;) {
    const step = gen.next()
    if (step.done) return step.value
    if (yieldTick) await yieldTick()
  }
}
