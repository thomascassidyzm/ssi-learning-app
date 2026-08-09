import { describe, it, expect } from 'vitest'
import {
  buildPodCohorts,
  buildPodExchangeCohorts,
  applyPodColdStartWindow,
  POD_COLD_START_MIN_SENTENCES,
  podCohortOrdinalForIndex,
  podCohortRoundFor,
  podRatchetAfterLap,
  type PodCohortRow,
} from './podCohorts'

/** Row shorthand: sc = scene_number, glue = glue_to_next (continues into the
 *  next row — i.e. NOT the last sentence of its turn). */
const r = (sc: number | null = 1, glue = false): PodCohortRow => ({
  scene_number: sc,
  glue_to_next: glue,
})

describe('buildPodExchangeCohorts — scene walls, exchange debuts (Tom 2026-07-24)', () => {
  it('an exchange is a turn plus its reply: two single-sentence turns pair into one cohort', () => {
    // Q + A, one scene → one exchange.
    const rows = [r(1), r(1)]
    expect(buildPodExchangeCohorts(rows)).toEqual([{ start: 0, size: 2 }])
  })

  it('multi-sentence turns stay whole: glue runs are the turn unit', () => {
    // Turn A = 2 glued sentences, turn B = 1 → one exchange of 3.
    const rows = [r(1, true), r(1), r(1)]
    expect(buildPodExchangeCohorts(rows)).toEqual([{ start: 0, size: 3 }])
  })

  it('a scene ramps exchange by exchange: four turns → two cohorts, in order', () => {
    // Q1 A1 Q2 A2 in one scene → exchanges (Q1,A1), (Q2,A2).
    const rows = [r(1), r(1), r(1), r(1)]
    expect(buildPodExchangeCohorts(rows)).toEqual([
      { start: 0, size: 2 },
      { start: 2, size: 2 },
    ])
  })

  it('an adjacency pair never straddles a lap: pairing is turn-aligned, never mid-turn', () => {
    // Turns of sizes 1, 2, 1 → exchange 1 = turns 1+2 (3 sentences),
    // exchange 2 = the lone closing turn.
    const rows = [r(1), r(1, true), r(1), r(1)]
    expect(buildPodExchangeCohorts(rows)).toEqual([
      { start: 0, size: 3 },
      { start: 3, size: 1 },
    ])
  })

  it('an odd turn count leaves the closing turn (narrator coda) as its own cohort', () => {
    const rows = [r(1), r(1), r(1)]
    expect(buildPodExchangeCohorts(rows)).toEqual([
      { start: 0, size: 2 },
      { start: 2, size: 1 },
    ])
  })

  it('SCENE IS THE WALL: an exchange never spans a scene boundary', () => {
    // Scene 1 has three turns (lone coda), scene 2 has two — the coda never
    // pairs with scene 2's opener.
    const rows = [r(1), r(1), r(1), r(2), r(2)]
    expect(buildPodExchangeCohorts(rows)).toEqual([
      { start: 0, size: 2 },
      { start: 2, size: 1 },
      { start: 3, size: 2 },
    ])
  })

  it('a scene completes before the next scene debuts (cohorts stay in sentence order)', () => {
    // Scene 1 (4 turns) then scene 2 (2 turns): cohorts 1-2 are scene 1's
    // exchanges, cohort 3 is scene 2's — round N debuts cohort N, so scene 2
    // starts only after scene 1 is fully introduced.
    const rows = [r(1), r(1), r(1), r(1), r(2), r(2)]
    expect(buildPodExchangeCohorts(rows)).toEqual([
      { start: 0, size: 2 },
      { start: 2, size: 2 },
      { start: 4, size: 2 },
    ])
  })

  it('glue_to_next on a scene-final row does not leak the turn across the wall', () => {
    // Row 1 claims glue into row 2, but row 2 is a new scene — the wall wins.
    const rows = [r(1), r(1, true), r(2)]
    expect(buildPodExchangeCohorts(rows)).toEqual([
      { start: 0, size: 2 },
      { start: 2, size: 1 },
    ])
  })

  it('a one-turn scene is a cohort of 1 turn (however many glued sentences)', () => {
    const rows = [r(1, true), r(1, true), r(1), r(2)]
    expect(buildPodExchangeCohorts(rows)).toEqual([
      { start: 0, size: 3 },
      { start: 3, size: 1 },
    ])
  })

  it('missing scene_number never forces a scene break (legacy cached rows)', () => {
    // All-null scene, no glue info → single-sentence turns pairing off in twos.
    const rows = [r(null), r(null), r(null)]
    expect(buildPodExchangeCohorts(rows)).toEqual([
      { start: 0, size: 2 },
      { start: 2, size: 1 },
    ])
  })

  it('a null row bridges its scene run rather than resetting it', () => {
    // …scene 1, null, scene 1… is one scene; the later scene 2 still breaks.
    const rows = [r(1), r(null), r(1), r(2)]
    expect(buildPodExchangeCohorts(rows)).toEqual([
      { start: 0, size: 2 },
      { start: 2, size: 1 },
      { start: 3, size: 1 },
    ])
  })

  it('rows with no glue info pair off two sentences at a time (legacy-safe small cohorts)', () => {
    const rows: PodCohortRow[] = [{ scene_number: 1 }, { scene_number: 1 }, { scene_number: 1 }, { scene_number: 1 }]
    expect(buildPodExchangeCohorts(rows)).toEqual([
      { start: 0, size: 2 },
      { start: 2, size: 2 },
    ])
  })

  it('empty input → no cohorts', () => {
    expect(buildPodExchangeCohorts([])).toEqual([])
  })
})

