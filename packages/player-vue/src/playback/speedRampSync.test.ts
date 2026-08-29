import { describe, it, expect } from 'vitest'
import { toSimpleRounds, computeCycleSpeed, type TargetSpeedConfig } from '../providers/toSimpleRounds'
import type { ScriptItem } from '../providers/generateLearningScript'
import { backendCyclesToRounds, infPlayCyclesToRounds } from '../providers/backendCyclesToRounds'
import type { BackendCycle, RoundMap } from '../composables/useInstantPlayback'
import { computePauseDuration } from './computePauseDuration'
import { DEFAULT_FAST } from '../composables/useAlgorithmConfig'

// REGRESSION (2026-08-04): the belt speed ramp silently stopped applying for
// every learner.
//
// Target-voice speed is BAKED onto each cycle as `cycle.playbackSpeed` at
// round-build time. There are TWO round-builders:
//
//   legacy  : generateLearningScript → toSimpleRounds        (bakes the ramp)
//   instant : /cycles → backendCyclesToRounds                (baked NOTHING)
//
// `INSTANT_PLAYBACK_ALL = true` (LearningPlayer.vue) routes every course down
// the instant builder, so in practice NO learner got a ramp: a White-belt
// beginner played at flat 1.0× where the curve says 0.8×.
//
// It went unnoticed because the play-time override of the day only ever
// CANCELLED a baked ramp — it never applied one — so an unbaked cycle just
// played flat forever, with no error and no log. (That override is gone as of
// 2026-08-07: it was also how Easy flattened the ramp for itself. See
// easyFastSpeedParity.test.ts.)
//
// (The damage used to be two-sided: `computePauseDuration` also took the baked
// speed as a belt proxy, so an unbaked cycle got the green-belt pause too. That
// coupling was removed on 2026-08-29 — speed no longer touches the gap at all.)
//
// These tests pin the invariant that actually broke: BOTH builders must bake
// the SAME speed for the same course config and belt band.

const NATIVE_COURSE: TargetSpeedConfig = { globalSpeed: 1.0, nativeSpeed: true }
/** fra_for_eng shape: voice_config.target_speed = { global_speed: 0.95 }. */
const FRENCH_COURSE: TargetSpeedConfig = { globalSpeed: 0.95, nativeSpeed: true }
/** Legacy course recorded at a non-1.0 voice speed — ramp deliberately off. */
const LEGACY_COURSE: TargetSpeedConfig = { globalSpeed: 0.9, nativeSpeed: false }

/** One representative seed per belt band, with the speed the curve owes it. */
const BANDS = [
  { belt: 'white', seed: 1, expected: 0.8 },
  { belt: 'white', seed: 7, expected: 0.8 },
  { belt: 'yellow', seed: 8, expected: 0.9 },
  { belt: 'yellow', seed: 19, expected: 0.9 },
  { belt: 'orange', seed: 20, expected: 0.95 },
  { belt: 'orange', seed: 39, expected: 0.95 },
  { belt: 'green', seed: 40, expected: 1.0 },
  { belt: 'green', seed: 400, expected: 1.0 },
] as const

const T1_MS = 1400
const T2_MS = 1600

function scriptItem(seed: number): ScriptItem {
  const seedId = `S${String(seed).padStart(4, '0')}`
  return {
    uuid: `${seedId}L01C01`,
    cycleNum: 1,
    roundNumber: seed,
    seedId,
    legoKey: `${seedId}L01`,
    seedCode: seedId,
    legoCode: 'L01',
    type: 'build',
    knownText: 'I want to learn',
    targetText: 'je veux apprendre',
    knownAudioId: 'known-uuid',
    target1Id: 't1-uuid',
    target2Id: 't2-uuid',
    target1DurationMs: T1_MS,
    target2DurationMs: T2_MS,
    isNew: false,
  }
}

function backendCycle(seed: number): BackendCycle {
  const seedId = `S${String(seed).padStart(4, '0')}`
  return {
    id: `${seedId}L01C01`,
    type: 'build',
    lego_id: `${seedId}L01`,
    seed_number: seed,
    known_text: 'I want to learn',
    target_text: 'je veux apprendre',
    audio: { known_id: 'known-uuid', target1_id: 't1-uuid', target2_id: 't2-uuid' },
    durations: { target1_ms: T1_MS, target2_ms: T2_MS },
    is_new: false,
  }
}

/** Build the instant path's Round[] for a single seed. */
function instantCycleFor(seed: number, cfg: TargetSpeedConfig) {
  const cycles = [backendCycle(seed)]
  const map: RoundMap = {
    course_code: 'fra_for_eng',
    version: 1,
    rounds: [{ r: seed, legoId: `S${String(seed).padStart(4, '0')}L01`, seed }],
  }
  const rounds = backendCyclesToRounds(() => cycles, map, () => true, cfg)
  expect(rounds).toHaveLength(1)
  return rounds[0].cycles[0]
}

/** Build the legacy path's Round[] for a single seed. */
function legacyCycleFor(seed: number, cfg: TargetSpeedConfig) {
  const rounds = toSimpleRounds([scriptItem(seed)], cfg)
  expect(rounds).toHaveLength(1)
  return rounds[0].cycles[0]
}

