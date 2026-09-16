/**
 * The week boundary is NOT invented here — it is Postgres's own
 * `date_trunc('week', …)`, which anchors Monday, READ IN EUROPE/LONDON.
 *
 * Both existing week-bucketing objects in the database — `weekly_leaderboard`
 * and `analytics_retention_days_active(p_weeks)` — call `date_trunc('week', …)`
 * with the session TimeZone, and the session TimeZone on this database is UTC
 * (verified live 2026-09-16: `SHOW TimeZone` → UTC). A UTC Monday is not a
 * school's Monday for half the year: under BST, Monday 00:00 London is
 * Sunday 23:00 UTC, so an hour of Monday-morning play lands in the PREVIOUS
 * week — a whole week out, not an hour.
 *
 * So the rule is kept (Monday, date_trunc semantics) and the ZONE is fixed
 * (Europe/London, Tom's ruling via Watson 2026-09-16). Every expectation below
 * is the output of the real query, run against the live database on
 * 2026-09-16 and pasted here:
 *
 *   SELECT ts,
 *          (date_trunc('week', ts AT TIME ZONE 'Europe/London')
 *             AT TIME ZONE 'Europe/London') AS monday_london,
 *          date_trunc('week', ts)           AS monday_utc
 *   FROM (VALUES …) t(ts);
 *
 * The `monday_utc` column is carried too, as the characterisation of what the
 * old bucketing would have said — if a future change ever makes these agree on
 * the BST rows, the boundary has silently gone back to UTC.
 */
import { describe, it, expect } from 'vitest'
import { startOfWeekMs, weekRange } from './schoolWeek'

const LONDON = 'Europe/London'
const iso = (ms: number): string => new Date(ms).toISOString().replace('.000Z', 'Z')

/** [instant, what Postgres says in Europe/London, what it says in UTC] */
const POSTGRES_ROWS: Array<[string, string, string, string]> = [
  ['2026-09-13T22:59:00Z', '2026-09-06T23:00:00Z', '2026-09-07T00:00:00Z', 'BST · Sunday 23:59 local — still last week'],
  ['2026-09-13T23:00:00Z', '2026-09-13T23:00:00Z', '2026-09-07T00:00:00Z', 'BST · Monday 00:00 local — the new week, to the minute'],
  ['2026-09-13T23:30:00Z', '2026-09-13T23:00:00Z', '2026-09-07T00:00:00Z', 'BST · Monday 00:30 local'],
  ['2026-01-11T23:59:00Z', '2026-01-05T00:00:00Z', '2026-01-05T00:00:00Z', 'GMT · Sunday 23:59 local — still last week'],
  ['2026-01-12T00:00:00Z', '2026-01-12T00:00:00Z', '2026-01-12T00:00:00Z', 'GMT · Monday 00:00 local — the new week'],
  ['2026-03-29T00:30:00Z', '2026-03-23T00:00:00Z', '2026-03-23T00:00:00Z', 'the spring-forward Sunday itself'],
  ['2026-10-25T01:30:00Z', '2026-10-18T23:00:00Z', '2026-10-19T00:00:00Z', 'the fall-back Sunday itself'],
]

describe("the boundary is Postgres's Monday, read in Europe/London", () => {
  for (const [instant, london, , why] of POSTGRES_ROWS) {
    it(`${why}: ${instant} → ${london}`, () => {
      expect(iso(startOfWeekMs(Date.parse(instant), LONDON))).toBe(london)
    })
  }

  it('differs from the UTC bucketing on exactly the BST Monday-morning rows — which is the whole point', () => {
    const disagreements = POSTGRES_ROWS.filter(([, london, utc]) => london !== utc).map(([i]) => i)
    expect(disagreements).toEqual([
      '2026-09-13T22:59:00Z',
      '2026-09-13T23:00:00Z',
      '2026-09-13T23:30:00Z',
      '2026-10-25T01:30:00Z',
    ])
  })
})

describe('the Sunday-night / Monday-morning edge', () => {
  it('BST: a lesson at 23:59 on Sunday and one at 00:01 on Monday are in DIFFERENT weeks', () => {
    const sun = Date.parse('2026-09-13T22:59:00Z') // Sun 23:59 BST
    const mon = Date.parse('2026-09-13T23:01:00Z') // Mon 00:01 BST
    expect(startOfWeekMs(sun, LONDON)).not.toBe(startOfWeekMs(mon, LONDON))
    expect(iso(startOfWeekMs(mon, LONDON))).toBe('2026-09-13T23:00:00Z')
  })

  it('BST: that Monday-morning lesson would have been filed a week early in UTC', () => {
    const mon = Date.parse('2026-09-13T23:01:00Z')
    const utcWeek = Date.UTC(2026, 8, 7) // what date_trunc('week', ts) says, session TZ = UTC
    expect(startOfWeekMs(mon, LONDON)).toBeGreaterThan(utcWeek)
    expect(startOfWeekMs(mon, LONDON) - utcWeek).toBe(7 * 86_400_000 - 3_600_000)
  })

  it('GMT: the same edge, with no offset in play', () => {
    const sun = Date.parse('2026-01-11T23:59:00Z')
    const mon = Date.parse('2026-01-12T00:01:00Z')
    expect(iso(startOfWeekMs(sun, LONDON))).toBe('2026-01-05T00:00:00Z')
    expect(iso(startOfWeekMs(mon, LONDON))).toBe('2026-01-12T00:00:00Z')
  })

  it('a week window ends exactly where the next one starts, across both edges', () => {
    for (const now of ['2026-09-16T12:00:00Z', '2026-01-14T12:00:00Z']) {
      const last = weekRange('last_week', Date.parse(now), LONDON)
      const thisW = weekRange('this_week', Date.parse(now), LONDON)
      expect(last.endMs).toBe(thisW.startMs)
      expect(startOfWeekMs(last.startMs, LONDON)).toBe(last.startMs)
    }
  })
})
