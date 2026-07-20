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

describe('isYearTrialCourse — the 365-day HERITAGE set (non-commercial: !isCommercialCourse)', () => {
  it('includes free and community minority-language tiers', () => {
    expect(isYearTrialCourse(course({ target_lang: 'gle', course_code: 'gle_for_eng', pricing_tier: 'free' }))).toBe(true)
    expect(isYearTrialCourse(course({ target_lang: 'cat', course_code: 'cat_for_eng', pricing_tier: 'community' }))).toBe(true)
  })

  it('includes Welsh despite its premium tier (the heritage flagship, both variants)', () => {
    expect(isYearTrialCourse(course({ target_lang: 'cym', course_code: 'cym_n_for_eng', pricing_tier: 'premium' }))).toBe(true)
    expect(isYearTrialCourse(course({ target_lang: 'cym', course_code: 'cym_s_for_eng', pricing_tier: 'premium' }))).toBe(true)
  })

  it('excludes every commercial (Big-10 target) course', () => {
    expect(isYearTrialCourse(course({ target_lang: 'spa', course_code: 'spa_for_eng' }))).toBe(false)
    expect(isYearTrialCourse(course({ target_lang: 'eng', course_code: 'eng_for_fra' }))).toBe(false)
  })

  it('classifies by TARGET, not tier: Welsh (heritage) diverges from its premium tier', () => {
    const welsh = course({ target_lang: 'cym', course_code: 'cym_s_for_eng', pricing_tier: 'premium' })
    expect(isYearTrialCourse(welsh)).toBe(true)
    expect(isFreeTier(welsh)).toBe(false)
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
