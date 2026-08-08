import { describe, it, expect } from 'vitest'
import {
  beltSpeed,
  computeCycleSpeed,
  computeListeningSpeed,
  type TargetSpeedConfig,
} from '../providers/toSimpleRounds'
import { buildSeedPlays, L1_ROLE_SPEED } from '../composables/useLayer1Scheduler'
import { ROLE_SPEED } from '@ssi/core/pods'

// Tom, live on staging 2026-08-06, French:
//   "LIStening exercises are way too fast initially — they need to follow the
//    belt speed gating… in the listening exercise we hear t-k-t-t phrases all
//    at 1x speed… targ lang clips start at 0.8x, then in yellow belt go to
//    0.9x, then orange go to 0.95x and finally at green they go to full speed."
//
// Listening was flat 1.0× everywhere: L1_ROLE_SPEED hard-coded { ps: 1, trans: 1 }
// and the pod stage roles start at 'ps' = 1.0 from pod activation (main round 5).
//
// These tests pin TWO things: the four numbers, and — more importantly — that
// listening rides the SAME beltSpeed curve as speaking rather than a second one
// that can drift (this module already paid for that drift once, 2026-08-04).

const NATIVE: TargetSpeedConfig = { globalSpeed: 1.0, nativeSpeed: true }
/** fra_for_eng shape: voice_config.target_speed = { global_speed: 0.95 }. */
const FRENCH: TargetSpeedConfig = { globalSpeed: 0.95, nativeSpeed: true }
/** Legacy course recorded at a non-1.0 voice speed — ramp deliberately off. */
const LEGACY: TargetSpeedConfig = { globalSpeed: 0.9, nativeSpeed: false }

/** One seed per belt band, and the rate Tom named for it. */
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

describe('computeListeningSpeed — one curve, shared with speaking', () => {
  it.each(BANDS)('$belt belt (seed $seed) plays target clips at $rate×', ({ seed, rate }) => {
    expect(computeListeningSpeed(1.0, seed, NATIVE)).toBe(rate)
    // …and it is literally the speaking-side curve, not a copy of the numbers.
    expect(computeListeningSpeed(1.0, seed, NATIVE)).toBe(beltSpeed(seed))
  })

  it('agrees exactly with computeCycleSpeed for a plain 1.0× role', () => {
    for (const { seed } of BANDS) {
      for (const cfg of [NATIVE, FRENCH]) {
        expect(computeListeningSpeed(1.0, seed, cfg)).toBe(computeCycleSpeed(seed, cfg))
      }
    }
  })

  it('folds in the course globalSpeed (French 0.95×)', () => {
    expect(computeListeningSpeed(1.0, 1, FRENCH)).toBe(0.76)  // 0.95 × 0.8
    expect(computeListeningSpeed(1.0, 40, FRENCH)).toBe(0.95) // 0.95 × 1.0
  })

  it('exempts legacy slow-recorded courses, same as the speaking side', () => {
    expect(computeListeningSpeed(1.0, 1, LEGACY)).toBe(0.9)
    expect(computeListeningSpeed(1.0, 40, LEGACY)).toBe(0.9)
    expect(computeListeningSpeed(1.0, 1, LEGACY)).toBe(computeCycleSpeed(1, LEGACY))
  })

  it('multiplies a pod role rate rather than replacing it', () => {
    // A 2× stretch rep stays a fast rep RELATIVE to the learner's belt: the pod
    // stage progression is per-sentence maturity, an axis independent of belt.
    expect(computeListeningSpeed(ROLE_SPEED.ps2x, 1, NATIVE)).toBe(1.6)
    expect(computeListeningSpeed(ROLE_SPEED.ps2x, 40, NATIVE)).toBe(2.0)
    expect(computeListeningSpeed(ROLE_SPEED.ps15x, 1, NATIVE)).toBe(1.2)
    // 0.8 role × 0.8 white belt = 0.64, clamped up to the 0.7 MIN_SPEED floor
    // (unused by the default stage playlists, but the floor must still bite).
    expect(computeListeningSpeed(ROLE_SPEED.ps08x, 1, NATIVE)).toBe(0.7)
    // The ordering of the stage progression survives the ramp at every belt.
    for (const { seed } of BANDS) {
      const at = (r: number) => computeListeningSpeed(r, seed, NATIVE)
      expect(at(ROLE_SPEED.ps)).toBeLessThan(at(ROLE_SPEED.ps15x))
      expect(at(ROLE_SPEED.ps15x)).toBeLessThan(at(ROLE_SPEED.ps2x))
    }
  })

  it('never drops below the 0.7 floor', () => {
    expect(computeListeningSpeed(1.0, 1, { globalSpeed: 0.8, nativeSpeed: true })).toBe(0.7)
  })
})

