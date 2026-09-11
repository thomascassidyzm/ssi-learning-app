/**
 * The dialect hint on an enrolment link — the one rule it must obey.
 *
 * A link may CHOOSE between the courses a funded cohort's policy grants. It
 * may never ADD one. Everything below is that sentence, tested.
 */
import { describe, it, expect } from 'vitest'
import { resolveHintedCourse } from './orgEnrolmentCourseHint'

const GRANTED = ['cym_n_for_eng', 'cym_s_for_eng']

describe('resolveHintedCourse', () => {
  it('honours a hint that names a granted course', () => {
    expect(resolveHintedCourse('cym_n_for_eng', GRANTED)).toBe('cym_n_for_eng')
    expect(resolveHintedCourse('cym_s_for_eng', GRANTED)).toBe('cym_s_for_eng')
  })

  it('drops a hint for anything the policy does not grant', () => {
    expect(resolveHintedCourse('spa_for_eng', GRANTED)).toBeNull()
    expect(resolveHintedCourse('cym_for_eng', GRANTED)).toBeNull()
  })

  it('is null for the ordinary link, which carries no hint at all', () => {
    expect(resolveHintedCourse(undefined, GRANTED)).toBeNull()
    expect(resolveHintedCourse('', GRANTED)).toBeNull()
    expect(resolveHintedCourse('  ', GRANTED)).toBeNull()
  })

  it('forgives the casing and spacing a copied link picks up', () => {
    expect(resolveHintedCourse(' CYM_N_FOR_ENG ', GRANTED)).toBe('cym_n_for_eng')
  })

  it('grants nothing when the policy grants nothing', () => {
    expect(resolveHintedCourse('cym_n_for_eng', [])).toBeNull()
    expect(resolveHintedCourse('cym_n_for_eng', null)).toBeNull()
  })
})
