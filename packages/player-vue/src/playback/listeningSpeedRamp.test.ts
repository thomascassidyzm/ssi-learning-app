import { describe, it, expect } from 'vitest'
import {
  beltSpeed,
  computeCycleSpeed,
  computeListeningSpeed,
  EASY_LISTENING_SPEED,
  type TargetSpeedConfig,
} from '../providers/toSimpleRounds'
import { buildSeedPlays, L1_ROLE_SPEED } from '../composables/useLayer1Scheduler'
import { ROLE_SPEED } from '@ssi/core/pods'

// LISTENING IS NEVER SLOWED — Tom, 2026-08-16, confirming Aran's reading of the
// methodology: the listening layer deliberately exposes the learner to full
// (and, through the pod role progression, over-) speed, so real native speech
// arrives as something they are already ready for. Slowing it removes the thing
// being trained.
//
// WHAT THIS REPLACES: the belt ramp added to listening on 2026-08-06 (0.8 white
// → 0.9 yellow → 0.95 orange → 1.0 green) and the Easy-only cap of 2026-08-07.
// That belt ruling stands for SPEAKING and is still asserted below against
// `computeCycleSpeed` — the point of keeping both in one file is that the two
// sides can be seen to differ deliberately rather than by drift.

const NATIVE: TargetSpeedConfig = { globalSpeed: 1.0, nativeSpeed: true }
/** fra_for_eng shape: voice_config.target_speed = { global_speed: 0.95 }. */
const FRENCH: TargetSpeedConfig = { globalSpeed: 0.95, nativeSpeed: true }
/** Legacy course recorded at a non-1.0 voice speed — untouched by any of this. */
const LEGACY: TargetSpeedConfig = { globalSpeed: 0.9, nativeSpeed: false }

/** One seed per belt band, and the SPEAKING rate Tom named for it. */
const BANDS: Array<{ belt: string; seed: number; rate: number }> = [
  { belt: 'white', seed: 1, rate: 0.8 },
  { belt: 'white', seed: 7, rate: 0.8 },
  { belt: 'yellow', seed: 8, rate: 0.9 },
  { belt: 'yellow', seed: 19, rate: 0.9 },
  { belt: 'orange', seed: 20, rate: 0.95 },
  { belt: 'orange', seed: 39, rate: 0.95 },
  { belt: 'green', seed: 40, rate: 1.0 },
  { belt: 'green', seed: 400, rate: 1.0 },
]

describe('computeListeningSpeed — belt-independent, always full pace', () => {
  it.each(BANDS)('$belt belt (seed $seed) plays target clips at 1.0×', ({ seed }) => {
    expect(computeListeningSpeed(1.0, seed, NATIVE)).toBe(1.0)
  })

  it('THE RULE: a white-belt seed and a green-belt seed give the identical rate', () => {
    for (const role of [ROLE_SPEED.ps08x, ROLE_SPEED.ps, ROLE_SPEED.ps15x, ROLE_SPEED.ps2x]) {
      for (const cfg of [NATIVE, FRENCH, LEGACY]) {
        const white = computeListeningSpeed(role, 1, cfg)
        for (const { seed } of BANDS) {
          expect(computeListeningSpeed(role, seed, cfg)).toBe(white)
        }
      }
    }
  })

  it('diverges from the speaking curve wherever the belt would have bitten', () => {
    // Not a copy of speaking any more: below green, speaking is slower.
    for (const { seed, rate } of BANDS) {
      expect(computeCycleSpeed(seed, NATIVE)).toBe(rate)
      expect(computeCycleSpeed(seed, NATIVE)).toBe(beltSpeed(seed))
      if (rate < 1.0) {
        expect(computeListeningSpeed(1.0, seed, NATIVE)).toBeGreaterThan(computeCycleSpeed(seed, NATIVE))
      }
    }
  })

  it('folds in the course globalSpeed, and only that (French 0.95×)', () => {
    expect(computeListeningSpeed(1.0, 1, FRENCH)).toBe(0.95)
    expect(computeListeningSpeed(1.0, 40, FRENCH)).toBe(0.95)
  })

  it('leaves legacy slow-recorded courses exactly as they were', () => {
    expect(computeListeningSpeed(1.0, 1, LEGACY)).toBe(0.9)
    expect(computeListeningSpeed(1.0, 40, LEGACY)).toBe(0.9)
    expect(computeListeningSpeed(ROLE_SPEED.ps2x, 1, LEGACY)).toBe(1.8)
  })

  it('multiplies the pod role rate — the over-speed reps are the exposure', () => {
    // The pod stage progression is per-sentence maturity, and it is the ONLY
    // axis left that moves a listening clip's rate.
    expect(computeListeningSpeed(ROLE_SPEED.ps2x, 1, NATIVE)).toBe(2.0)
    expect(computeListeningSpeed(ROLE_SPEED.ps2x, 400, NATIVE)).toBe(2.0)
    expect(computeListeningSpeed(ROLE_SPEED.ps15x, 1, NATIVE)).toBe(1.5)
    expect(computeListeningSpeed(ROLE_SPEED.ps08x, 1, NATIVE)).toBe(0.8)
    for (const { seed } of BANDS) {
      const at = (r: number) => computeListeningSpeed(r, seed, NATIVE)
      expect(at(ROLE_SPEED.ps)).toBeLessThan(at(ROLE_SPEED.ps15x))
      expect(at(ROLE_SPEED.ps15x)).toBeLessThan(at(ROLE_SPEED.ps2x))
    }
  })

  it('keeps the 0.7 floor as a guard against a pathological course config', () => {
    expect(computeListeningSpeed(ROLE_SPEED.ps08x, 1, { globalSpeed: 0.8, nativeSpeed: true })).toBe(0.7)
  })

  it('has no mode term at all — there is no Easy/Fast fork left to take', () => {
    // EASY_LISTENING_SPEED survives only as the Dialogues overlay's opening
    // speed. Asserted here so lowering it stays a deliberate, visible act.
    expect(EASY_LISTENING_SPEED).toBe(1.0)
    for (const { seed } of BANDS) {
      for (const cfg of [NATIVE, FRENCH, LEGACY]) {
        expect(computeListeningSpeed(1.0, seed, cfg)).toBe(computeListeningSpeed(1.0, seed, { ...cfg }))
      }
    }
  })
})

