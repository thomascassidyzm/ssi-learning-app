import { describe, it, expect } from 'vitest'
import {
  startOfWeekMs,
  startOfWeekBack,
  weekRange,
  weekBuckets,
  defaultWeekWindow,
  weekLabel,
  fetchDaysForWeeks,
  wallClockToMs,
} from './schoolWeek'

const LONDON = 'Europe/London'

/** The instant of a London wall-clock time, for readable fixtures. */
const at = (y: number, m: number, d: number, h = 0, mi = 0): number => wallClockToMs(LONDON, y, m, d, h, mi)

describe('startOfWeekMs — Monday 00:00 local', () => {
  it('anchors mid-week to that week’s Monday', () => {
    // Thursday 11 June 2026, 14:00 London -> Monday 8 June 00:00 London
    expect(startOfWeekMs(at(2026, 6, 11, 14), LONDON)).toBe(at(2026, 6, 8))
  })

  it('treats Sunday as the END of the week, not the start', () => {
    // Sunday 14 June 2026 23:30 still belongs to the week that began Monday 8th.
    expect(startOfWeekMs(at(2026, 6, 14, 23, 30), LONDON)).toBe(at(2026, 6, 8))
  })

  it('is idempotent on the boundary instant itself', () => {
    const monday = at(2026, 6, 8)
    expect(startOfWeekMs(monday, LONDON)).toBe(monday)
  })

  // ── MONTH BOUNDARY ──
  it('crosses a month boundary backwards', () => {
    // Wednesday 1 July 2026 -> Monday 29 June 2026.
    expect(startOfWeekMs(at(2026, 7, 1, 9), LONDON)).toBe(at(2026, 6, 29))
  })

  it('crosses a YEAR boundary backwards', () => {
    // Friday 1 January 2027 -> Monday 28 December 2026.
    expect(startOfWeekMs(at(2027, 1, 1, 9), LONDON)).toBe(at(2026, 12, 28))
  })
})

describe('DST — the boundary stays at local midnight, not 7×24h', () => {
  it('spring forward: the week containing the clock change is still 00:00 local', () => {
    // UK clocks go forward 01:00 -> 02:00 on Sunday 29 March 2026.
    // Wednesday 1 April 2026 (BST) -> Monday 30 March 00:00 BST.
    const monday = startOfWeekMs(at(2026, 4, 1, 10), LONDON)
    expect(monday).toBe(at(2026, 3, 30))
    // The week that CONTAINED the change is 23 hours shorter than 7x24h.
    const prevMonday = startOfWeekBack(at(2026, 4, 1, 10), LONDON, 1)
    expect(prevMonday).toBe(at(2026, 3, 23))
    expect(monday - prevMonday).toBe(7 * 86_400_000 - 3_600_000)
  })

  it('fall back: the week containing the clock change is an hour longer', () => {
    // UK clocks go back 02:00 -> 01:00 on Sunday 25 October 2026.
    const monday = startOfWeekMs(at(2026, 10, 28, 10), LONDON) // Wednesday 28 Oct, GMT
    expect(monday).toBe(at(2026, 10, 26))
    const prevMonday = startOfWeekBack(at(2026, 10, 28, 10), LONDON, 1)
    expect(prevMonday).toBe(at(2026, 10, 19))
    expect(monday - prevMonday).toBe(7 * 86_400_000 + 3_600_000)
  })

  it('a zone with no DST at all is unaffected', () => {
    const tz = 'UTC'
    const mondayUtc = Date.UTC(2026, 5, 8)
    expect(startOfWeekMs(Date.UTC(2026, 5, 11, 14), tz)).toBe(mondayUtc)
  })

  it('a southern-hemisphere zone anchors on its OWN Monday', () => {
    const tz = 'Australia/Sydney'
    // Monday 8 June 2026 00:00 Sydney = Sunday 7 June 14:00 UTC (AEST, +10).
    expect(startOfWeekMs(Date.UTC(2026, 5, 11, 4), tz)).toBe(Date.UTC(2026, 5, 7, 14))
  })
})

