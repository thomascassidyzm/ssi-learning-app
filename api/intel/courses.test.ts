import { describe, it, expect } from 'vitest'
import { isFinished, rankCourses, type CourseRow } from './courses'

// Question 5's two rules, proven without a database: what "finished" means,
// and that the ranking is people practising this month, then reach.
describe('which courses are worth attention', () => {
  it('counts finishing at nine tenths of the seeds, and says nothing when the course length is unknown', () => {
    expect(isFinished(90, 100)).toBe(true)
    expect(isFinished(89, 100)).toBe(false)
    expect(isFinished(null, 100)).toBe(false)
    expect(isFinished(500, null)).toBeNull()
    expect(isFinished(500, 0)).toBeNull()
  })

  it('ranks by people practising in the last thirty days, then by reach', () => {
    const row = (course: string, practised30: number, reach: number): CourseRow =>
      ({ course, name: course, community: false, seeds: 10, reach, practised30, practised7: 0, finished: 0, stickiness: null })
    const sorted = [row('c', 1, 50), row('a', 5, 5), row('b', 1, 90)].sort(rankCourses)
    expect(sorted.map((r) => r.course)).toEqual(['a', 'b', 'c'])
  })
})