describe('computeCycleSpeed — SPEAKING still ramps, untouched', () => {
  it.each(BANDS)('$belt belt (seed $seed) speaks at $rate×', ({ seed, rate }) => {
    expect(computeCycleSpeed(seed, NATIVE)).toBe(rate)
    expect(beltSpeed(seed)).toBe(rate)
  })

  it('folds in the course globalSpeed and caps at it', () => {
    expect(computeCycleSpeed(1, FRENCH)).toBe(0.76)  // 0.95 × 0.8
    expect(computeCycleSpeed(40, FRENCH)).toBe(0.95) // 0.95 × 1.0, capped at base
  })

  it('exempts legacy slow-recorded courses', () => {
    expect(computeCycleSpeed(1, LEGACY)).toBe(0.9)
    expect(computeCycleSpeed(40, LEGACY)).toBe(0.9)
  })

  it('holds the 0.7 floor', () => {
    expect(computeCycleSpeed(1, { globalSpeed: 0.8, nativeSpeed: true })).toBe(0.7)
  })
})

describe('Layer-1 sandwich (t·k·t·t) plays at full pace on every belt', () => {
  const seedAt = (n: number) => ({
    seedNumber: n,
    target1Id: 't1',
    target2Id: 't2',
    knownId: 'k',
    targetText: 'je veux apprendre',
    knownText: 'I want to learn',
  })

  it.each(BANDS)('$belt belt (seed $seed): every slot 1.0×', ({ seed }) => {
    const plays = buildSeedPlays(seedAt(seed), undefined, NATIVE)
    expect(plays.map((p) => p.role)).toEqual(['ps', 'trans', 'ps', 'ps'])
    expect(plays.map((p) => p.playbackSpeed)).toEqual([1.0, 1.0, 1.0, 1.0])
  })

  it('a white-belt French learner hears target and known alike, unslowed by belt', () => {
    const plays = buildSeedPlays(seedAt(1), undefined, FRENCH)
    const known = plays.filter((p) => p.role === 'trans')
    expect(known).toHaveLength(1)
    expect(known[0].playbackSpeed).toBe(1.0)
    expect(known[0].playbackSpeed).toBe(L1_ROLE_SPEED.trans)
    // Target slots carry only the course's own 0.95 globalSpeed — no 0.8 belt rung.
    expect(plays.filter((p) => p.role === 'ps').map((p) => p.playbackSpeed)).toEqual([0.95, 0.95, 0.95])
  })

  it('THE REGRESSION: no belt slow-down when no course config is supplied', () => {
    expect(buildSeedPlays(seedAt(1))[0].playbackSpeed).toBe(1.0)
    expect(buildSeedPlays(seedAt(1))[0].playbackSpeed).toBe(buildSeedPlays(seedAt(400))[0].playbackSpeed)
  })

  it('honours a legacy course exemption', () => {
    expect(buildSeedPlays(seedAt(1), undefined, LEGACY)[0].playbackSpeed).toBe(0.9)
  })

  it('is still pure/deterministic', () => {
    expect(buildSeedPlays(seedAt(12), undefined, FRENCH))
      .toEqual(buildSeedPlays(seedAt(12), undefined, FRENCH))
  })
})
