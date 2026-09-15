/**
 * /api/intel/minutes — the measures behind Intelligence at Everyone scope,
 * pinned on the pure pieces: per-course facts from spans + enrolments, and
 * the three measures over them (job #609, Tom's ruling 2026-09-13).
 */
import { describe, it, expect } from 'vitest'
import { courseFactsFromSpans, measureFor, averageOfAllCourses, pooledFacts, WINDOWS, MEASURES, type CourseFacts } from './minutes'
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
  it('total minutes is the course\'s minutes in the window, whoever did them', () => {
    expect(measureFor('minutes_total', facts)).toMatchObject({ value: 30 })
    expect(measureFor('minutes_total', facts).trend).toHaveLength(7)
  })
  it('new enrolments and the no-activity share', () => {
    expect(measureFor('new_enrolments', facts).value).toBe(1)
    expect(measureFor('no_activity', facts).value).toBe(50)
  })
  it('a course with nobody on it reads 0, never NaN', () => {
    const empty = { code: 'x', people: new Set<string>(), activePeople: new Set<string>(), seconds: 0, mainSeconds: 0, listeningSeconds: 0, bucketSeconds: [0], bucketActive: [new Set<string>()], newEnrolments: 0, bucketEnrolments: [0], spans: 0, bucketSpans: [0], bucketListeningSeconds: [0] }
    expect(measureFor('minutes_per_person', empty).value).toBe(0)
    expect(measureFor('no_activity', empty).value).toBe(0)
  })
})

describe('averageOfAllCourses — the comparator (Tom, 2026-09-14)', () => {
  const course = (code: string, people: string[], active: string[], seconds: number, newEnrolments = 0): CourseFacts => ({
    code, people: new Set(people), activePeople: new Set(active), seconds, mainSeconds: seconds, listeningSeconds: 0,
    bucketSeconds: [seconds, 0], bucketActive: [new Set(active), new Set()], newEnrolments, bucketEnrolments: [newEnrolments, 0],
    spans: active.length, bucketSpans: [active.length, 0], bucketListeningSeconds: [0, 0],
  })
  // A busy course, a middling one, and a dead course with two enrolments.
  const busy = course('cym', ['a', 'b'], ['a', 'b'], 2 * 60 * 60, 2)   // 120 min over 2 people = 60/person
  const mid = course('spa', ['c', 'd', 'e', 'f'], ['c'], 40 * 60, 1)   // 40 min over 4 people = 10/person
  const dead = course('zho', ['g', 'h'], [], 0)                          // 0 over 2 people
  const all = [busy, mid, dead]

  it('is one fixed number for the window and the measure, whichever course is selected', () => {
    for (const m of MEASURES) {
      const a = averageOfAllCourses(m.value, [busy, mid, dead])
      const b = averageOfAllCourses(m.value, [dead, busy, mid])
      expect(a.value).toBe(b.value)
      expect(a.trend).toEqual(b.trend)
    }
  })
  it('includes the selected course — never the leave-one-out average #609 shipped', () => {
    const withAll = averageOfAllCourses('minutes_per_person', all).value
    const leaveOneOut = averageOfAllCourses('minutes_per_person', [mid, dead]).value
    expect(withAll).not.toBe(leaveOneOut)
  })
  it('weights ratio measures by learners: 160 min over 8 course-people is 20, not the per-course mean of 23.3', () => {
    expect(averageOfAllCourses('minutes_per_person', all).value).toBe(20)
    expect(averageOfAllCourses('minutes_per_person', all).trend).toEqual([20, 0])
    // no activity: 5 silent of 8 = 62.5%, not the per-course mean of (0 + 75 + 100) / 3
    expect(averageOfAllCourses('no_activity', all).value).toBe(62.5)
  })
  it('means count measures per course, the dead course counting as a course', () => {
    expect(averageOfAllCourses('minutes_total', all).value).toBe(round1(160 / 3))
    expect(averageOfAllCourses('new_enrolments', all).value).toBe(1)
  })
  it('pools course-people per course, so one learner on two courses is two people', () => {
    const twice = [course('cym', ['a'], ['a'], 600), course('spa', ['a'], [], 0)]
    expect(pooledFacts(twice).people.size).toBe(2)
    expect(averageOfAllCourses('minutes_per_person', twice).value).toBe(5)
  })
  it('an empty cohort reads 0, never NaN', () => {
    expect(averageOfAllCourses('minutes_per_person', []).value).toBe(0)
    expect(averageOfAllCourses('minutes_total', []).value).toBe(0)
  })
})

const round1 = (n: number) => Math.round(n * 10) / 10

describe('the contract', () => {
  it('offers the windows Tom named and the four measures, the minutes ones first', () => {
    expect(WINDOWS.map((w) => w.value)).toEqual(['today', '7d', '30d'])
    expect(MEASURES.map((m) => m.value)).toEqual(['minutes_per_person', 'minutes_total', 'new_enrolments', 'no_activity'])
  })
  it('every measure says in its description what the average of all courses is', () => {
    for (const m of MEASURES) expect(m.desc).toMatch(/average of all courses is .*this course included/)
  })
})
