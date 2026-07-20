import { describe, it, expect } from 'vitest'
import { courseDisplayName, languageName } from './displayName'

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
})
