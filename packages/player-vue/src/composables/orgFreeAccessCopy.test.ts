/**
 * The sentences a funded learner reads about what they have.
 *
 * Kai, 2026-09-08: suppressing the price everywhere would be dishonest — a
 * Canolfan learner browsing Spanish should be quoted the Spanish price — but
 * a bare "you need a subscription" in front of somebody promised a free year
 * reads as a contradiction. Both halves, always together.
 */
import { describe, it, expect } from 'vitest'
import {
  baseLangOfCourseCode,
  joinNames,
  languagesOfCourses,
  orgCoverLine,
  needsOwnSubscriptionLine,
} from './orgFreeAccessCopy'

const NAMES: Record<string, string> = { cym: 'Welsh', spa: 'Spanish', gle: 'Irish' }
const nameFor = (l: string) => NAMES[l] ?? l

describe('reading a course code', () => {
  it('takes the target side, not the known side', () => {
    expect(baseLangOfCourseCode('cym_n_for_eng')).toBe('cym')
    expect(baseLangOfCourseCode('eng_for_cym')).toBe('eng')
  })

  it('collapses the dialects — North and South Welsh are both Welsh', () => {
    expect(languagesOfCourses(['cym_n_for_eng', 'cym_s_for_eng'], nameFor)).toEqual(['Welsh'])
  })
})

describe('joining names in British English', () => {
  it('uses "and", and no Oxford comma', () => {
    expect(joinNames(['Welsh'])).toBe('Welsh')
    expect(joinNames(['Welsh', 'Irish'])).toBe('Welsh and Irish')
    expect(joinNames(['Welsh', 'Irish', 'Spanish'])).toBe('Welsh, Irish and Spanish')
  })
})

describe('what they have', () => {
  it('names the language, the date and the funder', () => {
    const line = orgCoverLine({
      languages: ['Welsh'],
      orgName: 'the National Centre for Learning Welsh',
      until: '8 September 2027',
    })
    expect(line).toBe('Welsh is free until 8 September 2027 through the National Centre for Learning Welsh')
  })

  it('falls back to "your group" rather than naming nobody', () => {
    expect(orgCoverLine({ languages: ['Welsh'], orgName: null, until: '8 September 2027' }))
      .toContain('through your group')
  })
})

describe('what they do not have', () => {
  it('FAILURE MODE: never a bare "you need a subscription"', () => {
    const line = needsOwnSubscriptionLine({
      languages: ['Welsh'],
      orgName: 'the National Centre for Learning Welsh',
      courseLanguage: 'Spanish',
    })
    expect(line).toBe(
      'You have free access to Welsh through the National Centre for Learning Welsh. Spanish needs its own subscription.'
    )
    // The free half is stated first, so the price never lands unexplained.
    expect(line.indexOf('free access')).toBeLessThan(line.indexOf('own subscription'))
  })

  it('says something sensible when the language has no name to hand', () => {
    expect(needsOwnSubscriptionLine({ languages: ['Welsh'], orgName: null, courseLanguage: null }))
      .toBe('You have free access to Welsh through your group. This one needs its own subscription.')
  })

  it('says nothing at all when there is no grant to explain', () => {
    expect(needsOwnSubscriptionLine({ languages: [], courseLanguage: 'Spanish' })).toBe('')
  })
})
