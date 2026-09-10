import { describe, it, expect } from 'vitest'
import {
  trialDaysFor,
  ORG_TRIAL_DAYS,
  TUTOR_TRIAL_DAYS,
  SCHOOL_PREMIUM_TRIAL_DAYS,
  SCHOOL_HERITAGE_TRIAL_DAYS,
} from './trialPolicy'

/**
 * Founder ruling 2026-09-10, verbatim: "NO - schools are 30 days for premium
 * languages apart from Welsh. Welsh and all free languages are 365 day trials
 * for all educational institutions".
 *
 * "All educational institutions" is the phrase that changed the code: an ORG
 * is one too, so the language decides its window exactly as it decides a
 * school's. The 2026-08-02 flat 30-day all-language org window is superseded.
 */
describe('trialPolicy — the 2026-09-10 ruling', () => {
  it('gives an ORG on Welsh or any free language the year, not 30 days', () => {
    expect(trialDaysFor('org', true)).toBe(365)
  })

  it('keeps an ORG on a premium language at 30 days', () => {
    expect(trialDaysFor('org', false)).toBe(30)
  })

  it('leaves the school split exactly as it was', () => {
    expect(trialDaysFor('school', true)).toBe(SCHOOL_HERITAGE_TRIAL_DAYS)
    expect(trialDaysFor('school', false)).toBe(SCHOOL_PREMIUM_TRIAL_DAYS)
    expect(SCHOOL_HERITAGE_TRIAL_DAYS).toBe(365)
    expect(SCHOOL_PREMIUM_TRIAL_DAYS).toBe(30)
  })

  it('opens a course-less org on the generous window', () => {
    expect(ORG_TRIAL_DAYS).toBe(365)
  })

  it('leaves a solo tutor at 30 days — a tutor is not an educational institution', () => {
    expect(TUTOR_TRIAL_DAYS).toBe(30)
  })
})
