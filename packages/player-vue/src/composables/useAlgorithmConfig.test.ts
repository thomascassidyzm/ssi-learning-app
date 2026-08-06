import { describe, it, expect } from 'vitest'
import { pickTaper } from './useAlgorithmConfig'
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
