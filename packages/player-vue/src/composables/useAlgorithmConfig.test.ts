import { describe, it, expect } from 'vitest'
import { pickTaper, resolvePodRoundInterval, DEFAULT_EASY, DEFAULT_FAST, DEFAULT_PODS } from './useAlgorithmConfig'
import { DEFAULT_ENCOURAGEMENT_TAPER } from '../services/MetaCommentaryService'

// The encouragement taper is denominated in CUMULATIVE CROSS-COURSE MINUTES
// (owner ruling 2026-08-06). The DB row `algorithm_config` key='meta_commentary'
// may still be carrying the pre-ruling SEED keys, so the read must be deliberate
// about which keys it honours.
describe('pickTaper (algorithm_config meta_commentary read)', () => {
  it('uses the defaults when the row is absent', () => {
    expect(pickTaper(undefined)).toEqual(DEFAULT_ENCOURAGEMENT_TAPER)
    expect(pickTaper(null)).toEqual(DEFAULT_ENCOURAGEMENT_TAPER)
    expect(pickTaper({})).toEqual(DEFAULT_ENCOURAGEMENT_TAPER)
  })

  it('honours admin-set minute keys', () => {
    expect(pickTaper({ taperStartMinutes: 300, offAtMinutes: 900 })).toEqual({
      taperStartMinutes: 300,
      offAtMinutes: 900,
    })
  })

  it('ignores stale seed-denominated keys — they must not become minutes', () => {
    // Honouring offAtSeeds:8 as minutes would switch encouragements off after
    // eight minutes of learning, for everybody.
    expect(pickTaper({ taperStartSeeds: 0, offAtSeeds: 8 })).toEqual(DEFAULT_ENCOURAGEMENT_TAPER)
  })

  it('ignores non-numeric values rather than propagating NaN', () => {
    expect(pickTaper({ taperStartMinutes: 'soon', offAtMinutes: null })).toEqual(
      DEFAULT_ENCOURAGEMENT_TAPER,
    )
  })

  it('takes a partial override key-by-key', () => {
    expect(pickTaper({ offAtMinutes: 2400 })).toEqual({
      taperStartMinutes: DEFAULT_ENCOURAGEMENT_TAPER.taperStartMinutes,
      offAtMinutes: 2400,
    })
  })
})

// POD CADENCE BY MODE (Tom, 2026-09-18): "The PODS (layer 2 listening
// exercises) need to come more often on EASY MODE. Every 2x ROUNDS in EASY
// MODE and every 4x ROUNDS in FAST mode." Red before the ruling landed: both
// modes took the single global `pods.roundInterval` of 5.
describe('resolvePodRoundInterval — pods every 2 rounds on Easy, 4 on Fast', () => {
  it('ships 2 on Easy and 4 on Fast', () => {
    expect(DEFAULT_EASY.podRoundInterval).toBe(2)
    expect(DEFAULT_FAST.podRoundInterval).toBe(4)
    expect(resolvePodRoundInterval(DEFAULT_EASY, DEFAULT_PODS)).toBe(2)
    expect(resolvePodRoundInterval(DEFAULT_FAST, DEFAULT_PODS)).toBe(4)
  })

  it('the mode value beats the global pods row', () => {
    expect(resolvePodRoundInterval({ podRoundInterval: 3 }, { roundInterval: 5 })).toBe(3)
  })

  it('falls back to the global pods row for a mode row with no value of its own', () => {
    expect(resolvePodRoundInterval({}, { roundInterval: 5 })).toBe(5)
    expect(resolvePodRoundInterval(null, { roundInterval: 5 })).toBe(5)
  })

  it('degrades to every round rather than to a nonsense cadence', () => {
    expect(resolvePodRoundInterval({ podRoundInterval: 0 }, null)).toBe(1)
    expect(resolvePodRoundInterval({ podRoundInterval: Number.NaN }, {})).toBe(1)
    expect(resolvePodRoundInterval(null, null)).toBe(1)
  })
})
