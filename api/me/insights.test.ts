/**
 * /api/me/insights — the learner's own insights against the course average,
 * pinned on the pure pieces (Tom, 2026-09-14: me v the course average, never
 * v another person; a percentile only against 20+ active people).
 */
import { describe, it, expect } from 'vitest'
import { insightMeasureFor, personValues, placeAmong, othersBesides, PERCENTILE_FLOOR, MEASURES } from './insights'
import { courseFactsFromSpans, pooledFacts } from '../intel/minutes'
import type { DiarySessionisation, PlaySpan } from '../_utils/inAppTime'

const NOW = Date.UTC(2026, 8, 14, 3, 0, 0)
const DAY = 86_400_000
const SINCE = NOW - 7 * DAY

const span = (startMs: number, seconds: number, course: string, mode: 'main' | 'listening' = 'main'): PlaySpan => ({
  startMs, endMs: startMs + seconds * 1000, mode, seconds, course, clips: 1,
  openedBy: 'tap_play', closedBy: 'tap_pause', closeClipEnd: 'tap', closerAudioId: null,
})
const session = (spans: PlaySpan[]): DiarySessionisation => ({
  seconds: spans.reduce((n, s) => n + s.seconds, 0),
  mainSeconds: spans.filter((s) => s.mode === 'main').reduce((n, s) => n + s.seconds, 0),
  listeningSeconds: spans.filter((s) => s.mode === 'listening').reduce((n, s) => n + s.seconds, 0),
  spans, unresolvedAudioIds: [],
})

describe('insightMeasureFor — learner-weighted, the same formula for me, the course and the pool', () => {
  const me = 'me'
  const sessions = new Map<string, DiarySessionisation>([
    [me, session([span(NOW - 2 * DAY, 600, 'cym'), span(NOW - DAY, 300, 'cym', 'listening')])], // 15 min in 2 sessions
    ['b', session([span(NOW - 3 * DAY, 1800, 'cym')])],                                            // 30 min in 1
    ['c', session([span(NOW - DAY, 120, 'cym', 'listening')])],                                     // 2 min listening
  ])
  const enrolments = [
    { learner_id: me, course_id: 'cym', enrolled_at: null },
    { learner_id: 'b', course_id: 'cym', enrolled_at: null },
    { learner_id: 'c', course_id: 'cym', enrolled_at: null },
    { learner_id: 'd', course_id: 'cym', enrolled_at: null }, // enrolled, silent — still a person the average divides by
  ]
  const real = new Set([me, 'b', 'c', 'd'])
  const course = courseFactsFromSpans(sessions, enrolments, real, SINCE, NOW, 7, 1).get('cym')!
  const own = courseFactsFromSpans(new Map([[me, sessions.get(me)!]]), [], new Set([me]), SINCE, NOW, 7, 1).get('cym')!

  it('my own minutes divide by one person: 15 min, 2 sessions, 5 listening', () => {
    expect(insightMeasureFor('minutes_total', own).value).toBe(15)
    expect(insightMeasureFor('minutes_per_session', own).value).toBe(7.5)
    expect(insightMeasureFor('listening_minutes', own).value).toBe(5)
  })
  it('the course average is every minute over every person, the silent one included', () => {
    // 15 + 30 + 2 = 47 min over 4 people
    expect(insightMeasureFor('minutes_total', course).value).toBe(11.8)
    // 47 min over 4 sessions
    expect(insightMeasureFor('minutes_per_session', course).value).toBe(11.8)
    // 5 + 2 = 7 listening min over 4 people
    expect(insightMeasureFor('listening_minutes', course).value).toBe(1.8)
  })
  it('the trend carries the same weighting bucket by bucket', () => {
    const t = insightMeasureFor('minutes_total', course).trend
    expect(t).toHaveLength(7)
    expect(t.reduce((a, b) => a + b, 0)).toBeCloseTo(11.8, 0)
  })
  it('a pool of courses is learner-weighted, not a mean of course means', () => {
    const spa = courseFactsFromSpans(new Map([['e', session([span(NOW - DAY, 60, 'spa')])]]), [{ learner_id: 'e', course_id: 'spa', enrolled_at: null }], new Set(['e']), SINCE, NOW, 7, 1).get('spa')!
    const pooled = pooledFacts([course, spa])
    // 47 + 1 = 48 min over 5 course-persons
    expect(insightMeasureFor('minutes_total', pooled).value).toBe(9.6)
    expect(othersBesides(pooled, me)).toBe(4)
    expect(othersBesides(course, me)).toBe(3)
  })
  it('personValues never carries the caller once removed, and silent people read 0', () => {
    const v = personValues('minutes_total', sessions, course.people, 'cym', SINCE, NOW)
    expect(v.get('d')).toBe(0)
    v.delete(me)
    expect([...v.keys()].sort()).toEqual(['b', 'c', 'd'])
  })
})

describe('placeAmong — a percentile only against 20+ active people', () => {
  const values = Array.from({ length: 30 }, (_, i) => i) // 0..29
  it(`suppresses the percentile and sends NO shape below ${PERCENTILE_FLOOR} active`, () => {
    const p = placeAmong(15, values, PERCENTILE_FLOOR - 1)
    expect(p.percentileNote).toMatch(/Not enough people yet/)
    expect(p.percentile).toBe(0)
    expect(p.distribution.values).toEqual([])
    expect(p.distribution.max).toBe(0)
  })
  it(`shows a percentile and an anonymised shape at ${PERCENTILE_FLOOR} active`, () => {
    const p = placeAmong(15, values, PERCENTILE_FLOOR)
    expect(p.percentileNote).toBeNull()
    expect(p.percentile).toBe(53) // 16 of 30 values are <= 15
    expect(p.distribution.values).toHaveLength(30)
    expect(p.distribution.median).toBe(14.5)
  })
})

describe('contract', () => {
  it('offers exactly the three measures Tom named, in-app minutes first', () => {
    expect(MEASURES.map((m) => m.value)).toEqual(['minutes_total', 'minutes_per_session', 'listening_minutes'])
  })
})
