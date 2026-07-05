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
