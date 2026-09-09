import { describe, it, expect } from 'vitest'
import { isFreeTier, isYearTrialCourse, targetLabel, type LiveCourse } from './onboardingTracks'

function course(partial: Partial<LiveCourse>): LiveCourse {
  return {
    course_code: 'xxx_for_eng',
    target_lang: 'xxx',
    known_lang: 'eng',
    pricing_tier: 'premium',
    display_name: null,
    learner_display_name: null,
    ...partial,
  }
}

describe('isYearTrialCourse — the 365-day school-offer set (mirrors provision.ts isWelsh || isFree)', () => {
  it('includes free and community tiers', () => {
    expect(isYearTrialCourse(course({ pricing_tier: 'free' }))).toBe(true)
    expect(isYearTrialCourse(course({ pricing_tier: 'community' }))).toBe(true)
  })

  it('includes Welsh despite its premium tier (the heritage anomaly, both variants)', () => {
    expect(isYearTrialCourse(course({ course_code: 'cym_n_for_eng', pricing_tier: 'premium' }))).toBe(true)
    expect(isYearTrialCourse(course({ course_code: 'cym_s_for_eng', pricing_tier: 'premium' }))).toBe(true)
  })

  it('excludes every other premium course', () => {
    expect(isYearTrialCourse(course({ course_code: 'spa_for_eng' }))).toBe(false)
    expect(isYearTrialCourse(course({ course_code: 'eng_for_fra' }))).toBe(false)
  })

  it('agrees with isFreeTier for non-Welsh courses', () => {
    const c = course({ pricing_tier: 'community' })
    expect(isYearTrialCourse(c)).toBe(isFreeTier(c))
  })
})

describe('targetLabel — strips the source-language suffix, keeps variants', () => {
  it('strips "for X Speakers" / "para …" / "pour …"', () => {
    expect(targetLabel(course({ display_name: 'Spanish for English Speakers' }))).toBe('Spanish')
    expect(targetLabel(course({ display_name: 'Catalán para hispanohablantes' }))).toBe('Catalán')
    expect(targetLabel(course({ display_name: 'Breton pour francophones' }))).toBe('Breton')
  })

  it('preserves dialect/region variants', () => {
    expect(targetLabel(course({ display_name: 'North Welsh for English Speakers' }))).toBe('North Welsh')
  })
})
