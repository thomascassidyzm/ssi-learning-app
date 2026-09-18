import { describe, it, expect } from 'vitest'
import {
  cohortFor,
  meanBars,
  weekNumbersForClassIds,
  meanWeekNumbers,
  newPhrasesInRange,
  rangeMinutesByActor,
  weeklyMinutesBars,
  weeklyPhrasesBars,
  type ScopedSessionRow,
} from './rateCompare'

const MON = Date.UTC(2026, 5, 8) // Monday 8 June 2026 00:00
const WEEK = 7 * 86_400_000
const range = { startMs: MON, endMs: MON + WEEK }

function row(p: Partial<ScopedSessionRow> & { class_id: string; started_at: number }): ScopedSessionRow {
  return {
    class_id: p.class_id,
    actor: p.actor ?? 'class',
    course_code: p.course_code ?? 'spa_for_eng',
    start_lego_id: p.start_lego_id ?? null,
    end_lego_id: p.end_lego_id ?? null,
    start_ord: p.start_ord ?? null,
    end_ord: p.end_ord ?? null,
    duration_seconds: p.duration_seconds ?? 0,
    started_at: new Date(p.started_at).toISOString(),
  }
}

describe('X / Y / total — kept apart, then added', () => {
  const rows = [
    row({ class_id: 'c1', actor: 'class', started_at: MON + 3_600_000, duration_seconds: 1800 }), // 30 min
    row({ class_id: 'c1', actor: 'class', started_at: MON + 2 * 86_400_000, duration_seconds: 900 }), // 15 min
    row({ class_id: 'c1', actor: 'pupil', started_at: MON + 3 * 86_400_000, duration_seconds: 600 }), // 10 min
    row({ class_id: 'c1', actor: 'pupil', started_at: MON + 4 * 86_400_000, duration_seconds: 300 }), // 5 min
  ]

  it('X is play-as-class only', () => {
    expect(rangeMinutesByActor(rows, ['c1'], 'class', range.startMs, range.endMs).minutes).toBe(45)
  })

  it('Y is the pupils’ own accounts only', () => {
    expect(rangeMinutesByActor(rows, ['c1'], 'pupil', range.startMs, range.endMs).minutes).toBe(15)
  })

  it('total effective learning time is X + Y', () => {
    const w = weekNumbersForClassIds(rows, ['c1'], range.startMs, range.endMs)
    expect(w.classMinutes).toBe(45)
    expect(w.pupilMinutes).toBe(15)
    expect(w.totalMinutes).toBe(60)
    expect(w.hasData).toBe(true)
  })

  it('a legacy row with no actor counts as play-as-class', () => {
    const legacy = [{ ...row({ class_id: 'c1', started_at: MON + 60_000, duration_seconds: 1200 }), actor: undefined }]
    const w = weekNumbersForClassIds(legacy, ['c1'], range.startMs, range.endMs)
    expect(w.classMinutes).toBe(20)
    expect(w.pupilMinutes).toBe(0)
  })

  it('ignores play outside the week, on either side', () => {
    const outside = [
      row({ class_id: 'c1', actor: 'class', started_at: MON - 1000, duration_seconds: 6000 }),
      row({ class_id: 'c1', actor: 'class', started_at: MON + WEEK, duration_seconds: 6000 }),
    ]
    const w = weekNumbersForClassIds(outside, ['c1'], range.startMs, range.endMs)
    expect(w.totalMinutes).toBe(0)
    expect(w.hasData).toBe(false)
  })

  it('ignores other classes’ play', () => {
    const mixed = [...rows, row({ class_id: 'c2', actor: 'class', started_at: MON + 1000, duration_seconds: 99_999 })]
    expect(weekNumbersForClassIds(mixed, ['c1'], range.startMs, range.endMs).totalMinutes).toBe(60)
  })
})

