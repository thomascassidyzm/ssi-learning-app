/**
 * A deep link infers the interface language; it never overrides a choice.
 *
 * The distinction those tests defend is the whole feature: an inferred value
 * is replaceable, a chosen one is not, and a legacy value with no recorded
 * source counts as chosen because the only thing that could have written it
 * was the Settings picker.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { knownLangFromCourseCode, localeForDeepLink, applyDeepLinkLocale } from './deepLinkLocale'

const LOCALE_KEY = 'ssi-locale'
const SOURCE_KEY = 'ssi-locale-source'

beforeEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('knownLangFromCourseCode', () => {
  it('reads the known language off the far side of _for_', () => {
    expect(knownLangFromCourseCode('spa_for_hin')).toBe('hin')
    expect(knownLangFromCourseCode('cym_for_eng')).toBe('eng')
  })

  it('keeps a target-side variant on the target side', () => {
    expect(knownLangFromCourseCode('deu_at_for_eng')).toBe('eng')
    expect(knownLangFromCourseCode('por_br_for_spa')).toBe('spa')
  })

  it('reads a known-side dialect code', () => {
    expect(knownLangFromCourseCode('eng_for_cym_s')).toBe('cym_s')
  })

  it('is null for anything that is not a pairing', () => {
    expect(knownLangFromCourseCode(null)).toBeNull()
    expect(knownLangFromCourseCode('')).toBeNull()
    expect(knownLangFromCourseCode('spanish')).toBeNull()
    expect(knownLangFromCourseCode('a_for_b_for_c')).toBeNull()
    expect(knownLangFromCourseCode('spa_for_')).toBeNull()
  })
})

describe('localeForDeepLink', () => {
  it('resolves a course whose known language we can render', () => {
    expect(localeForDeepLink('?course=spa_for_hin')).toBe('hin')
  })

  it('is null with no course param', () => {
    expect(localeForDeepLink('')).toBeNull()
    expect(localeForDeepLink('?round=7')).toBeNull()
  })

  // The honest no-op: we ship no Kannada, Marathi or Telugu interface, so a
  // course for those speakers stays in English rather than half-translating.
  it('is null when we have no interface for that known language', () => {
    expect(localeForDeepLink('?course=eng_for_kan')).toBeNull()
    expect(localeForDeepLink('?course=eng_for_mar')).toBeNull()
    expect(localeForDeepLink('?course=eng_for_tel')).toBeNull()
  })

  it('survives the other deep-link params riding along', () => {
    expect(localeForDeepLink('?course=spa_for_hin&round=7&lego=S0002L02')).toBe('hin')
  })
})

describe('applyDeepLinkLocale', () => {
  it('sets the language for a visitor who has never picked one', () => {
    expect(applyDeepLinkLocale('?course=spa_for_hin')).toBe('hin')
    expect(localStorage.getItem(LOCALE_KEY)).toBe('hin')
    expect(localStorage.getItem(SOURCE_KEY)).toBe('inferred')
  })

  it('leaves an explicit choice alone', () => {
    localStorage.setItem(LOCALE_KEY, 'cym')
    localStorage.setItem(SOURCE_KEY, 'chosen')
    expect(applyDeepLinkLocale('?course=spa_for_hin')).toBeNull()
    expect(localStorage.getItem(LOCALE_KEY)).toBe('cym')
  })

  // Nothing but the Settings picker could have written a locale before this
  // key existed, so a bare value is a decision and is protected.
  it('treats a legacy value with no recorded source as a choice', () => {
    localStorage.setItem(LOCALE_KEY, 'cym')
    expect(applyDeepLinkLocale('?course=spa_for_hin')).toBeNull()
    expect(localStorage.getItem(LOCALE_KEY)).toBe('cym')
  })

  it('replaces an earlier link’s guess with this link’s', () => {
    localStorage.setItem(LOCALE_KEY, 'cym')
    localStorage.setItem(SOURCE_KEY, 'inferred')
    expect(applyDeepLinkLocale('?course=spa_for_hin')).toBe('hin')
    expect(localStorage.getItem(LOCALE_KEY)).toBe('hin')
  })

  it('marks English inferred for an English-known course — still replaceable later', () => {
    expect(applyDeepLinkLocale('?course=spa_for_eng')).toBe('eng')
    expect(localStorage.getItem(LOCALE_KEY)).toBe('eng')
  })

  it('does nothing at all without a deep link', () => {
    expect(applyDeepLinkLocale('')).toBeNull()
    expect(localStorage.getItem(LOCALE_KEY)).toBeNull()
  })
})
