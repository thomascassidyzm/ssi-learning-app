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
import { capRoundCycles, cyclePromptIdentity } from '../playback/capConsecutiveRepeats'
import { apiUrl } from '@/platform/apiBase'
import {
  playbackSpeedForVoice, voicePaceForSlot, MIN_SPEED,
  type CourseVoicePace, type PaceMode,
} from '@ssi/core'

const audioUrl = (uuid: string | undefined): string => {
  if (!uuid) return ''
  return apiUrl(`/api/audio/${uuid}`)
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
  nativeSpeed?: boolean       // true = recorded at 1.0x, per-voice rule applies. false = legacy, left alone.
  introSpeed?: number         // new items in intro round (default 0.8)
  firstReviewSpeed?: number   // N-1 spaced rep (default 0.9)
  reviewSpeed?: number        // N-2+ spaced rep / USE (default 1.0)
  rampSeeds?: number          // seeds to ramp over, 0=disabled (default 10)
  rampStartSpeed?: number     // ramp multiplier at seed 1 (default 0.88)

  /**
   * The learner's setting. THE RULE TAKES A MODE (Tom, 2026-08-29): target
   * language on Easy is 0.80 of the language's reference pace, on Fast 0.90.
   *
   * This supersedes the 2026-08-07 ruling that no mode may touch the baked
   * speed. That ruling existed because Easy used to be a play-time multiplier
   * ON TOP of the belt ramp and made beginners on the gentle mode hear FASTER
   * speech than beginners on Fast. Under the new rule that inversion is
   * structurally impossible — 0.80 < 0.90 for every voice, asserted in
   * `@ssi/core`'s voicePace.test.ts — and mode is still applied once, at bake
   * time, from here. Toggling mode rebuilds the script (the dedupe key in
   * LearningPlayer carries `learningMode`), so the bake stays correct.
   *
   * Absent ⇒ 'easy', the cautious of the two.
   */
  mode?: PaceMode

  /**
   * Per-voice pace facts for THIS course, derived from the clips it actually
   * ships (plate S-345). Absent ⇒ no correction: the mode's target pace is
   * used unchanged, exactly as it would be with no per-voice pace at all.
   */
  voicePace?: CourseVoicePace | null

  /** @deprecated Use rampSeeds instead. Kept for backwards compat. */
  beltRamp?: boolean
}

/** Extract seed number from seedId like "S0001" → 1 */
function seedNumberFromId(seedId: string): number {
  const match = seedId.match(/\d+/)
  return match ? parseInt(match[0], 10) : 0
}

/**
 * THE RETIRED BELT RAMP — white 0.8 → yellow 0.9 → orange 0.95 → green 1.0.
 *
 * Tom, 2026-08-29 (plate S-345): "We also have a FAST setting — which could
 * perhaps be a flat 0.9x … Then we can dispense with the belt ramp chicanery?"
 * Speed is now a function of ROLE and MODE, never of belt or seed, and
 * `computeCycleSpeed` no longer calls this.
 *
 * It survives as an exported function for exactly one reason: the LISTENING
 * tests still use it to assert that the listening path never took a belt term
 * and still doesn't. Nothing in the SPEAKING path may call it again.
 *
 * @deprecated The belt ramp is retired. Do not reintroduce it into any speed path.
 */
export function beltSpeed(seedNumber: number): number {
  if (seedNumber < 8) return 0.8    // White  (seeds 1-7)
  if (seedNumber < 20) return 0.9   // Yellow (seeds 8-19)
  if (seedNumber < 40) return 0.95  // Orange (seeds 20-39)
  return 1.0                        // Green+ (seeds 40+)
}

