import { describe, it, expect } from 'vitest'
import {
  windowPaceForClass,
  aggregateWindowPace,
  weeklyTrendForClass,
  aggregateWeeklyTrend,
  periodTrendForClass,
  aggregatePeriodTrend,
  windowMinutesForClass,
  aggregateWindowMinutes,
  minutesTrendForClass,
  aggregateMinutesTrend,
  windowHoursForEntity,
  hoursTrendForEntity,
  activeClassesShareForEntity,
  activeClassesTrendForEntity,
  computeMeasureForClassIds,
  distributionStats,
  deltaPct,
  meanTrend,
  coverageLabel,
  type ScopedSessionRow,
} from './rateCompare'

const NOW = new Date('2026-07-14T12:00:00Z')

function row(overrides: Partial<ScopedSessionRow>): ScopedSessionRow {
  return {
    class_id: 'c1',
    course_code: 'cym_for_eng',
    start_lego_id: null,
    end_lego_id: null,
    start_ord: null,
    end_ord: null,
    duration_seconds: 600,
    started_at: NOW.toISOString(),
    ...overrides,
  }
}

describe('windowPaceForClass', () => {
  it('returns hasData=false with zero pace for a class with no rows', () => {
    const result = windowPaceForClass([], 'c1', 90, NOW)
    expect(result.hasData).toBe(false)
    expect(result.pace).toBe(0)
  })

  it('computes legos-advanced / weeks-spanned across two sessions a week apart', () => {
    const rows: ScopedSessionRow[] = [
      row({ start_ord: 1, end_ord: 5, end_lego_id: 'S1L05', started_at: new Date(NOW.getTime() - 7 * 86_400_000).toISOString() }),
      row({ start_ord: 5, end_ord: 12, end_lego_id: 'S2L12', started_at: NOW.toISOString() }),
    ]
    const result = windowPaceForClass(rows, 'c1', 90, NOW)
    expect(result.hasData).toBe(true)
    expect(result.legosAdvanced).toBe(11) // furthest(12) - earliest(1)
    expect(result.pace).toBe(11) // 11 legos / 1 week span
    expect(result.furthestLegoId).toBe('S2L12')
  })

  it('floors the week span at 1 day for a single-session class (no divide-by-~0)', () => {
    const rows: ScopedSessionRow[] = [row({ start_ord: 1, end_ord: 4, end_lego_id: 'S1L04' })]
    const result = windowPaceForClass(rows, 'c1', 90, NOW)
    // span floored to 1/7 week -> pace = 3 / (1/7) = 21
    expect(result.pace).toBe(21)
  })

  it('decays the rate for a class that has gone quiet (denominator anchored to NOW)', () => {
    // One burst 9 weeks ago: 18 legos in a week. The honest CURRENT rate is
    // 18 / 9 weeks = 2/wk — not 18/wk. (This was the flat-trend-chart card
    // headlining +88.9%: the old span-of-activity denominator ignored idle time.)
    const rows: ScopedSessionRow[] = [
      row({ start_ord: 1, end_ord: 10, started_at: new Date(NOW.getTime() - 63 * 86_400_000).toISOString() }),
      row({ start_ord: 10, end_ord: 19, end_lego_id: 'S3L19', started_at: new Date(NOW.getTime() - 56 * 86_400_000).toISOString() }),
    ]
    const result = windowPaceForClass(rows, 'c1', 90, NOW)
    expect(result.legosAdvanced).toBe(18)
    expect(result.pace).toBe(2) // 18 / 9 weeks since first activity
  })

  it('ignores rows outside the requested window', () => {
    const rows: ScopedSessionRow[] = [
      row({ start_ord: 1, end_ord: 50, end_lego_id: 'S5L50', started_at: new Date(NOW.getTime() - 200 * 86_400_000).toISOString() }),
    ]
    const result = windowPaceForClass(rows, 'c1', 90, NOW)
    expect(result.hasData).toBe(false)
  })

  it('never returns a negative legosAdvanced when sessions run backwards (replay)', () => {
    const rows: ScopedSessionRow[] = [
      row({ start_ord: 10, end_ord: 8, started_at: new Date(NOW.getTime() - 3 * 86_400_000).toISOString() }),
    ]
    const result = windowPaceForClass(rows, 'c1', 90, NOW)
    expect(result.legosAdvanced).toBeGreaterThanOrEqual(0)
  })
})

