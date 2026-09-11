/**
 * IN-APP TIME PIN — the rule behind every school time figure
 * (api/_utils/inAppTime.ts): gaps under the idle cut-off count, longer gaps
 * do not, and no block can ever be a 128-hour sitting.
 */
import { describe, it, expect } from 'vitest'
import { sessioniseSeconds, activeDays, IDLE_CUTOFF_SECONDS, BLOCK_CAP_SECONDS } from './inAppTime'

const m = (min: number) => min * 60 * 1000

describe('sessioniseSeconds', () => {
  it('counts the gaps between clips inside a lesson — in-app time, not audio-played time', () => {
    // Four events over ten minutes, every gap under five minutes: 10 minutes.
    expect(sessioniseSeconds([0, m(3), m(7), m(10)])).toBe(600)
  })

  it('ends a block at the idle cut-off and does not count the silence', () => {
    // 10 min lesson, 30 min away, 5 min lesson = 15 min, never 45.
    expect(sessioniseSeconds([0, m(5), m(10), m(40), m(45)])).toBe(900)
    // A gap of exactly the cut-off is still inside the lesson.
    expect(sessioniseSeconds([0, IDLE_CUTOFF_SECONDS * 1000])).toBe(IDLE_CUTOFF_SECONDS)
  })

  it('a single event is presence with no measurable length', () => {
    expect(sessioniseSeconds([m(1)])).toBe(0)
    expect(sessioniseSeconds([])).toBe(0)
  })

  it('is order-independent — batch-posted events arrive out of order', () => {
    expect(sessioniseSeconds([m(10), 0, m(7), m(3)])).toBe(600)
  })

  it('caps a pathological block — the 128-hour sitting can never come back', () => {
    const ts: number[] = []
    for (let t = 0; t <= 128 * 60; t += 2) ts.push(m(t)) // an event every 2 min for 128 h
    expect(sessioniseSeconds(ts)).toBe(BLOCK_CAP_SECONDS)
  })

  it('the dials move the answer', () => {
    const ts = [0, m(3), m(10), m(11)]
    expect(sessioniseSeconds(ts, { idleCutoffSeconds: 120 })).toBe(60)
    expect(sessioniseSeconds(ts, { idleCutoffSeconds: 600 })).toBe(660)
  })
})

describe('activeDays', () => {
  it('counts the distinct UTC days a learner had any event on — one clip on a day is a day practised', () => {
    const d = (iso: string) => new Date(iso).getTime()
    expect(activeDays([
      d('2026-09-08T07:50:00Z'), d('2026-09-08T08:03:00Z'), // one lesson, one day
      d('2026-09-09T10:52:00Z'),                            // a single clip the next day
      d('2026-09-11T23:59:59Z'), d('2026-09-11T00:00:01Z'), // the same UTC day at both ends
    ])).toEqual(['2026-09-08', '2026-09-09', '2026-09-11'])
  })
  it('is empty for no events and ignores garbage stamps', () => {
    expect(activeDays([])).toEqual([])
    expect(activeDays([NaN])).toEqual([])
  })
})
