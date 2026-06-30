import { describe, it, expect } from 'vitest'
import {
  DEFAULT_SCRIPT_SHAPE,
  SEED_PHASE_START_OFFSET,
  reviewItemIsSeed,
} from './generateLearningScript'

// Mirrors the dashboard generator's tests
// (ssi-dashboard-v7-clean services/learning-script-generator.test.cjs) so the
// two implementations stay in lockstep.

describe('spaced-rep Fibonacci series spans a full course', () => {
  it('extends past 89 to 2584 (first term past ~2000 LEGOs)', () => {
    expect(DEFAULT_SCRIPT_SHAPE.spacedRepOffsets).toEqual(
      [1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377, 610, 987, 1597, 2584]
    )
    const o = DEFAULT_SCRIPT_SHAPE.spacedRepOffsets
    expect(o[o.length - 1]).toBe(2584)
  })

  it('is strictly ascending (so the reviewRound < 1 break is correct)', () => {
    const o = DEFAULT_SCRIPT_SHAPE.spacedRepOffsets
    for (let i = 1; i < o.length; i++) expect(o[i]).toBeGreaterThan(o[i - 1])
  })
})

describe('reviewItemIsSeed — the 89 → 144 boundary', () => {
  it('SEED_PHASE_START_OFFSET is 144 (first term past 89)', () => {
    expect(SEED_PHASE_START_OFFSET).toBe(144)
  })

  it('89-step stays a use-phrase; 144 and beyond are seed-phase', () => {
    expect(reviewItemIsSeed(1)).toBe(false)
    expect(reviewItemIsSeed(89)).toBe(false)   // last use-phrase
    expect(reviewItemIsSeed(143)).toBe(false)
    expect(reviewItemIsSeed(144)).toBe(true)    // first seed
    expect(reviewItemIsSeed(233)).toBe(true)
    expect(reviewItemIsSeed(2584)).toBe(true)
  })

  it('every offset ≥144 in the series is a seed-phase review', () => {
    for (const off of DEFAULT_SCRIPT_SHAPE.spacedRepOffsets) {
      expect(reviewItemIsSeed(off)).toBe(off >= 144)
    }
  })
})
