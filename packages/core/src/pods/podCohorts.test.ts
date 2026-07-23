import { describe, it, expect } from 'vitest'
import {
  buildPodCohorts,
  podCohortOrdinalForIndex,
  podCohortRoundFor,
  podRatchetAfterLap,
  type PodCohortRow,
} from './podCohorts'

/** Row shorthand: g = glue_to_next, sc = scene_number. */
const r = (g: boolean, sc: number | null = 1): PodCohortRow => ({ glue_to_next: g, scene_number: sc })

describe('buildPodCohorts — cohort formation', () => {
  it('packs consecutive single-line turns into cohorts of up to 3 (an exchange, not orphans)', () => {
    // Six unglued lines, one scene: A/B/A/B/A/B one-liners.
    const rows = Array.from({ length: 6 }, () => r(false))
    expect(buildPodCohorts(rows)).toEqual([
      { start: 0, size: 3 },
      { start: 3, size: 3 },
    ])
  })

  it('keeps an adjacency pair together: 1-line turn + 2-line reply = one cohort', () => {
    // Turn A (1 sentence), turn B (2 glued sentences), turn C (1 sentence).
    const rows = [r(false), r(true), r(false), r(false)]
    expect(buildPodCohorts(rows)).toEqual([
      { start: 0, size: 3 },
      { start: 3, size: 1 },
    ])
  })

  it('never splits a 2-3 sentence turn mid-thought to fill a cohort', () => {
    // Turn A (1), turn B (3 glued): B cannot join A without splitting → A
    // stands alone (a cohort of 1, data-forced), B is its own cohort.
    const rows = [r(false), r(true), r(true), r(false)]
    expect(buildPodCohorts(rows)).toEqual([
      { start: 0, size: 1 },
      { start: 1, size: 3 },
    ])
  })

  it('splits an oversized glued turn into balanced chunks of ≤3 (5 → 3+2, never 3+1+1)', () => {
    const rows = [r(true), r(true), r(true), r(true), r(false)]
    expect(buildPodCohorts(rows)).toEqual([
      { start: 0, size: 3 },
      { start: 3, size: 2 },
    ])
  })

  it('a scene boundary always starts a new cohort, even leaving a cohort of 1', () => {
    // Scene 1 has one line; scene 2 has two lines. Without the scene guard
    // they would pack into one cohort of 3.
    const rows = [r(false, 1), r(false, 2), r(false, 2)]
    expect(buildPodCohorts(rows)).toEqual([
      { start: 0, size: 1 },
      { start: 1, size: 2 },
    ])
  })

  it('a glue chain is cut at a scene boundary (bad data guard)', () => {
    const rows = [r(true, 1), r(true, 2), r(false, 2)]
    expect(buildPodCohorts(rows)).toEqual([
      { start: 0, size: 1 },
      { start: 1, size: 2 },
    ])
  })

  it('missing scene_number never forces a break (legacy cached rows)', () => {
    const rows = [r(false, null), r(false, null), r(false, null)]
    expect(buildPodCohorts(rows)).toEqual([{ start: 0, size: 3 }])
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
