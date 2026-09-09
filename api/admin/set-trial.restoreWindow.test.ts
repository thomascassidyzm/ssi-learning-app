/**
 * The restore window is the one that account KIND actually gets — never a
 * hard-coded 30 (founder report 2026-09-09: restoring a Welsh school's
 * 365-day trial would have handed it 30 days and rewritten its clock).
 */
import { describe, it, expect } from 'vitest'
import { schoolRestoreDays, entitlementRestoreDays } from './set-trial'

describe('schoolRestoreDays', () => {
  it('restores a Welsh (heritage) school to a full year', () => {
    expect(schoolRestoreDays({ trial_course_code: 'cym_s_for_eng', trial_kind: 'free_1yr' })).toBe(365)
  })

  it('restores a Big-10 (commercial) school to the standard month', () => {
    expect(schoolRestoreDays({ trial_course_code: 'spa_mx_for_eng', trial_kind: 'premium_1mo' })).toBe(30)
  })

  it('falls back to the recorded trial_kind when no course was ever named', () => {
    expect(schoolRestoreDays({ trial_course_code: null, trial_kind: 'premium_1mo' })).toBe(30)
  })

  it('defaults a course-less school to the generous window, as creation does', () => {
    expect(schoolRestoreDays({ trial_course_code: null, trial_kind: null })).toBe(365)
  })
})

describe('entitlementRestoreDays', () => {
  it('restores a heritage play-trial to a year and a commercial one to a month', () => {
    expect(entitlementRestoreDays(['cym_s_for_eng'])).toBe(365)
    expect(entitlementRestoreDays(['fra_for_eng'])).toBe(30)
  })

  it('falls back to the standard month for an unresolvable grant', () => {
    expect(entitlementRestoreDays(null)).toBe(30)
    expect(entitlementRestoreDays([])).toBe(30)
  })
})