describe('aggregateWindowPace', () => {
  it('for a single-class set, is identical to windowPaceForClass', () => {
    const rows: ScopedSessionRow[] = [row({ start_ord: 1, end_ord: 12, end_lego_id: 'S2L12' })]
    const single = windowPaceForClass(rows, 'c1', 90, NOW)
    const agg = aggregateWindowPace(rows, ['c1'], 90, NOW)
    expect(agg).toEqual(single)
  })

  it('averages pace across member classes that have data, ignoring members with none', () => {
    const rows: ScopedSessionRow[] = [
      row({ class_id: 'c1', start_ord: 1, end_ord: 4, end_lego_id: 'S1L04' }), // pace 21 (single-session floor)
      row({ class_id: 'c2', start_ord: 1, end_ord: 8, end_lego_id: 'S2L08' }), // pace 49
      // c3 has no rows at all — excluded from the mean, not treated as 0.
    ]
    const agg = aggregateWindowPace(rows, ['c1', 'c2', 'c3'], 90, NOW)
    expect(agg.hasData).toBe(true)
    expect(agg.pace).toBe(35) // mean(21, 49)
  })

  it('picks the highest-ordinal furthest lego across members (comparable — same course)', () => {
    const rows: ScopedSessionRow[] = [
      row({ class_id: 'c1', start_ord: 1, end_ord: 4, end_lego_id: 'S1L04' }),
      row({ class_id: 'c2', start_ord: 1, end_ord: 30, end_lego_id: 'S5L30' }),
    ]
    const agg = aggregateWindowPace(rows, ['c1', 'c2'], 90, NOW)
    expect(agg.furthestLegoId).toBe('S5L30')
    expect(agg.furthestOrd).toBe(30)
  })

  it('degrades to hasData=false when no member has any data', () => {
    const agg = aggregateWindowPace([], ['c1', 'c2'], 90, NOW)
    expect(agg).toEqual({ pace: 0, legosAdvanced: 0, hasData: false, furthestLegoId: null, furthestOrd: 0 })
  })
})

describe('aggregateWeeklyTrend', () => {
  it('for a single-class set, is identical to weeklyTrendForClass', () => {
    const rows: ScopedSessionRow[] = [row({ end_ord: 10, started_at: NOW.toISOString() })]
    expect(aggregateWeeklyTrend(rows, ['c1'], 8, NOW)).toEqual(weeklyTrendForClass(rows, 'c1', 8, NOW))
  })

  it('mean-trends across member classes, ignoring members with no rows', () => {
    const rows: ScopedSessionRow[] = [
      row({ class_id: 'c1', end_ord: 10, started_at: NOW.toISOString() }),
      row({ class_id: 'c2', end_ord: 20, started_at: NOW.toISOString() }),
    ]
    const trend = aggregateWeeklyTrend(rows, ['c1', 'c2', 'c3'], 8, NOW)
    expect(trend).toHaveLength(8)
    expect(trend.reduce((a, b) => a + b, 0)).toBe(15) // mean(10, 20) landing in the final week
  })
})

describe('weeklyTrendForClass', () => {
  it('returns an empty array for a class with no rows at all', () => {
    expect(weeklyTrendForClass([], 'c1', 8, NOW)).toEqual([])
  })

  it('returns exactly `weeks` points, oldest -> newest', () => {
    const rows: ScopedSessionRow[] = [
      row({ end_ord: 10, started_at: new Date(NOW.getTime() - 6 * MSDAY(7)).toISOString() }),
      row({ end_ord: 20, started_at: new Date(NOW.getTime() - 2 * MSDAY(7)).toISOString() }),
      row({ end_ord: 30, started_at: NOW.toISOString() }),
    ]
    const trend = weeklyTrendForClass(rows, 'c1', 8, NOW)
    expect(trend).toHaveLength(8)
    expect(trend.every((v) => v >= 0)).toBe(true)
    // total advance across the whole trend equals the final cumulative max
    expect(trend.reduce((a, b) => a + b, 0)).toBe(30)
  })
})

