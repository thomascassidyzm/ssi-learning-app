import { describe, it, expect } from 'vitest'
import {
  buildPodCohorts,
  podCohortOrdinalForIndex,
  podCohortRoundFor,
  podRatchetAfterLap,
  type PodCohortRow,
} from './podCohorts'

/** Row shorthand: sc = scene_number. */
const r = (sc: number | null = 1): PodCohortRow => ({ scene_number: sc })

describe('buildPodCohorts — one cohort per SCENE (Tom 2026-07-23)', () => {
  it('a whole scene is one cohort, however many sentences it holds', () => {
    // One scene of six lines: no cap, no splitting — the exchange stays whole.
    const rows = Array.from({ length: 6 }, () => r(1))
    expect(buildPodCohorts(rows)).toEqual([{ start: 0, size: 6 }])
  })

  it('partitions at every scene boundary, sizes as authored', () => {
    // Scene 1 (2 lines), scene 2 (4 lines), scene 3 (1 line).
    const rows = [r(1), r(1), r(2), r(2), r(2), r(2), r(3)]
    expect(buildPodCohorts(rows)).toEqual([
      { start: 0, size: 2 },
      { start: 2, size: 4 },
      { start: 6, size: 1 },
    ])
  })

  it('an adjacency pair can never straddle a lap: question and reply share a scene → one cohort', () => {
    const rows = [r(1), r(1), r(1), r(1)]
    expect(buildPodCohorts(rows)).toEqual([{ start: 0, size: 4 }])
  })

  it('a one-line scene is a cohort of 1', () => {
    const rows = [r(1), r(2), r(2)]
    expect(buildPodCohorts(rows)).toEqual([
      { start: 0, size: 1 },
      { start: 1, size: 2 },
    ])
  })

  it('missing scene_number never forces a break (legacy cached rows → one cohort)', () => {
    const rows = [r(null), r(null), r(null)]
    expect(buildPodCohorts(rows)).toEqual([{ start: 0, size: 3 }])
  })

  it('a null row bridges its scene run rather than resetting it', () => {
    // …scene 1, null, scene 1… is one scene; the later scene 2 still breaks.
    const rows = [r(1), r(null), r(1), r(2)]
    expect(buildPodCohorts(rows)).toEqual([
      { start: 0, size: 3 },
      { start: 3, size: 1 },
    ])
  })

  it('empty input → no cohorts', () => {
    expect(buildPodCohorts([])).toEqual([])
  })
})

describe('podCohortOrdinalForIndex', () => {
  const cohorts = [{ start: 0, size: 3 }, { start: 3, size: 2 }]
  it('maps a sentence index to its cohort ordinal', () => {
    expect(podCohortOrdinalForIndex(cohorts, 0)).toBe(0)
    expect(podCohortOrdinalForIndex(cohorts, 2)).toBe(0)
    expect(podCohortOrdinalForIndex(cohorts, 3)).toBe(1)
    expect(podCohortOrdinalForIndex(cohorts, 4)).toBe(1)
    expect(podCohortOrdinalForIndex(cohorts, 5)).toBe(-1)
  })
})

describe('podCohortRoundFor / podRatchetAfterLap — sentence-unit ratchet', () => {
  // Cohorts of sizes 3 + 2 = 5 sentences.
  const cohorts = [{ start: 0, size: 3 }, { start: 3, size: 2 }]

  it('fresh learner: round 1 introduces cohort 1; completing it snaps to its end', () => {
    expect(podCohortRoundFor(cohorts, 0)).toBe(1)
    expect(podRatchetAfterLap(cohorts, 0)).toBe(3)
  })

  it('new-model progression: one cohort per lap, ratchet lands on boundaries', () => {
    expect(podCohortRoundFor(cohorts, 3)).toBe(2)
    expect(podRatchetAfterLap(cohorts, 3)).toBe(5)
  })

  it('legacy mid-cohort value counts the started cohort and snaps forward on completion', () => {
    // Old model stored=1 (one sentence heard): cohort 1 already started →
    // round 2 (cohort 1 replays at alive=2, cohort 2 debuts), completion
    // snaps to the end of cohort 2.
    expect(podCohortRoundFor(cohorts, 1)).toBe(2)
    expect(podRatchetAfterLap(cohorts, 1)).toBe(5)
  })

  it('past the last cohort the round keeps aging +1 per lap (eternal stages never freeze)', () => {
    expect(podCohortRoundFor(cohorts, 5)).toBe(3)
    expect(podRatchetAfterLap(cohorts, 5)).toBe(6)
    expect(podCohortRoundFor(cohorts, 6)).toBe(4)
    // Legacy learner far past the end (old laps-unit value ≫ sentence count).
    expect(podCohortRoundFor(cohorts, 50)).toBe(2 + 1 + 45)
    expect(podRatchetAfterLap(cohorts, 50)).toBe(51)
  })

  it('ratchet is strictly monotonic from any stored value', () => {
    for (let stored = 0; stored < 10; stored++) {
      expect(podRatchetAfterLap(cohorts, stored)).toBeGreaterThan(stored)
    }
  })

  it('no cohorts → plain +1 tick', () => {
    expect(podRatchetAfterLap([], 4)).toBe(5)
  })
})
