import { describe, it, expect } from 'vitest'
import {
  weekNumbersForClassIds,
  meanWeekNumbers,
  newPhrasesInRange,
  rangeMinutesByActor,
  weeklyMinutesBars,
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