function MSDAY(days: number): number {
  return days * 86_400_000
}

describe('distributionStats', () => {
  it('computes quartiles and a percentile lookup over a sorted set', () => {
    const stats = distributionStats([4, 1, 8, 2, 6])
    expect(stats.values).toEqual([1, 2, 4, 6, 8])
    expect(stats.min).toBe(1)
    expect(stats.max).toBe(8)
    expect(stats.median).toBe(4)
    expect(stats.percentileOf(4)).toBe(60) // 3 of 5 values <= 4
  })

  it('degrades to well-formed zeros for an empty cohort', () => {
    const stats = distributionStats([])
    expect(stats.min).toBe(0)
    expect(stats.max).toBe(0)
    expect(stats.percentileOf(5)).toBe(0)
  })
})

describe('deltaPct', () => {
  it('computes a signed percentage above/below the average', () => {
    expect(deltaPct(12, 10)).toBe(20)
    expect(deltaPct(8, 10)).toBe(-20)
  })

  it('handles a zero average without dividing by zero', () => {
    expect(deltaPct(5, 0)).toBe(100)
    expect(deltaPct(0, 0)).toBe(0)
  })
})

describe('meanTrend', () => {
  it('averages element-wise across multiple trends', () => {
    expect(meanTrend([[1, 2, 3], [3, 4, 5]])).toEqual([2, 3, 4])
  })

  it('ignores empty trends and returns [] if all are empty', () => {
    expect(meanTrend([[], []])).toEqual([])
    expect(meanTrend([[1, 2], []])).toEqual([1, 2])
  })

  it('aligns ragged trends from their newest (right) edge', () => {
    expect(meanTrend([[1, 2, 3], [10, 20]])).toEqual([6, 11.5])
  })
})

describe('coverageLabel', () => {
  it('formats a lego id into the human "S# · L##" label', () => {
    expect(coverageLabel('S0042L03')).toBe('S42 · L3')
  })
  it('falls back to em-dash for null', () => {
    expect(coverageLabel(null)).toBe('—')
  })
})

// ─────────────────────────────────────────────────────────────────────────
// THE LENS windows+measures contract — periodDays generalization + the three
// new measures (minutes_per_class, hours_total, active_classes).
// ─────────────────────────────────────────────────────────────────────────

describe('periodTrendForClass', () => {
  it('weeklyTrendForClass is exactly the periodDays=7 case of periodTrendForClass', () => {
    const rows: ScopedSessionRow[] = [
      row({ end_ord: 10, started_at: new Date(NOW.getTime() - 6 * MSDAY(7)).toISOString() }),
      row({ end_ord: 30, started_at: NOW.toISOString() }),
    ]
    expect(periodTrendForClass(rows, 'c1', 8, 7, NOW)).toEqual(weeklyTrendForClass(rows, 'c1', 8, NOW))
  })

  it('computes a daily trend at periodDays=1 (the "week" window: 7 daily points)', () => {
    const rows: ScopedSessionRow[] = [
      row({ end_ord: 5, started_at: new Date(NOW.getTime() - 2 * MSDAY(1)).toISOString() }),
      row({ end_ord: 12, started_at: NOW.toISOString() }),
    ]
    const trend = periodTrendForClass(rows, 'c1', 7, 1, NOW)
    expect(trend).toHaveLength(7)
    expect(trend.reduce((a, b) => a + b, 0)).toBe(12)
  })

  it('computes a monthly (30-day) trend at periodDays=30 (the "all" window: 12 monthly points)', () => {
    const rows: ScopedSessionRow[] = [row({ end_ord: 40, started_at: NOW.toISOString() })]
    const trend = periodTrendForClass(rows, 'c1', 12, 30, NOW)
    expect(trend).toHaveLength(12)
    expect(trend.reduce((a, b) => a + b, 0)).toBe(40)
  })
})