// Tom's ruling on T-13, 2026-08-07: "EASY setting defaults listening playback
// to 0.8× speed." It is the white-belt rung held for as long as the learner
// stays on Easy — a cap on the same curve, never a second one.
describe('computeListeningSpeed — EASY holds the beginner pace (Tom, T-13)', () => {
  const EASY: TargetSpeedConfig = { ...NATIVE, easyMode: true }

  it.each(BANDS)('$belt belt (seed $seed) plays target clips at 0.8× on Easy', ({ seed }) => {
    expect(computeListeningSpeed(1.0, seed, EASY)).toBe(0.8)
  })

  it('is a cap, never a speed-up: Easy is never faster than the belt would give', () => {
    for (const { seed } of BANDS) {
      expect(computeListeningSpeed(1.0, seed, EASY)).toBeLessThanOrEqual(
        computeListeningSpeed(1.0, seed, NATIVE),
      )
    }
  })

  it('leaves FAST exactly as it was — the ramp with no cap', () => {
    for (const { seed, rate } of BANDS) {
      expect(computeListeningSpeed(1.0, seed, { ...NATIVE, easyMode: false })).toBe(rate)
    }
  })

  it('still multiplies the pod role rate: a stretch rep stays fast relative to the pace', () => {
    expect(computeListeningSpeed(ROLE_SPEED.ps2x, 400, EASY)).toBe(1.6)
    expect(computeListeningSpeed(ROLE_SPEED.ps15x, 400, EASY)).toBe(1.2)
  })

  it('folds in the course globalSpeed, and keeps the legacy exemption', () => {
    expect(computeListeningSpeed(1.0, 400, { ...FRENCH, easyMode: true })).toBe(0.76)
    expect(computeListeningSpeed(1.0, 400, { ...LEGACY, easyMode: true })).toBe(0.9)
  })

  it('does not touch the speaking side', () => {
    for (const { seed, rate } of BANDS) {
      expect(computeCycleSpeed(seed, EASY)).toBe(rate)
    }
  })
})

describe('Layer-1 sandwich (t·k·t·t) rides the belt ramp', () => {
  const seedAt = (n: number) => ({
    seedNumber: n,
    target1Id: 't1',
    target2Id: 't2',
    knownId: 'k',
    targetText: 'je veux apprendre',
    knownText: 'I want to learn',
  })

  it.each(BANDS)('$belt belt (seed $seed): target slots $rate×, known slot 1.0×', ({ seed, rate }) => {
    const plays = buildSeedPlays(seedAt(seed), undefined, NATIVE)
    expect(plays.map((p) => p.role)).toEqual(['ps', 'trans', 'ps', 'ps'])
    expect(plays.map((p) => p.playbackSpeed)).toEqual([rate, 1.0, rate, rate])
  })

  it('leaves the KNOWN clip at 1.0× even for a white-belt French learner', () => {
    // The known clip is the learner's own language and the meaning anchor —
    // slowing it teaches nothing (Tom: "targ lang clips").
    const plays = buildSeedPlays(seedAt(1), undefined, FRENCH)
    const known = plays.filter((p) => p.role === 'trans')
    expect(known).toHaveLength(1)
    expect(known[0].playbackSpeed).toBe(1.0)
    expect(known[0].playbackSpeed).toBe(L1_ROLE_SPEED.trans)
    expect(plays.filter((p) => p.role === 'ps').map((p) => p.playbackSpeed)).toEqual([0.76, 0.76, 0.76])
  })

  it('applies the ramp by DEFAULT when no course config is supplied', () => {
    // The bug was a silent flat 1.0×; the default must not reinstate it.
    expect(buildSeedPlays(seedAt(1))[0].playbackSpeed).toBe(0.8)
  })

  it('honours a legacy course exemption', () => {
    expect(buildSeedPlays(seedAt(1), undefined, LEGACY)[0].playbackSpeed).toBe(0.9)
  })

  it('is still pure/deterministic under the ramp', () => {
    expect(buildSeedPlays(seedAt(12), undefined, FRENCH))
      .toEqual(buildSeedPlays(seedAt(12), undefined, FRENCH))
  })
})
