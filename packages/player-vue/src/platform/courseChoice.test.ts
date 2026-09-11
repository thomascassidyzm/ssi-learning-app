import { describe, it, expect, beforeEach } from 'vitest'
import {
  LAST_COURSE_KEY,
  LAST_COURSE_ORIGIN_KEY,
  rememberCourse,
  readRememberedCourse,
  rememberedCourseWasAutoAssigned,
} from './courseChoice'

describe('courseChoice — an assigned default is not a choice', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('records a learner choice and an auto-assigned default DISTINGUISHABLY', () => {
    rememberCourse('cym_s_for_eng', 'chosen')
    expect(readRememberedCourse()).toEqual({ code: 'cym_s_for_eng', origin: 'chosen' })
    expect(rememberedCourseWasAutoAssigned()).toBe(false)

    // The bug this exists for: before the origin key, this second write was
    // byte-identical to the first and the two could never be told apart again.
    rememberCourse('zho_for_eng', 'default')
    expect(readRememberedCourse()).toEqual({ code: 'zho_for_eng', origin: 'default' })
    expect(rememberedCourseWasAutoAssigned()).toBe(true)
  })

  it('still writes the course code itself, so every existing reader is untouched', () => {
    rememberCourse('zho_for_eng', 'default')
    expect(localStorage.getItem(LAST_COURSE_KEY)).toBe('zho_for_eng')
    expect(localStorage.getItem(LAST_COURSE_ORIGIN_KEY)).toBe('default')
  })

  it('reads a pre-existing value with no origin as unknown, never as a default', () => {
    // What a browser that last ran the old code is holding right now.
    localStorage.setItem(LAST_COURSE_KEY, 'spa_for_eng')
    expect(readRememberedCourse()).toEqual({ code: 'spa_for_eng', origin: null })
    // Unknown must behave as `chosen` did — we cannot retroactively demote it.
    expect(rememberedCourseWasAutoAssigned()).toBe(false)
  })

  it('ignores a junk origin value rather than trusting it', () => {
    localStorage.setItem(LAST_COURSE_KEY, 'spa_for_eng')
    localStorage.setItem(LAST_COURSE_ORIGIN_KEY, 'nonsense')
    expect(readRememberedCourse().origin).toBeNull()
  })

  it('is a no-op for an empty course code, and never throws with no storage', () => {
    rememberCourse('', 'chosen')
    rememberCourse(null, 'default')
    expect(readRememberedCourse()).toEqual({ code: null, origin: null })
  })
})
