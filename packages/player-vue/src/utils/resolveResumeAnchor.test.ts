/**
 * resolveResumeAnchor — narrow ceiling fallback (2026-07-05).
 *
 * Regression coverage for the prod incident: 3 course_enrollments rows with
 * last_completed_lego_id NULL but highest_completed_lego_id populated (e.g.
 * a learner at S0002L02) were being dropped to round 1 by the cursor-only
 * sweep (de7c7b67..b5a0d24f), which deleted this fallback outright.
 */

import { describe, it, expect } from 'vitest'
import { resolveResumeAnchor } from './resolveResumeAnchor'

const ROUNDS = ['S0001L01', 'S0001L02', 'S0002L01', 'S0002L02', 'S0002L03']
const findIndex = (legoId: string) => ROUNDS.indexOf(legoId)

describe('resolveResumeAnchor', () => {
  it('uses the cursor when it resolves', () => {
    expect(resolveResumeAnchor('S0002L01', 'S0001L01', findIndex)).toEqual({
      legoId: 'S0002L01',
      viaCeiling: false,
    })
  })

  it('falls back to the ceiling when the cursor is null and the ceiling is populated', () => {
    expect(resolveResumeAnchor(null, 'S0002L02', findIndex)).toEqual({
      legoId: 'S0002L02',
      viaCeiling: true,
    })
  })

  it('falls back to the ceiling when the cursor is unresolvable (stale/schema-drifted)', () => {
    expect(resolveResumeAnchor('S9999L99', 'S0002L02', findIndex)).toEqual({
      legoId: 'S0002L02',
      viaCeiling: true,
    })
  })

  it('starts fresh (null) when neither cursor nor ceiling resolves', () => {
    expect(resolveResumeAnchor(null, null, findIndex)).toEqual({
      legoId: null,
      viaCeiling: false,
    })
    expect(resolveResumeAnchor('S9999L99', 'S8888L88', findIndex)).toEqual({
      legoId: null,
      viaCeiling: false,
    })
  })

  it('does not fall back to a null/empty ceiling', () => {
    expect(resolveResumeAnchor(null, null, findIndex)).toEqual({
      legoId: null,
      viaCeiling: false,
    })
  })
})

describe('resolveResumeAnchor — seed fallback (Tom, 2026-08-31)', () => {
  const firstLegoOfSeed = (seed: number) =>
    ROUNDS.find(id => id.startsWith(`S${String(seed).padStart(4, '0')}`)) ?? null

  it('lands on the first LEGO of the seed when the cursor LEGO is gone', () => {
    // S0002L09 was regenerated away; the learner was working in seed 2.
    expect(resolveResumeAnchor('S0002L09', 'S0001L01', findIndex, firstLegoOfSeed)).toEqual({
      legoId: 'S0002L01',
      viaCeiling: false,
      viaSeed: true,
    })
  })

  it('prefers the seed the learner was in over the ceiling', () => {
    expect(
      resolveResumeAnchor('S0002L09', 'S0002L03', findIndex, firstLegoOfSeed).legoId,
    ).toBe('S0002L01')
  })

  it('falls through to the ceiling when the whole seed is gone', () => {
    expect(resolveResumeAnchor('S0404L01', 'S0002L02', findIndex, firstLegoOfSeed)).toEqual({
      legoId: 'S0002L02',
      viaCeiling: true,
    })
  })

  it('is inert for callers that do not supply the seed resolver', () => {
    expect(resolveResumeAnchor('S0002L09', 'S0002L03', findIndex)).toEqual({
      legoId: 'S0002L03',
      viaCeiling: true,
    })
  })

  it('never overrides a cursor that still resolves', () => {
    expect(resolveResumeAnchor('S0002L03', null, findIndex, firstLegoOfSeed)).toEqual({
      legoId: 'S0002L03',
      viaCeiling: false,
    })
  })
})