/**
 * Final baked target-voice speed for one target slot of a cycle.
 *
 * THE one speed curve. Both round-builders call it — the legacy
 * `toSimpleRounds` (script-gen path) and `backendCyclesToRounds` (the
 * instant-playback path). Keeping it in one exported place is what stops the
 * two builders drifting apart again: they were out of sync from the
 * instant-playback cutover until 2026-08-04, and every learner on the new path
 * silently played at a flat 1.0×.
 *
 * WHAT DECIDES THE NUMBER (Tom, 2026-08-29, plate S-345):
 *   1. The RULE — target language on Easy 0.80, on Fast 0.90, of the
 *      LANGUAGE'S reference pace. Not the belt. `@ssi/core`'s voicePace.ts is
 *      the only implementation of it, shared with the dashboard's
 *      services/shared/voice-pace.cjs via a common case-table fixture.
 *   2. The PER-VOICE CORRECTION — divided by the measured pace of the voice
 *      that ACTUALLY RENDERED this course's clips, so "Easy" means the same
 *      thing to a learner whichever voice is speaking. Clamped to [0.7, 1.0]:
 *      the floor because slower than that sounds broken, the ceiling because
 *      nothing in the estate is minted above 1.0× and playing a clip faster
 *      than it was rendered is a behaviour nobody asked for.
 *   3. The COURSE/LEARNER BASE (`globalSpeed`) — kept, deliberately. It is two
 *      things multiplied: a per-course compensation (0.9 on deu_for_eng and
 *      fra_for_eng, live 2026-09-07) and the learner's own speed preference
 *      from Settings. Retiring it would silently speed those two courses up by
 *      11% for every learner and would throw away a dial the learner set
 *      themselves. The brief retires the BELT ramp; this is the conservative
 *      reading of it. CALL TAKEN 2026-09-07, flagged for Tom.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: it does not take a belt, and it does not
 * read a seed. `_seedNumber` stays in the signature because every call site has
 * one and its DISUSE is the assertion — the same idiom `computeListeningSpeed`
 * uses below.
 *
 * `slot` is the audio slot being baked — 'target1' or 'target2'. They are
 * different voices with different measured paces, and one number for both is
 * how casting and pace drift apart. Where the course has facts for only one
 * target slot, the other borrows them (see `voicePaceForSlot`) and the payload
 * still names whose pace was used.
 */
export function computeCycleSpeed(
  _seedNumber: number,
  config: TargetSpeedConfig,
  slot: 'target1' | 'target2' = 'target1'
): number {
  const base = config.globalSpeed ?? 1.0

  // Legacy courses (voices recorded slow, `nativeSpeed: false`): left
  // byte-for-byte as they were. Those clips are ALREADY below native pace, so
  // the rule's correction would slow them twice. This branch is a guard, not
  // dead code — cym_s_for_eng and its siblings ride it.
  if (!config.nativeSpeed) return base

  const voice = voicePaceForSlot(config.voicePace, slot)
  const decision = playbackSpeedForVoice(voice, slot, config.mode ?? 'easy')
  const speed = Math.round(base * decision.speed * 100) / 100
  return Math.max(MIN_SPEED, Math.min(speed, base))
}

/**
 * The same decision, with its reasoning intact — for the one log line that
 * makes an unmeasured voice VISIBLE rather than a number nobody can explain.
 * `computeCycleSpeed` is the hot path and returns just the number.
 */
export function explainCycleSpeed(
  config: TargetSpeedConfig,
  slot: 'target1' | 'target2' = 'target1'
): { speed: number; voiceId: string | null; measured: boolean; reason: string } {
  const base = config.globalSpeed ?? 1.0
  if (!config.nativeSpeed) {
    return { speed: base, voiceId: null, measured: false,
      reason: `legacy course (nativeSpeed:false) — clips were recorded slow, so the rule does not touch them; base ${base}` }
  }
  const voice = voicePaceForSlot(config.voicePace, slot)
  const decision = playbackSpeedForVoice(voice, slot, config.mode ?? 'easy')
  return {
    speed: computeCycleSpeed(0, config, slot),
    voiceId: voice?.voiceId ?? null,
    measured: voice?.measured === true,
    reason: `${decision.reason}${base === 1.0 ? '' : `; × course/learner base ${base}`}`,
  }
}

/**
 * EASY-MODE LISTENING PACE — 1.0×, i.e. no Easy-specific slowing at all.
 *
 * Tom, 2026-08-10, testing listening live: "'Easy' seems to have slowed the
 * conversations in the listening section - I don't think we want to be doing
 * that"; "I think we can return the default listening speed settings to 1.0x on
 * EASY, I think we moved them to 0.8x." That superseded his T-13 ruling of
 * 2026-08-07 (Easy listening at 0.8×), which had shipped as `0.8` here.
 *
 * Since 2026-08-16 nothing in `computeListeningSpeed` reads a mode at all —
 * listening is never slowed for anyone (see that function). The constant
 * survives as the Dialogues overlay's opening speed, its one remaining
 * consumer, where it states the same thing: Easy opens at full pace.
 */
