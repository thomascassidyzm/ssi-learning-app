/**
 * teacherLanding (job #662, Tom 13:03Z: "teacher accounts open with the
 * dashboard and not the player"). Red before the rule existed; pins that it
 * fires for a teacher's cold open of the bare player only.
 */
import { describe, it, expect } from 'vitest'
import { teacherLandingTarget } from './teacherLanding'

const cold = { isFirstNavigation: true, path: '/', queryKeys: 0 }

describe('teacherLandingTarget', () => {
  it('a teacher opening the app on the bare player lands on the teacher home', () => {
    expect(teacherLandingTarget({ role: 'teacher', ...cold })).toBe('/schools')
  })
  it('an in-app tap to the player (Learn / My player) is never redirected — own play stays one step away', () => {
    expect(teacherLandingTarget({ role: 'teacher', ...cold, isFirstNavigation: false })).toBeNull()
  })
  it('a deep link with a query keeps its intention', () => {
    expect(teacherLandingTarget({ role: 'teacher', ...cold, queryKeys: 1 })).toBeNull()
  })
  it('learners, school admins, group leaders, tutors and unknown roles are not in the ruling', () => {
    for (const role of [null, undefined, 'student', 'school_admin', 'govt_admin', 'tutor']) {
      expect(teacherLandingTarget({ role, ...cold })).toBeNull()
    }
  })
  it('any other path is untouched', () => {
    expect(teacherLandingTarget({ role: 'teacher', ...cold, path: '/schools' })).toBeNull()
  })
})
