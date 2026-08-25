import { describe, it, expect } from 'vitest'
import { courseTargetName, isVariantCourseCode, stripSourceSuffix } from './courseDisplayName'

// Rows below are the LIVE shapes, read from the courses table 2026-08-25 —
// note every variant carries the BASE target_lang, which is exactly why the
// player used to say "German" to an Austrian German learner.
const AUSTRIAN = {
  course_code: 'deu_at_for_eng',
  target_lang: 'deu',
  variant_label: null,
  display_name: 'Austrian German for English Speakers',
  learner_display_name: null,
}
const BRAZILIAN = {
  course_code: 'por_br_for_eng',
  target_lang: 'por',
  variant_label: null,
  display_name: 'Brazilian Portuguese for English Speakers',
  learner_display_name: null,
}
const NORTH_WELSH = {
  course_code: 'cym_n_for_eng',
  target_lang: 'cym',
  variant_label: 'Northern',
  display_name: 'North Welsh for English Speakers',
  learner_display_name: null,
}
const PLAIN_GERMAN = {
  course_code: 'deu_for_eng',
  target_lang: 'deu',
  variant_label: null,
  display_name: 'German for English Speakers',
  learner_display_name: null,
}

describe('courseTargetName — a variant course names its variant', () => {
  it('names the variant from the authored title when there is no variant_label', () => {
    expect(courseTargetName(AUSTRIAN)).toBe('Austrian German')
    expect(courseTargetName(BRAZILIAN)).toBe('Brazilian Portuguese')
    expect(courseTargetName({
      course_code: 'spa_mx_for_eng', target_lang: 'spa', variant_label: null,
      display_name: 'Mexican Spanish for English Speakers', learner_display_name: null,
    })).toBe('Mexican Spanish')
    expect(courseTargetName({
      course_code: 'ara_eg_for_eng', target_lang: 'ara', variant_label: null,
      display_name: 'Egyptian Arabic for English Speakers', learner_display_name: null,
    })).toBe('Egyptian Arabic')
  })

  it('prefers variant_label, composed with the localised language name', () => {
    expect(courseTargetName(NORTH_WELSH)).toBe('Welsh (Northern)')
  })

  it('leaves a non-variant course exactly as it was', () => {
    expect(courseTargetName(PLAIN_GERMAN)).toBe('German')
    expect(courseTargetName({
      course_code: 'ara_for_eng', target_lang: 'ara', variant_label: null,
      display_name: 'Modern Standard Arabic for English Speakers', learner_display_name: null,
    })).toBe('Arabic')
  })

  it('prefers the learner-language title over the English one', () => {
    expect(courseTargetName({
      course_code: 'por_br_for_jpn', target_lang: 'por', variant_label: null,
      display_name: 'ポルトガル語（ブラジル） — 日本語話者向け',
      learner_display_name: 'ポルトガル語（ブラジル） — 日本語話者向け',
    })).toBe('ポルトガル語（ブラジル）')
  })

  it('never throws or blanks on a half-resolved course', () => {
    expect(courseTargetName(null)).toBe('')
    expect(courseTargetName({})).toBe('')
    // No target_lang (a class pointing at an unresolvable code) — fall back
    // to the code prefix rather than rendering nothing.
    expect(courseTargetName({ course_code: 'deu_for_eng' })).toBe('German')
    // Variant code, no authored title yet: the base name, not a blank.
    expect(courseTargetName({ course_code: 'deu_at_for_eng', target_lang: 'deu' })).toBe('German')
  })
})

describe('isVariantCourseCode', () => {
  it('spots the <lang>_<variant>_for_<known> shape only', () => {
    expect(isVariantCourseCode('deu_at_for_eng')).toBe(true)
    expect(isVariantCourseCode('cym_nnew_for_eng')).toBe(true)
    expect(isVariantCourseCode('deu_for_eng')).toBe(false)
    expect(isVariantCourseCode('eng_for_ara')).toBe(false)
    expect(isVariantCourseCode('')).toBe(false)
    expect(isVariantCourseCode(null)).toBe(false)
  })
})

describe('stripSourceSuffix', () => {
  it('drops the source tail in each authored shape', () => {
    expect(stripSourceSuffix('Austrian German for English Speakers')).toBe('Austrian German')
    expect(stripSourceSuffix('Catalán para hispanohablantes')).toBe('Catalán')
    expect(stripSourceSuffix('Breton pour francophones')).toBe('Breton')
    expect(stripSourceSuffix('德语（奥地利） — 面向中文使用者')).toBe('德语（奥地利）')
  })

  it('returns the original when there is nothing to strip', () => {
    expect(stripSourceSuffix('North Welsh')).toBe('North Welsh')
    expect(stripSourceSuffix('')).toBe('')
  })
})
