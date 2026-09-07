import { describe, it, expect } from 'vitest'
import { preselectedCourseCode } from './setupCoursePreselect'

const CATALOGUE = [
  { course_code: 'cym_s_for_eng' },
  { course_code: 'spa_for_eng' },
  { course_code: 'fra_for_eng' },
]

describe('setup wizard preselects the language chosen at sign-up', () => {
  it('returns the signup course when the school can still use it', () => {
    expect(preselectedCourseCode('cym_s_for_eng', CATALOGUE)).toBe('cym_s_for_eng')
  })

  it('a trial-locked school with its one course still gets it preselected', () => {
    expect(preselectedCourseCode('spa_for_eng', [{ course_code: 'spa_for_eng' }])).toBe('spa_for_eng')
  })

  it('no stored signup choice — invite-born school — leaves the picker open', () => {
    expect(preselectedCourseCode(null, CATALOGUE)).toBeNull()
    expect(preselectedCourseCode(undefined, CATALOGUE)).toBeNull()
  })

  it('never preselects a course the school cannot pick', () => {
    expect(preselectedCourseCode('nld_for_eng', CATALOGUE)).toBeNull()
  })

  it('empty option list preselects nothing', () => {
    expect(preselectedCourseCode('spa_for_eng', [])).toBeNull()
  })
})