describe('aggregatePeriodTrend', () => {
  it('mean-trends across member classes at any period granularity', () => {
    const rows: ScopedSessionRow[] = [
      row({ class_id: 'c1', end_ord: 10, started_at: NOW.toISOString() }),
      row({ class_id: 'c2', end_ord: 20, started_at: NOW.toISOString() }),
    ]
    const trend = aggregatePeriodTrend(rows, ['c1', 'c2'], 4, 7, NOW)
    expect(trend).toHaveLength(4)
    expect(trend.reduce((a, b) => a + b, 0)).toBe(15) // mean(10, 20)
  })
})

describe('windowMinutesForClass', () => {
  it('returns hasData=false for a class with no rows', () => {
    expect(windowMinutesForClass([], 'c1', 90, NOW).hasData).toBe(false)
  })

  it('computes mean weekly minutes, NOW-anchored (single-session floor mirrors pace math)', () => {
    const rows: ScopedSessionRow[] = [row({ duration_seconds: 1800, started_at: NOW.toISOString() })]
    // 30 min in a span floored to 1/7 week -> 30 * 7 = 210 min/wk
    expect(windowMinutesForClass(rows, 'c1', 90, NOW).minutesPerWeek).toBe(210)
  })

  it('decays for a class that has gone quiet — NOW-anchored, like windowPaceForClass', () => {
    const rows: ScopedSessionRow[] = [
      row({ duration_seconds: 3600, started_at: new Date(NOW.getTime() - 56 * 86_400_000).toISOString() }), // 60 min, 8 weeks ago
    ]
    expect(windowMinutesForClass(rows, 'c1', 90, NOW).minutesPerWeek).toBe(7.5) // 60 min / 8 weeks
  })

  it('ignores rows outside the requested window', () => {
    const rows: ScopedSessionRow[] = [
      row({ duration_seconds: 3600, started_at: new Date(NOW.getTime() - 200 * 86_400_000).toISOString() }),
    ]
    expect(windowMinutesForClass(rows, 'c1', 90, NOW).hasData).toBe(false)
  })
})

describe('aggregateWindowMinutes', () => {
  it('averages minutes-per-week across active member classes, ignoring members with none', () => {
    const rows: ScopedSessionRow[] = [
      row({ class_id: 'c1', duration_seconds: 1800, started_at: NOW.toISOString() }), // 210/wk
      row({ class_id: 'c2', duration_seconds: 3600, started_at: NOW.toISOString() }), // 420/wk
      // c3 has no rows — excluded from the mean, not treated as 0.
    ]
    const agg = aggregateWindowMinutes(rows, ['c1', 'c2', 'c3'], 90, NOW)
    expect(agg.hasData).toBe(true)
    expect(agg.minutesPerWeek).toBe(315) // mean(210, 420)
  })

  it('degrades to hasData=false when no member has any data', () => {
    expect(aggregateWindowMinutes([], ['c1', 'c2'], 90, NOW)).toEqual({ minutesPerWeek: 0, hasData: false })
  })
})

describe('minutesTrendForClass', () => {
  it('returns an empty array for a class with no rows at all', () => {
    expect(minutesTrendForClass([], 'c1', 8, 7, NOW)).toEqual([])
  })

  it('buckets minutes per period — NOT cumulative (minutes are not monotonic like LEGO position)', () => {
    const rows: ScopedSessionRow[] = [
      row({ duration_seconds: 1800, started_at: new Date(NOW.getTime() - 6 * MSDAY(7)).toISOString() }), // 30 min, 6 weeks ago
      row({ duration_seconds: 1200, started_at: NOW.toISOString() }), // 20 min, now
    ]
    const trend = minutesTrendForClass(rows, 'c1', 8, 7, NOW)
    expect(trend).toHaveLength(8)
    expect(trend.reduce((a, b) => a + b, 0)).toBe(50) // 30 + 20 minutes total, summed not cumulative
  })
})

