import { describe, it, expect } from 'vitest'
import { courseDisplayName, courseShortName, languageName } from './displayName'

describe('courseDisplayName', () => {
  it('renders target_for_known codes as "<Target> for <Known> speakers"', () => {
    expect(courseDisplayName('fra_for_eng')).toBe('French for English speakers')
    expect(courseDisplayName('eng_for_hin')).toBe('English for Hindi speakers')
    expect(courseDisplayName('spa_for_eng')).toBe('Spanish for English speakers')
    expect(courseDisplayName('cym_for_eng')).toBe('Welsh for English speakers')
  })

  it('renders a bare code as just the language', () => {
    expect(courseDisplayName('cym')).toBe('Welsh')
    expect(courseDisplayName('tam')).toBe('Tamil')
  })

  it('falls back to a Title-cased label for unknown language codes', () => {
    expect(courseDisplayName('xyz_for_eng')).toBe('Xyz for English speakers')
    expect(courseDisplayName('zzz')).toBe('Zzz')
  })

  it('is case- and whitespace-insensitive', () => {
    expect(courseDisplayName(' FRA_for_ENG ')).toBe('French for English speakers')
  })

  it('returns an empty string for empty/nullish input', () => {
    expect(courseDisplayName('')).toBe('')
    expect(courseDisplayName(null)).toBe('')
    expect(courseDisplayName(undefined)).toBe('')
  })

  it('exposes languageName for single-code lookups', () => {
    expect(languageName('deu')).toBe('German')
    expect(languageName('unknowncode')).toBe('Unknowncode')
  })

  // The founder-reported bug (2026-08-07): Insights printed the raw code
  // "Cym_s_for_eng" while the Classes page — which routes through the
  // player's own getLanguageName — correctly said "Welsh (South)".
  describe('dialect-variant codes', () => {
    it('names the variant in brackets, matching the schools UI', () => {
      expect(courseDisplayName('cym_s_for_eng')).toBe('Welsh (South) for English speakers')
      expect(courseDisplayName('cym_n_for_eng')).toBe('Welsh (North) for English speakers')
    })

    it('never leaks the raw code for a dialect course', () => {
      expect(courseDisplayName('cym_s_for_eng')).not.toContain('_')
      expect(courseDisplayName('cym_s_for_eng')).not.toBe('Cym_s_for_eng')
    })

    it('resolves a bare variant code', () => {
      expect(languageName('cym_s')).toBe('Welsh (South)')
      expect(courseDisplayName('cym_n')).toBe('Welsh (North)')
    })

    it('handles variants that are whole ISO codes', () => {
      expect(languageName('nob')).toBe('Norwegian (Bokmål)')
      expect(languageName('nno')).toBe('Norwegian (Nynorsk)')
    })

    it('does not mis-parse a multi-word code as a dialect', () => {
      expect(courseDisplayName('cym_anthem_for_jpn')).toBe('Cym_anthem_for_jpn')
    })
  })

  describe('courseShortName', () => {
    it('gives the target language alone', () => {
      expect(courseShortName('cym_s_for_eng')).toBe('Welsh (South)')
      expect(courseShortName('cym_n_for_eng')).toBe('Welsh (North)')
      expect(courseShortName('fra_for_eng')).toBe('French')
      expect(courseShortName('eng_for_hin')).toBe('English')
    })

    it('passes bare codes straight through', () => {
      expect(courseShortName('cym')).toBe('Welsh')
      expect(courseShortName('cym_s')).toBe('Welsh (South)')
    })

    it('returns an empty string for empty/nullish input', () => {
      expect(courseShortName('')).toBe('')
      expect(courseShortName(null)).toBe('')
      expect(courseShortName(undefined)).toBe('')
    })

    it('falls back rather than leaking a raw code', () => {
      expect(courseShortName('cym_anthem_for_jpn')).toBe('Cym_anthem_for_jpn')
    })
  })
})