describe('new phrases — the cursor ADVANCE inside the window', () => {
  it('counts only ground that is new this week', () => {
    const rows = [
      row({ class_id: 'c1', started_at: MON - 3 * 86_400_000, start_ord: 1, end_ord: 40 }), // last week: reached 40
      row({ class_id: 'c1', started_at: MON + 86_400_000, start_ord: 30, end_ord: 55 }),    // this week: reached 55
    ]
    expect(newPhrasesInRange(rows, ['c1'], range.startMs, range.endMs)).toBe(15)
  })

  it('a week spent re-treading old ground reads 0, not a negative', () => {
    const rows = [
      row({ class_id: 'c1', started_at: MON - 86_400_000, start_ord: 1, end_ord: 60 }),
      row({ class_id: 'c1', started_at: MON + 86_400_000, start_ord: 10, end_ord: 30 }),
    ]
    expect(newPhrasesInRange(rows, ['c1'], range.startMs, range.endMs)).toBe(0)
  })

  it('a class starting from nothing counts everything it reached', () => {
    const rows = [row({ class_id: 'c1', started_at: MON + 86_400_000, start_ord: 1, end_ord: 12 })]
    expect(newPhrasesInRange(rows, ['c1'], range.startMs, range.endMs)).toBe(12)
  })

  it('a pupil racing ahead on their own account does not move the class cursor', () => {
    const rows = [
      row({ class_id: 'c1', actor: 'class', started_at: MON + 86_400_000, start_ord: 1, end_ord: 10 }),
      row({ class_id: 'c1', actor: 'pupil', started_at: MON + 2 * 86_400_000, start_ord: 1, end_ord: 300 }),
    ]
    expect(newPhrasesInRange(rows, ['c1'], range.startMs, range.endMs)).toBe(10)
  })

  it('a multi-class entity sums each class’s own advance', () => {
    const rows = [
      row({ class_id: 'c1', started_at: MON + 86_400_000, start_ord: 1, end_ord: 10 }),
      row({ class_id: 'c2', started_at: MON + 86_400_000, start_ord: 1, end_ord: 5 }),
    ]
    expect(newPhrasesInRange(rows, ['c1', 'c2'], range.startMs, range.endMs)).toBe(15)
  })
})

describe('the cohort average — a FIXED denominator', () => {
  it('divides by every member, quiet ones included', () => {
    const busy = { classMinutes: 60, pupilMinutes: 30, totalMinutes: 90, newPhrases: 20, hasData: true }
    const quiet = { classMinutes: 0, pupilMinutes: 0, totalMinutes: 0, newPhrases: 0, hasData: false }
    const mean = meanWeekNumbers([busy, quiet, quiet, quiet])
    expect(mean.classMinutes).toBe(15)
    expect(mean.totalMinutes).toBe(22.5)
    expect(mean.newPhrases).toBe(5)
    expect(mean.hasData).toBe(true)
  })

  it('an empty cohort has no numbers rather than a zero that reads as a fact', () => {
    expect(meanWeekNumbers([]).hasData).toBe(false)
  })

  it('the viewed class is inside the average — the mean of one is itself', () => {
    const own = { classMinutes: 40, pupilMinutes: 10, totalMinutes: 50, newPhrases: 8, hasData: true }
    expect(meanWeekNumbers([own])).toMatchObject({ classMinutes: 40, totalMinutes: 50, newPhrases: 8 })
  })
})

describe('weekly bars', () => {
  const buckets = [0, 1, 2].map((i) => ({ startMs: MON + i * WEEK, endMs: MON + (i + 1) * WEEK }))

  it('bars are X + Y per week, and an empty week is an empty week', () => {
    const rows = [
      row({ class_id: 'c1', actor: 'class', started_at: MON + 1000, duration_seconds: 600 }),
      row({ class_id: 'c1', actor: 'pupil', started_at: MON + 2000, duration_seconds: 600 }),
      // week 2: nothing at all
      row({ class_id: 'c1', actor: 'class', started_at: MON + 2 * WEEK + 1000, duration_seconds: 1200 }),
    ]
    expect(weeklyMinutesBars(rows, ['c1'], buckets)).toEqual([20, 0, 20])
  })
})