describe('aggregateMinutesTrend', () => {
  it('mean-trends minutes across member classes', () => {
    const rows: ScopedSessionRow[] = [
      row({ class_id: 'c1', duration_seconds: 1200, started_at: NOW.toISOString() }), // 20 min
      row({ class_id: 'c2', duration_seconds: 2400, started_at: NOW.toISOString() }), // 40 min
    ]
    const trend = aggregateMinutesTrend(rows, ['c1', 'c2'], 4, 7, NOW)
    expect(trend).toHaveLength(4)
    expect(trend[trend.length - 1]).toBe(30) // mean(20, 40) landing in the final bucket
  })
})

describe('windowHoursForEntity', () => {
  it("sums total practice hours across an entity's classes inside the window — a straight sum, no NOW-anchored decay", () => {
    const rows: ScopedSessionRow[] = [
      row({ class_id: 'c1', duration_seconds: 3600, started_at: new Date(NOW.getTime() - 60 * 86_400_000).toISOString() }), // 1h, 60 days ago
      row({ class_id: 'c2', duration_seconds: 7200, started_at: NOW.toISOString() }), // 2h now
    ]
    const result = windowHoursForEntity(rows, ['c1', 'c2'], 90, NOW)
    expect(result.hasData).toBe(true)
    expect(result.hours).toBe(3) // 1h + 2h — a total, not a decaying rate
  })

  it('ignores rows outside the window and rows for classes not in the entity', () => {
    const rows: ScopedSessionRow[] = [
      row({ class_id: 'c1', duration_seconds: 3600, started_at: new Date(NOW.getTime() - 200 * 86_400_000).toISOString() }),
      row({ class_id: 'other', duration_seconds: 3600, started_at: NOW.toISOString() }),
    ]
    const result = windowHoursForEntity(rows, ['c1'], 90, NOW)
    expect(result.hasData).toBe(false)
    expect(result.hours).toBe(0)
  })
})

describe('hoursTrendForEntity', () => {
  it('buckets TOTAL hours per period across the whole entity (sum, not per-class-then-averaged)', () => {
    const rows: ScopedSessionRow[] = [
      row({ class_id: 'c1', duration_seconds: 3600, started_at: NOW.toISOString() }),
      row({ class_id: 'c2', duration_seconds: 3600, started_at: NOW.toISOString() }),
    ]
    const trend = hoursTrendForEntity(rows, ['c1', 'c2'], 4, 7, NOW)
    expect(trend).toHaveLength(4)
    expect(trend[trend.length - 1]).toBe(2) // 1h + 1h summed, not averaged
  })
})

describe('activeClassesShareForEntity', () => {
  it('returns hasData=false for an entity with no classes', () => {
    expect(activeClassesShareForEntity([], [], 90, NOW).hasData).toBe(false)
  })

  it("computes % of the entity's own classes active in the window", () => {
    const rows: ScopedSessionRow[] = [row({ class_id: 'c1', started_at: NOW.toISOString() })]
    const result = activeClassesShareForEntity(rows, ['c1', 'c2', 'c3', 'c4'], 90, NOW)
    expect(result.hasData).toBe(true)
    expect(result.pct).toBe(25) // 1 of 4
  })

  it('ignores rows outside the window', () => {
    const rows: ScopedSessionRow[] = [
      row({ class_id: 'c1', started_at: new Date(NOW.getTime() - 200 * 86_400_000).toISOString() }),
    ]
    expect(activeClassesShareForEntity(rows, ['c1', 'c2'], 90, NOW).pct).toBe(0)
  })
})

