import { describe, it, expect } from 'vitest'
import { computePauseDuration } from './computePauseDuration'
import { DEFAULT_FAST, DEFAULT_EASY } from '../composables/useAlgorithmConfig'

// The one-formula gap model (Tom's ruling, 2026-08-29):
//   gap = clamp(min, max, k × avg(native target1, native target2) + reaction_ms)
// Two tunables per mode; playback speed is not an input; min/max are safety
// clamps, not tuning.

const FAST = { pause_k: 2.8, pause_reaction_ms: 800, min_pause_ms: 1000, max_pause_ms: 15000 }

describe('computePauseDuration — one formula', () => {
  it('is k × the average of the two native durations, plus the reaction beat', () => {
    // avg(2000, 2400) = 2200 → 2.8 × 2200 + 800 = 6960
    expect(computePauseDuration(2000, 2400, FAST)).toBe(6960)
  })

  it('averages the two voices rather than summing them', () => {
    expect(computePauseDuration(2000, 2000, FAST)).toBe(computePauseDuration(1000, 3000, FAST))
  })

  it('is linear in the answer duration', () => {
    const a = computePauseDuration(1000, 1000, FAST)
    const b = computePauseDuration(2000, 2000, FAST)
    const c = computePauseDuration(3000, 3000, FAST)
    expect(b - a).toBe(c - b)
  })

  it('clamps to the safety floor and ceiling', () => {
    expect(computePauseDuration(0, 0, FAST)).toBe(1000)      // floor, not 800
    expect(computePauseDuration(60000, 60000, FAST)).toBe(15000)
  })

  it('takes no speed argument — the signature cannot express one', () => {
    expect(computePauseDuration.length).toBe(3)
  })

  it('ignores retired legacy knobs left on a stale config row', () => {
    const stale = {
      ...FAST,
      pause_base_ms: 5000,
      pause_multiplier: 9,
      pause_knee_ms: 100,
      pause_tail_multiplier: 9,
      pause_boot_ms: 9000,
      pause_assembly_threshold_ms: 0,
      pause_assembly_lin: 9,
      pause_assembly_quad: 900,
      pause_belt_boot: 0.1,
      pause_belt_assembly: 0.1,
      pause_reference: 'sum' as const,
    }
    expect(computePauseDuration(2000, 2000, stale)).toBe(computePauseDuration(2000, 2000, FAST))
  })

  it('falls back to defaults when a row carries neither tunable', () => {
    expect(computePauseDuration(2000, 2000, { min_pause_ms: 1000, max_pause_ms: 15000 }))
      .toBe(computePauseDuration(2000, 2000, FAST))
  })

  it('gives Easy a longer gap than Fast at every length', () => {
    for (const d of [1000, 2000, 3000]) {
      expect(computePauseDuration(d, d, DEFAULT_EASY))
        .toBeGreaterThan(computePauseDuration(d, d, DEFAULT_FAST))
    }
  })
})