export const EASY_LISTENING_SPEED = 1.0

/**
 * Final playback rate for ONE target-language clip in a LISTENING exercise
 * (Layer-1 cups, Layer-2 pods, Stage-0 sequences, fusion drills).
 *
 * LISTENING IS NEVER SLOWED (Tom, 2026-08-16, confirming Aran). The clip plays
 * at its own role rate × the course speed, and nothing else: no belt ramp, no
 * mode adjustment, identical on Easy and Fast, identical at white belt and at
 * black. Exposure to full — and, through the pod role progression, *faster
 * than* full — speed is the point of the listening layer: it is what makes real
 * native speech feel like something the learner is already ready for. Slowing
 * it removes the very thing being trained.
 *
 * WHAT THIS REPLACES — the belt ramp added here on 2026-08-06 ("targ lang clips
 * start at 0.8×, then in yellow belt go to 0.9×…"), which applied `beltSpeed`
 * as a multiplier on the role rate. That ruling stands for SPEAKING and is
 * still baked by `computeCycleSpeed`; it should never have reached listening.
 * Do not reintroduce a belt term here — this function deliberately ignores the
 * seed it is handed, so belt-independence is structural rather than a comment.
 *
 * Known-language clips ('trans') never come through here — they're the meaning
 * anchor in the learner's own language and slowing them teaches nothing.
 *
 * @param roleSpeed   the clip's own role rate (1.0 for L1; ROLE_SPEED[role] for pods)
 * @param _seedNumber the belt anchor. IGNORED — kept in the signature because
 *                    every call site has it and its absence is the assertion.
 */
export function computeListeningSpeed(
  roleSpeed: number,
  _seedNumber: number,
  config: TargetSpeedConfig
): number {
  const base = config.globalSpeed ?? 1.0
  const round2 = (n: number) => Math.round(n * 100) / 100

  // Legacy courses (voices recorded slow): left byte-for-byte as it was — those
  // voices are already below native pace and nothing here may touch them.
  if (!config.nativeSpeed) return round2(roleSpeed * base)

  // Native-speed courses: role rate × course speed. No cap at `base` — `ps2x`
  // legitimately exceeds it, which is the over-speed exposure we want. The
  // MIN_SPEED floor stays as the guard against a pathologically slow config.
  return Math.max(MIN_SPEED, round2(roleSpeed * base))
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

      // Target speed: explicit (listening/pod override) → the role+mode rule,
      // corrected for the voice that rendered THIS slot.
      const explicit = i.playbackSpeed
      const speed = explicit ?? computePlaybackSpeed(
        i.type,
        seedNumberFromId(i.seedId || primarySeedId),
        i.roundNumber,
        i.reviewOf,
        targetSpeed
      )
      // Slot 2 only when it genuinely differs — an explicit override owns both
      // slots (pods play one clip), and an equal number is noise on the wire.
      const speed2 = explicit === undefined
        ? computeCycleSpeed(0, targetSpeed, 'target2')
        : undefined

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
        // Expose raw target durations so runtime overrides (the active
        // learning mode) can recompute pauseDuration with their own formula
        // instead of just scaling the baked value.
        ...(speed2 !== undefined && speed2 !== speed ? { voice2PlaybackSpeed: speed2 } : {}),
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
          : computePauseDuration(i.target1DurationMs ?? 0, i.target2DurationMs ?? 0, DEFAULT_FAST),
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

  // A-64 floor (Tom, 2026-08-06): no mode plays the same prompt more than
  // twice consecutively. generateLearningScript already caps its own output,
  // but this adapter drops cycles whose audio is missing — which can pull two
  // previously separated prompts together — so the last word belongs here,
  // immediately before SimplePlayer receives the rounds.
  return capRoundCycles(rounds, cyclePromptIdentity).rounds
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
