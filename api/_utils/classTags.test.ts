import { describe, it, expect } from 'vitest'
import { classTagsView, confirmedTag, deriveDepartment, deriveYear } from './classTags'

describe('classTags — derivable, never forced', () => {
  it('reads a year off the shapes school names actually take', () => {
    for (const [name, want] of [
      ['Year 7 Welsh', '7'], ['Yr 8', '8'], ['Grade 6A', '6'], ['8A', '8'], ['11P', '11'],
      ['Blwyddyn 9', '9'], ['Y10 French', '10'], ['Class 5 Hindi', '5'], ['Std 4', '4'],
    ] as const) expect(deriveYear(name), name).toBe(want)
  })
  it('refuses what is not a year — a room, an intake, a bare subject', () => {
    for (const name of ['Room 12', '2024 intake', 'Welsh club', 'Year 99', '', 'Grade 14 Hindi']) {
      expect(deriveYear(name), name).toBeNull()
    }
  })
  it('reads the department off the course target language', () => {
    expect(deriveDepartment('eng_for_hin')).toBe('English')
    expect(deriveDepartment('cym_s_for_eng')).toBe('Welsh')
    expect(deriveDepartment(null)).toBeNull()
  })
  it('a stored value is confirmed; a derived one is a guess; absence is absence', () => {
    const guess = classTagsView('Grade 6A', 'eng_for_hin', {})
    expect(guess.year).toEqual({ value: '6', confirmed: false, derived: '6' })
    expect(guess.department).toEqual({ value: 'English', confirmed: false, derived: 'English' })
    const fixed = classTagsView('Grade 6A', 'eng_for_hin', { year: '7' })
    expect(fixed.year).toEqual({ value: '7', confirmed: true, derived: '6' })
    expect(confirmedTag({ year: '7' }, 'year')).toBe('7')
    expect(confirmedTag({}, 'year')).toBeNull()
    expect(classTagsView('Welsh club', null, {}).year).toEqual({ value: null, confirmed: false, derived: null })
  })
})
