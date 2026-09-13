/**
 * /api/intel/minutes — the measures behind Intelligence at Everyone scope,
 * pinned on the pure pieces: per-course facts from spans + enrolments, and
 * the three measures over them (job #609, Tom's ruling 2026-09-13).
 */
import { describe, it, expect } from 'vitest'
import { courseFactsFromSpans, measureFor, WINDOWS, MEASURES } from './minutes'
import type { DiarySessionisation, PlaySpan } from '../_utils/inAppTime'

const NOW = Date.UTC(2026, 8, 13, 22, 0, 0)
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

const REAL = new Set(['a', 'b', 'c', 'd'])

describe('courseFactsFromSpans', () => {
  const sessions = new Map<string, DiarySessionisation>([
    ['a', session([span(NOW - 2 * DAY, 600, 'cym'), span(NOW - DAY, 300, 'cym', 'listening')])],
    ['b', session([span(NOW - 3 * DAY, 900, 'cym')])],
    ['x', session([span(NOW - DAY, 6000, 'cym')])], // excluded from the population: never counted
    ['d', session([span(NOW - DAY, 120, 'spa')])],
  ])
  const enrolments = [
    { learner_id: 'a', course_id: 'cym', enrolled_at: new Date(NOW - 40 * DAY).toISOString() },
    { learner_id: 'b', course_id: 'cym', enrolled_at: new Date(NOW - 2 * DAY).toISOString() },   // new this window
    { learner_id: 'c', course_id: 'cym', enrolled_at: null },                                     // enrolled, silent
    { learner_id: 'x', course_id: 'cym', enrolled_at: new Date(NOW - DAY).toISOString() },        // not real
    { learner_id: 'a', course_id: 'spa', enrolled_at: new Date(NOW + DAY).toISOString() },        // after the window: not yet a course-person
  ]

  it('counts course-people as real enrolled learners plus real players, minutes by mode, and new enrolments inside the window', () => {
    const facts = courseFactsFromSpans(sessions, enrolments, REAL, SINCE, NOW, 7, 1)
    const cym = facts.get('cym')!
    expect([...cym.people].sort()).toEqual(['a', 'b', 'c'])
    expect([...cym.activePeople].sort()).toEqual(['a', 'b'])
    expect(cym.seconds).toBe(1800)
    expect(cym.mainSeconds).toBe(1500)
    expect(cym.listeningSeconds).toBe(300)
    expect(cym.newEnrolments).toBe(1)
    // d played spa with no enrolment row: a course-person by play
    const spa = facts.get('spa')!
    expect([...spa.people]).toEqual(['d'])
    expect(spa.newEnrolments).toBe(0)
  })

  it('buckets seconds by trend period, splitting a span that straddles a boundary', () => {
    const straddle = new Map([['a', session([span(NOW - DAY - 30_000, 60, 'cym')])]])
    const facts = courseFactsFromSpans(straddle, [], REAL, SINCE, NOW, 7, 1)
    const b = facts.get('cym')!.bucketSeconds
    expect(b[5]).toBe(30)
    expect(b[6]).toBe(30)
  })
})

describe('measureFor', () => {
  const facts = courseFactsFromSpans(
    new Map([['a', session([span(NOW - DAY, 600, 'cym')])], ['b', session([span(NOW - DAY, 1200, 'cym', 'listening')])]]),
    [{ learner_id: 'c', course_id: 'cym', enrolled_at: null }, { learner_id: 'd', course_id: 'cym', enrolled_at: new Date(NOW - DAY).toISOString() }],
    REAL, SINCE, NOW, 7, 1,
  ).get('cym')!

  it('minutes per person divides the course\'s minutes by every course-person, silent ones included', () => {
    // 1800 s = 30 min over four people
    expect(measureFor('minutes_per_person', facts)).toMatchObject({ value: 7.5 })
    expect(measureFor('minutes_per_person', facts).trend).toHaveLength(7)
  })
  it('new enrolments and the no-activity share', () => {
    expect(measureFor('new_enrolments', facts).value).toBe(1)
    expect(measureFor('no_activity', facts).value).toBe(50)
  })
  it('a course with nobody on it reads 0, never NaN', () => {
    const empty = { code: 'x', people: new Set<string>(), activePeople: new Set<string>(), seconds: 0, mainSeconds: 0, listeningSeconds: 0, bucketSeconds: [0], bucketActive: [new Set<string>()], newEnrolments: 0, bucketEnrolments: [0] }
    expect(measureFor('minutes_per_person', empty).value).toBe(0)
    expect(measureFor('no_activity', empty).value).toBe(0)
  })
})

describe('the contract', () => {
  it('offers the windows Tom named and the three measures, the minutes one first', () => {
    expect(WINDOWS.map((w) => w.value)).toEqual(['today', '7d', '30d'])
    expect(MEASURES.map((m) => m.value)).toEqual(['minutes_per_person', 'new_enrolments', 'no_activity'])
  })
})