describe('weekRange', () => {
  it('this week runs Monday 00:00 to NOW, never padded to Sunday night', () => {
    const now = at(2026, 6, 11, 14)
    const r = weekRange('this_week', now, LONDON)
    expect(r.startMs).toBe(at(2026, 6, 8))
    expect(r.endMs).toBe(now)
  })

  it('last week is the previous COMPLETE Monday–Sunday', () => {
    const now = at(2026, 6, 11, 14)
    const r = weekRange('last_week', now, LONDON)
    expect(r.startMs).toBe(at(2026, 6, 1))
    expect(r.endMs).toBe(at(2026, 6, 8))
  })

  it('last week across a month boundary is still whole', () => {
    const now = at(2026, 7, 1, 9) // Wednesday
    const r = weekRange('last_week', now, LONDON)
    expect(r.startMs).toBe(at(2026, 6, 22))
    expect(r.endMs).toBe(at(2026, 6, 29))
  })
})

describe('defaultWeekWindow', () => {
  it('opens on LAST week on a Monday or a Tuesday', () => {
    expect(defaultWeekWindow(at(2026, 6, 8, 9), LONDON)).toBe('last_week') // Monday
    expect(defaultWeekWindow(at(2026, 6, 9, 16), LONDON)).toBe('last_week') // Tuesday
  })

  it('opens on THIS week from Wednesday onwards, Sunday included', () => {
    expect(defaultWeekWindow(at(2026, 6, 10, 9), LONDON)).toBe('this_week') // Wednesday
    expect(defaultWeekWindow(at(2026, 6, 12, 15), LONDON)).toBe('this_week') // Friday
    expect(defaultWeekWindow(at(2026, 6, 14, 20), LONDON)).toBe('this_week') // Sunday
  })
})

describe('weekBuckets — 12 Monday-anchored weeks', () => {
  const now = at(2026, 6, 11, 14)
  const buckets = weekBuckets(now, LONDON, 12)

  it('returns exactly 12, oldest first, contiguous', () => {
    expect(buckets).toHaveLength(12)
    for (let i = 1; i < buckets.length; i++) expect(buckets[i].startMs).toBe(buckets[i - 1].endMs)
  })

  it('every bucket starts on a Monday 00:00 local', () => {
    for (const b of buckets) expect(startOfWeekMs(b.startMs, LONDON)).toBe(b.startMs)
  })

  it('the newest bucket is the week containing now, and ends next Monday', () => {
    const last = buckets[11]
    expect(last.startMs).toBe(at(2026, 6, 8))
    expect(last.endMs).toBe(at(2026, 6, 15))
  })

  it('spans the DST change without losing or duplicating a week', () => {
    const b = weekBuckets(at(2026, 4, 15, 12), LONDON, 12) // 12 weeks back crosses 29 March
    expect(b).toHaveLength(12)
    const starts = new Set(b.map((x) => x.startMs))
    expect(starts.size).toBe(12)
    for (const x of b) expect(startOfWeekMs(x.startMs, LONDON)).toBe(x.startMs)
  })
})

describe('labels and fetch span', () => {
  it('labels a within-month week as a day range', () => {
    expect(weekLabel({ startMs: at(2026, 6, 8), endMs: at(2026, 6, 15) }, LONDON)).toBe('8–14 Jun')
  })

  it('labels a month-straddling week with both months', () => {
    expect(weekLabel({ startMs: at(2026, 6, 29), endMs: at(2026, 7, 6) }, LONDON)).toBe('29 Jun – 5 Jul')
  })

  it('fetches enough days to fill every bucket', () => {
    const now = at(2026, 6, 11, 14)
    const days = fetchDaysForWeeks(now, LONDON, 12)
    const oldest = weekBuckets(now, LONDON, 12)[0].startMs
    expect(now - days * 86_400_000).toBeLessThanOrEqual(oldest)
  })
})