describe('belt speed ramp — builder parity', () => {
  // THE test that would have caught the regression: the two round-builders
  // must agree, cycle for cycle. Before the fix the instant column was
  // `undefined` for every band while the legacy column ran 0.8 → 1.0.
  it.each(BANDS)(
    'both builders bake $expected× at seed $seed ($belt belt)',
    ({ seed, expected }) => {
      const legacy = legacyCycleFor(seed, NATIVE_COURSE)
      const instant = instantCycleFor(seed, NATIVE_COURSE)

      // `playbackSpeed` is omitted at exactly 1.0 by BOTH builders (Green
      // belt), so compare through the same `?? 1.0` default the runtime uses.
      expect(instant.playbackSpeed ?? 1.0).toBe(expected)
      expect(legacy.playbackSpeed ?? 1.0).toBe(expected)
      expect(instant.playbackSpeed).toBe(legacy.playbackSpeed)
    },
  )

  it('a White-belt beginner is NOT left at flat 1.0× on the instant path', () => {
    // The literal symptom Kai reported: "the audio isn't being slowed down".
    const cycle = instantCycleFor(1, NATIVE_COURSE)
    expect(cycle.playbackSpeed).toBeDefined()
    expect(cycle.playbackSpeed).toBeLessThan(1.0)
  })

  it("honours the course's global_speed on the instant path", () => {
    // fra_for_eng: global 0.95. White = 0.95 × 0.8 = 0.76; Green = flat 0.95.
    expect(instantCycleFor(1, FRENCH_COURSE).playbackSpeed).toBe(0.76)
    expect(instantCycleFor(40, FRENCH_COURSE).playbackSpeed).toBe(0.95)
    expect(instantCycleFor(1, FRENCH_COURSE).playbackSpeed)
      .toBe(legacyCycleFor(1, FRENCH_COURSE).playbackSpeed)
  })

  it('leaves non-native courses flat at global_speed on both paths', () => {
    // nativeSpeed:false = voice already recorded slow; ramping again would
    // stack two slowdowns. Both builders must agree on the opt-out too.
    for (const { seed } of BANDS) {
      expect(instantCycleFor(seed, LEGACY_COURSE).playbackSpeed).toBe(0.9)
      expect(legacyCycleFor(seed, LEGACY_COURSE).playbackSpeed).toBe(0.9)
    }
  })

  it('defaults to flat 1.0× when no course config is supplied', () => {
    // Test/legacy callers that pass nothing keep the old shape — the default
    // must stay inert, not accidentally ramp.
    expect(instantCycleFor(1, {}).playbackSpeed).toBeUndefined()
    expect(computeCycleSpeed(1, {})).toBe(1.0)
  })

  it('bakes the ramp on INF PLAY rounds too', () => {
    const rounds = infPlayCyclesToRounds(
      [{ ...backendCycle(3), inf_round: 1 } as BackendCycle],
      100,
      FRENCH_COURSE,
    )
    expect(rounds[0].cycles[0].playbackSpeed).toBe(0.76)
  })
})

describe('gap model — playback speed is NOT an input', () => {
  // FLIPPED 2026-08-29 (Tom's ruling: "playback speed must no longer influence
  // gap length at all"). These two tests previously asserted the OPPOSITE —
  // that the baked belt speed drove a pause taper, so a White-belt cycle got a
  // longer gap than a Green-belt one. That coupling was accidental: the gap is
  // the time to build and say the TARGET sentence, which does not change
  // because the audio is played back slower. The gap is now
  // k × native answer duration + a reaction beat, and nothing else.
  it('gives a White-belt and a Green-belt cycle the SAME pause', () => {
    const white = instantCycleFor(1, NATIVE_COURSE)
    const green = instantCycleFor(400, NATIVE_COURSE)
    expect(white.playbackSpeed ?? 1).toBeLessThan(green.playbackSpeed ?? 1)
    expect(white.pauseDuration).toBe(green.pauseDuration)
  })

  it('the runtime pause override ignores the baked speed entirely', () => {
    // Mirrors LearningPlayer's `getPauseDuration` override: no speed argument.
    const white = instantCycleFor(1, NATIVE_COURSE)
    const runtimePause = computePauseDuration(
      white.target1DurationMs ?? 0,
      white.target2DurationMs ?? 0,
      DEFAULT_FAST,
    )
    expect(runtimePause).toBe(computePauseDuration(T1_MS, T2_MS, DEFAULT_FAST))
  })

  it('is k × the average native duration + the reaction beat', () => {
    const answer = (T1_MS + T2_MS) / 2
    expect(computePauseDuration(T1_MS, T2_MS, DEFAULT_FAST))
      .toBe(Math.round(DEFAULT_FAST.pause_k! * answer + DEFAULT_FAST.pause_reaction_ms!))
  })
})

// A block here guarded Turbo's speed override against double-applying the
// baked belt ramp. It went with Turbo (retired 2026-08-06), and there is no
// longer any speed override to guard: SimplePlayerRuntimeOverrides exposes no
// speed callback, and playback rate comes from exactly one source, the baked
// `cycle.playbackSpeed`. The block was left testing a helper defined inside
// its own describe, so it could not have caught a regression anyway.