describe('activeClassesTrendForEntity', () => {
  it('buckets active-share per period', () => {
    const rows: ScopedSessionRow[] = [row({ class_id: 'c1', started_at: NOW.toISOString() })]
    const trend = activeClassesTrendForEntity(rows, ['c1', 'c2'], 4, 7, NOW)
    expect(trend).toHaveLength(4)
    expect(trend[trend.length - 1]).toBe(50) // 1 of 2 active in the final bucket
  })

  it('returns [] for an empty classIds set', () => {
    expect(activeClassesTrendForEntity([], [], 4, 7, NOW)).toEqual([])
  })
})

describe('computeMeasureForClassIds — one dispatch, every measure follows the same grammar', () => {
  const rows: ScopedSessionRow[] = [
    row({ class_id: 'c1', start_ord: 0, end_ord: 10, duration_seconds: 1800, started_at: NOW.toISOString() }),
  ]

  it('rate dispatches to aggregateWindowPace + aggregatePeriodTrend', () => {
    const result = computeMeasureForClassIds('rate', rows, ['c1'], 90, 8, 7, NOW)
    expect(result.value).toBe(aggregateWindowPace(rows, ['c1'], 90, NOW).pace)
    expect(result.trend).toEqual(aggregatePeriodTrend(rows, ['c1'], 8, 7, NOW))
  })

  it('minutes_per_class dispatches to aggregateWindowMinutes + aggregateMinutesTrend', () => {
    const result = computeMeasureForClassIds('minutes_per_class', rows, ['c1'], 90, 8, 7, NOW)
    expect(result.value).toBe(aggregateWindowMinutes(rows, ['c1'], 90, NOW).minutesPerWeek)
    expect(result.trend).toEqual(aggregateMinutesTrend(rows, ['c1'], 8, 7, NOW))
  })

  it('hours_total dispatches to windowHoursForEntity + hoursTrendForEntity', () => {
    const result = computeMeasureForClassIds('hours_total', rows, ['c1'], 90, 8, 7, NOW)
    expect(result.value).toBe(windowHoursForEntity(rows, ['c1'], 90, NOW).hours)
    expect(result.trend).toEqual(hoursTrendForEntity(rows, ['c1'], 8, 7, NOW))
  })

  it('active_classes dispatches to activeClassesShareForEntity + activeClassesTrendForEntity', () => {
    const result = computeMeasureForClassIds('active_classes', rows, ['c1'], 90, 8, 7, NOW)
    expect(result.value).toBe(activeClassesShareForEntity(rows, ['c1'], 90, NOW).pct)
    expect(result.trend).toEqual(activeClassesTrendForEntity(rows, ['c1'], 8, 7, NOW))
  })
})

describe('honest-pace decay at the "all time" window (3650-day practical-unbounded scope)', () => {
  it('anchors the ALL-TIME rate denominator to first activity EVER -> now, decaying for a long-idle class', () => {
    const rows: ScopedSessionRow[] = [
      row({ start_ord: 0, end_ord: 100, started_at: new Date(NOW.getTime() - 500 * 86_400_000).toISOString() }),
    ]
    const result = windowPaceForClass(rows, 'c1', 3650, NOW)
    expect(result.hasData).toBe(true)
    expect(result.pace).toBe(1.4) // 100 legos / (500/7 weeks)
  })

  it('the minutes measure decays the same way at the all-time window', () => {
    const rows: ScopedSessionRow[] = [
      row({ duration_seconds: 36000, started_at: new Date(NOW.getTime() - 700 * 86_400_000).toISOString() }), // 10h, 100 weeks ago
    ]
    expect(windowMinutesForClass(rows, 'c1', 3650, NOW).minutesPerWeek).toBe(6) // 600 min / 100 weeks
  })

  it("hours_total stays a straight sum even at the all-time window — no decay, unlike rate/minutes", () => {
    const rows: ScopedSessionRow[] = [
      row({ duration_seconds: 3600, started_at: new Date(NOW.getTime() - 900 * 86_400_000).toISOString() }),
    ]
    expect(windowHoursForEntity(rows, ['c1'], 3650, NOW).hours).toBe(1)
  })
})