describe('cold-start window — lap 1 is one full exchange (Tom, T-13, 2026-08-07)', () => {
  it('the floor is 2 sentences — the smallest thing that is still an exchange', () => {
    expect(POD_COLD_START_MIN_SENTENCES).toBe(2)
  })

  it('FLOOR — a lone opening line absorbs the next exchange', () => {
    // The Hebrew shape from the A-52 diagnosis — a lone opening turn, then a
    // two-sentence exchange. Lap 1 used to be that single clip, played three
    // times a lap, 19 times across seven laps.
    const exchanges = [
      { start: 0, size: 1 },
      { start: 1, size: 2 },
      { start: 3, size: 2 },
    ]
    expect(applyPodColdStartWindow(exchanges)).toEqual([
      { start: 0, size: 3 },
      { start: 3, size: 2 },
    ])
  })

  it('CEILING — a two-sentence opening exchange stands alone, never stacked', () => {
    // This is the eus_for_spa shape that produced Tom's report: under the
    // floor-only rule the 2 absorbed the 5 and lap 1 was the whole scene.
    const exchanges = [
      { start: 0, size: 2 },
      { start: 2, size: 5 },
      { start: 7, size: 2 },
    ]
    expect(applyPodColdStartWindow(exchanges)).toEqual(exchanges)
  })

  it('CEILING — even two short exchanges are not merged', () => {
    const exchanges = [
      { start: 0, size: 2 },
      { start: 2, size: 2 },
      { start: 4, size: 2 },
    ]
    expect(applyPodColdStartWindow(exchanges)).toEqual(exchanges)
  })

  it('the typical live shape (a 3-sentence opening exchange) is untouched', () => {
    const exchanges = [
      { start: 0, size: 3 },
      { start: 3, size: 2 },
    ]
    expect(applyPodColdStartWindow(exchanges)).toEqual(exchanges)
  })

  it('a pod that is one sentence long keeps its single cohort', () => {
    expect(applyPodColdStartWindow([{ start: 0, size: 1 }])).toEqual([{ start: 0, size: 1 }])
    expect(applyPodColdStartWindow([])).toEqual([])
  })

  it('the floor merges the opening pair whatever the scene structure', () => {
    // Scene 1 is a single-line narrator opener; scene 2 opens with a Q+A. The
    // first serving is two sentences; the wall does not hold a lone line alone.
    const rows = [r(1), r(2), r(2)]
    expect(buildPodCohorts(rows)).toEqual([
      { start: 0, size: 2 },
      { start: 2, size: 1 },
    ])
  })
})

