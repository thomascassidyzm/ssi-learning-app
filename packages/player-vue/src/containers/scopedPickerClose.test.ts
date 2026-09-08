/**
 * Closing the Canolfan picker without choosing.
 *
 * FAILURE MODE (staging, 2026-09-08): Kai enrolled through a Canolfan link,
 * the picker opened on North and South Welsh, he closed it — and the app
 * behind it was Chinese, App.vue's default for a visitor with no saved course.
 */
import { describe, it, expect } from 'vitest'
import { courseToFallBackTo } from './scopedPickerClose'

const WELSH = ['cym_n_for_eng', 'cym_s_for_eng']

describe('courseToFallBackTo', () => {
  it('FAILURE MODE: a scoped picker closed over the Chinese default lands in the first granted course', () => {
    expect(courseToFallBackTo(WELSH, 'zho_for_eng')).toBe('cym_n_for_eng')
  })

  it('leaves a learner already in a granted course where they are', () => {
    expect(courseToFallBackTo(WELSH, 'cym_s_for_eng')).toBeNull()
  })

  it('falls back for a visitor with no active course at all', () => {
    expect(courseToFallBackTo(WELSH, null)).toBe('cym_n_for_eng')
  })

  it('changes nothing when the picker was not scoped', () => {
    expect(courseToFallBackTo([], 'zho_for_eng')).toBeNull()
    expect(courseToFallBackTo(undefined, 'zho_for_eng')).toBeNull()
  })
})