describe('cohortFor — one definition of who the average divides by', () => {
  const W = (n: number) => MON + n * WEEK // start of week n, 0-indexed
  const firstPlay = new Map<string, number | null>([
    ['old', MON - 20 * WEEK],   // playing long before the chart starts
    ['wk3', W(3) + 86_400_000], // first played in week 3
    ['wk8', W(8) + 3_600_000],  // first played in week 8
    ['never', null],            // set up, never played a session
  ])
  const all = ['old', 'wk3', 'wk8', 'never']
  const at = (n: number) => cohortFor(all, firstPlay, W(n + 1)) // end of week n

  it('a class that has never played is in NO denominator, in any week', () => {
    for (let n = 0; n < 12; n++) expect(at(n)).not.toContain('never')
  })

  it('a class joins in the week it first plays, and never before', () => {
    expect(at(2)).toEqual(['old'])
    expect(at(3)).toEqual(['old', 'wk3'])
    expect(at(7)).toEqual(['old', 'wk3'])
    expect(at(8)).toEqual(['old', 'wk3', 'wk8'])
  })

  it('the set only ever GROWS — past weeks never change when a new class starts', () => {
    const before = [0, 1, 2, 3, 4, 5, 6, 7].map((n) => at(n).join(','))
    const withNewcomer = new Map(firstPlay).set('joined-today', MON + 11 * WEEK)
    const after = [0, 1, 2, 3, 4, 5, 6, 7]
      .map((n) => cohortFor([...all, 'joined-today'], withNewcomer, W(n + 1)).join(','))
    expect(after).toEqual(before)
  })

  it('a STARTED class that was quiet stays in — being quiet is a fact, not an exit', () => {
    // 'old' played before the chart and nothing since; it is still a member,
    // and its true value in a silent week is 0 (job #982's rule, preserved).
    expect(at(11)).toContain('old')
    expect(weekNumbersForClassIds([], ['old'], W(11), W(12)).totalMinutes).toBe(0)
  })

  it('is viewer-independent — it reads nobody’s identity, only first-play dates', () => {
    const asOneClass = cohortFor(all, firstPlay, W(9))
    const asAnother = cohortFor([...all].reverse(), firstPlay, W(9))
    expect([...asOneClass].sort()).toEqual([...asAnother].sort())
  })

  it('a first play at the STROKE of Monday 00:00 belongs to the week starting, not the one closing', () => {
    // The week's end is exclusive everywhere else — rangeMinutesByActor counts
    // `t >= startMs && t < endMs` — so a class whose first session begins at
    // exactly W(4) contributes no minutes to week 3. With an inclusive `<=` it
    // joined week 3's denominator anyway and dragged that week's average down
    // for a week it was not present in (job #989 fix-up).
    const onTheStroke = new Map<string, number | null>([['mon', W(4)]])
    expect(cohortFor(['mon'], onTheStroke, W(4))).toEqual([])   // end of week 3
    expect(cohortFor(['mon'], onTheStroke, W(5))).toEqual(['mon']) // end of week 4
    // And it really does play nothing in week 3.
    const row: ScopedSessionRow = {
      class_id: 'mon', course_code: 'c', start_lego_id: null, end_lego_id: null,
      start_ord: 0, end_ord: 1, duration_seconds: 600, started_at: new Date(W(4)).toISOString(),
    }
    expect(rangeMinutesByActor([row], ['mon'], 'class', W(3), W(4)).minutes).toBe(0)
    expect(rangeMinutesByActor([row], ['mon'], 'class', W(4), W(5)).minutes).toBe(10)
  })

  it('an id it has never heard of is not a member', () => {
    expect(cohortFor(['ghost'], firstPlay, W(12))).toEqual([])
  })
})

