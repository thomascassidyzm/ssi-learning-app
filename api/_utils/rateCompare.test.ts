import { describe, it, expect } from 'vitest'
import {
  windowPaceForClass,
  weeklyTrendForClass,
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
