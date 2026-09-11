/**
 * diarySessionRows — whole-class play from the diary as rate-compare rows.
 * Pins the block rule (idle cutoff splits, cap bounds), the LEGO start/end by
 * course ordinal, the course fallback, and that a learner id that is not a
 * class account is ignored.
 */
import { describe, it, expect } from 'vitest'
import { sessionRowsFromDiary, type DiaryEvent, type LegoOrdinals } from './diarySessionRows'

const T0 = Date.parse('2026-09-08T09:00:00Z')
const at = (s: number) => new Date(T0 + s * 1000).toISOString()
const ev = (learner: string, s: number, lego: string | null, course: string | null = 'cym_s_for_eng'): DiaryEvent =>
  ({ learner_id: learner, occurred_at: at(s), course_code: course, lego })

const ORD: LegoOrdinals = new Map([
  ['cym_s_for_eng', new Map([['S0001L01', 1], ['S0001L02', 2], ['S0002L01', 3], ['S0002L02', 4], ['S0003L01', 5]])],
])
const CLASSES = [
  { id: 'c-7p', course_code: 'cym_s_for_eng', class_learner_id: 'L-7p' },
  { id: 'c-none', course_code: 'cym_s_for_eng', class_learner_id: null },
]

describe('sessionRowsFromDiary', () => {
  it('one lesson = one row: first LEGO to furthest LEGO, timed first clip to last clip', () => {
    const rows = sessionRowsFromDiary([
      ev('L-7p', 0, null),           // cold_start carries no lego
      ev('L-7p', 10, 'S0001L01'),
      ev('L-7p', 40, 'S0001L02'),
      ev('L-7p', 90, 'S0002L01'),
      ev('L-7p', 100, 'S0001L01'),   // a review clip does not pull the end back
    ], CLASSES, ORD)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      class_id: 'c-7p', course_code: 'cym_s_for_eng',
      start_lego_id: 'S0001L01', start_ord: 1, end_lego_id: 'S0002L01', end_ord: 3,
      duration_seconds: 100, started_at: at(0),
    })
  })

  it('a silence longer than the idle cutoff ends the block; the gap is not counted', () => {
    const rows = sessionRowsFromDiary([
      ev('L-7p', 0, 'S0001L01'), ev('L-7p', 60, 'S0001L02'),
      ev('L-7p', 60 + 301, 'S0002L02'), ev('L-7p', 60 + 301 + 30, 'S0003L01'),
    ], CLASSES, ORD)
    expect(rows.map((r) => [r.duration_seconds, r.start_ord, r.end_ord])).toEqual([[60, 1, 2], [30, 4, 5]])
  })

  it('a block whose clips name no course falls back to the class course; unknown LEGOs carry no ordinal', () => {
    const rows = sessionRowsFromDiary([ev('L-7p', 0, 'S9999L01', null), ev('L-7p', 5, null, null)], CLASSES, ORD)
    expect(rows[0]).toMatchObject({ course_code: 'cym_s_for_eng', start_lego_id: 'S9999L01', start_ord: null, end_ord: null, duration_seconds: 5 })
  })

  it('ignores events from learner ids that are not a class account', () => {
    expect(sessionRowsFromDiary([ev('L-someone', 0, 'S0001L01')], CLASSES, ORD)).toEqual([])
  })
})