describe('ONE new sentence per pod visit (Tom, 2026-08-09)', () => {
  it('buildPodCohorts = one sentence per lap, with a two-sentence cold start', () => {
    const rows = [r(1), r(1), r(1), r(1), r(2), r(2)]
    expect(buildPodCohorts(rows)).toEqual([
      { start: 0, size: 2 },
      { start: 2, size: 1 },
      { start: 3, size: 1 },
      { start: 4, size: 1 },
      { start: 5, size: 1 },
    ])
  })

  it('no lap after the first ever debuts more than one sentence — whatever the turn/scene shape', () => {
    // The live shape that broke it: long same-speaker turns (glue runs) inside
    // one scene, which the exchange partition packed into 3-8 sentence laps.
    const rows = [r(1, true), r(1, true), r(1, true), r(1), r(1, true), r(1), r(2), r(2, true), r(2)]
    const cohorts = buildPodCohorts(rows)
    expect(cohorts[0].size).toBe(POD_COLD_START_MIN_SENTENCES)
    expect(cohorts.slice(1).every((c) => c.size === 1)).toBe(true)
    // Every sentence is introduced exactly once, in order.
    expect(cohorts.reduce((n, c) => n + c.size, 0)).toBe(rows.length)
  })

  it('a one-sentence pod keeps its single cohort', () => {
    expect(buildPodCohorts([r(1)])).toEqual([{ start: 0, size: 1 }])
    expect(buildPodCohorts([])).toEqual([])
  })

  it('the ratchet follows the partition: lap 1 covers the opening pair, then one a lap', () => {
    const cohorts = buildPodCohorts([r(1), r(1), r(1), r(1), r(2), r(2)])
    expect(podCohortRoundFor(cohorts, 0)).toBe(1)
    expect(podRatchetAfterLap(cohorts, 0)).toBe(2)
    // Second lap replays the pair one step older and debuts ONE new sentence.
    expect(podCohortRoundFor(cohorts, 2)).toBe(2)
    expect(podRatchetAfterLap(cohorts, 2)).toBe(3)
    expect(podCohortRoundFor(cohorts, 3)).toBe(3)
    expect(podRatchetAfterLap(cohorts, 3)).toBe(4)
  })

  it('a learner mid-flight under the exchange partition rolls forward, never backwards', () => {
    // Stored=5 (five sentences covered under yesterday's exchange laps) reads
    // as five cohorts started → round 5; the next lap debuts sentence 6.
    const cohorts = buildPodCohorts([r(1), r(1), r(1), r(1), r(2), r(2)])
    expect(podCohortRoundFor(cohorts, 5)).toBe(5)
    expect(podRatchetAfterLap(cohorts, 5)).toBe(6)
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

  it('scene-cohort → exchange-cohort migration: a stored scene-boundary value maps to the right exchange round, no reset', () => {
    // Yesterday's client completed scene 1 (4 sentences, two exchanges) as
    // one lap → stored=4. Under the exchange partition [2,2,2] that reads as
    // 2 cohorts started → round 3: scene 1 replays one step older, and the
    // next lap debuts exchange 3.
    const exchanges = [
      { start: 0, size: 2 },
      { start: 2, size: 2 },
      { start: 4, size: 2 },
    ]
    expect(podCohortRoundFor(exchanges, 4)).toBe(3)
    expect(podRatchetAfterLap(exchanges, 4)).toBe(6)
  })
})