describe('bars — absence and zero are different nothings', () => {
  const buckets = [0, 1, 2].map((i) => ({ startMs: MON + i * WEEK, endMs: MON + (i + 1) * WEEK }))

  it('no cohort that week → null, so the chart leaves a gap', () => {
    const firstPlay = new Map<string, number | null>([['c1', MON + 2 * WEEK + 1000]])
    const rows = [row({ class_id: 'c1', started_at: MON + 2 * WEEK + 2000, duration_seconds: 600 })]
    const bars = weeklyMinutesBars(rows, ['c1'], buckets, (end) => cohortFor(['c1'], firstPlay, end))
    expect(bars).toEqual([null, null, 10])
  })

  it('a started cohort that did not play that week → 0, a real bar of zero height', () => {
    const firstPlay = new Map<string, number | null>([['c1', MON - WEEK]])
    const rows = [row({ class_id: 'c1', started_at: MON + 2 * WEEK + 2000, duration_seconds: 600 })]
    const bars = weeklyMinutesBars(rows, ['c1'], buckets, (end) => cohortFor(['c1'], firstPlay, end))
    expect(bars).toEqual([0, 0, 10])
  })

  it('meanBars averages only what is present, and keeps a fully-absent week absent', () => {
    expect(meanBars([[null, 10, 20], [null, 20, null]])).toEqual([null, 15, 20])
    expect(meanBars([])).toEqual([])
  })

  it('weeklyPhrasesBars: the cursor advance per week, absent before the cohort started, and the last bar equals newPhrasesInRange for that week', () => {
    const firstPlay = new Map<string, number | null>([['c1', MON + WEEK + 1000]])
    const rows = [
      row({ class_id: 'c1', started_at: MON + WEEK + 1000, start_ord: 1, end_ord: 12 }),
      row({ class_id: 'c1', started_at: MON + 2 * WEEK + 2000, start_ord: 12, end_ord: 17 }),
    ]
    const bars = weeklyPhrasesBars(rows, ['c1'], buckets, (end) => cohortFor(['c1'], firstPlay, end))
    expect(bars).toEqual([null, 12, 5])
    expect(bars[2]).toBe(newPhrasesInRange(rows, ['c1'], buckets[2].startMs, buckets[2].endMs))
  })
})

/**
 * JOB #207, Chepstow on production 2026-09-18. A whole-class school: 34
 * classes, 33 of them started, nine of them practising this week for 11.7
 * minutes between them. The mean is 0.354 of a minute — and round1 handed the
 * client a flat 0, which the card could only draw as "nobody practised", while
 * the class page beside it said 8 min. Tom: "It can't be zero if the class I'm
 * looking at has 8m."
 *
 * Red on round1 (0.354 -> 0); green on round1NonZero.
 */
describe('a cohort mean never flattens real practice to zero — job #207', () => {
  const MINUTES = [7.4, 1.5, 1.1, 0.8, 0.5, 0.4, 0.1, 0.1] // the nine classes that played; the rest are 0
  const chepstowRows: ScopedSessionRow[] = MINUTES.map((m, i) =>
    row({ class_id: `c${i}`, actor: 'class', started_at: MON + 3_600_000, duration_seconds: Math.round(m * 60) }))
  const allIds = Array.from({ length: 33 }, (_, i) => `c${i}`)

  it('11.7 minutes over 33 started classes is more than nothing', () => {
    const mean = meanWeekNumbers(allIds.map((id) => weekNumbersForClassIds(chepstowRows, [id], range.startMs, range.endMs)))
    expect(mean.classMinutes).toBeGreaterThan(0)
    expect(mean.totalMinutes).toBeGreaterThan(0)
  })

  it('and is still small — a tenth of a minute is never invented', () => {
    const mean = meanWeekNumbers(allIds.map((id) => weekNumbersForClassIds(chepstowRows, [id], range.startMs, range.endMs)))
    expect(mean.classMinutes).toBeLessThan(1)
  })

  it('a school of 300 classes and one 90-second lesson is still not zero', () => {
    const ids = Array.from({ length: 300 }, (_, i) => `b${i}`)
    const rows = [row({ class_id: 'b0', actor: 'class', started_at: MON + 3_600_000, duration_seconds: 90 })]
    const mean = meanWeekNumbers(ids.map((id) => weekNumbersForClassIds(rows, [id], range.startMs, range.endMs)))
    expect(mean.classMinutes).toBeGreaterThan(0)
  })

  it('a class that played for six seconds does not report a zero week', () => {
    const rows = [row({ class_id: 'x', actor: 'class', started_at: MON + 3_600_000, duration_seconds: 6 })]
    expect(rangeMinutesByActor(rows, ['x'], 'class', range.startMs, range.endMs).minutes).toBeGreaterThan(0)
  })

  it('a cohort that genuinely did nothing still reports zero', () => {
    const ids = ['z0', 'z1', 'z2']
    const mean = meanWeekNumbers(ids.map((id) => weekNumbersForClassIds([], [id], range.startMs, range.endMs)))
    expect(mean.classMinutes).toBe(0)
    expect(mean.totalMinutes).toBe(0)
  })
})
