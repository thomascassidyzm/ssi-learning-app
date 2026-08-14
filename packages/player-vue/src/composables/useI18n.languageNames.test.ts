/**
 * Language names must not depend on the device's ICU data.
 *
 * Jonathan, testing staging in Welsh (2026-08-07), saw the course subtitle
 * render "Islandeg i siaradwyr English" — a Welsh sentence frame around an
 * English language name. Intl.DisplayNames answers in English when it has no
 * data for the interface language, and does so silently, so the curated Welsh
 * name in cym.json was never reached. These tests pin the order: our JSON
 * first, Intl only for what the JSON doesn't carry.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { getLanguageName, setLocale } from './useI18n'

const IntlAny = Intl as unknown as { DisplayNames: unknown }
const realDisplayNames = IntlAny.DisplayNames

const stubDisplayNames = (of: (code: string) => string | undefined) => {
  IntlAny.DisplayNames = class {
    of(code: string) { return of(code) }
  }
}

// A device whose ICU has no Welsh display names: it answers in English for
// everything, which is exactly the failure that reached a real tester.
function englishOnlyICU() {
  const NAMES: Record<string, string> = { en: 'English', is: 'Icelandic', cy: 'Welsh', es: 'Spanish' }
  stubDisplayNames((code) => NAMES[code] || code)
}

function noICU() {
  IntlAny.DisplayNames = class {
    constructor() { throw new Error('no display-name data') }
  }
}

describe('getLanguageName', () => {
  beforeEach(async () => {
    await setLocale('cym')
  })

  afterEach(async () => {
    IntlAny.DisplayNames = realDisplayNames
    await setLocale('eng')
  })

  it('uses the curated Welsh name even when the device ICU only knows English', () => {
    englishOnlyICU()
    expect(getLanguageName('eng')).toBe('Saesneg')
    expect(getLanguageName('isl')).toBe('Islandeg')
  })

  it('gives the same Welsh names when Intl.DisplayNames is unavailable entirely', () => {
    noICU()
    expect(getLanguageName('eng')).toBe('Saesneg')
    expect(getLanguageName('isl')).toBe('Islandeg')
  })

  it('keeps the dialect suffix that the JSON authors into the name', () => {
    englishOnlyICU()
    expect(getLanguageName('cym_n')).toBe('Cymraeg (Gogledd)')
  })

  it('falls through to Intl for a language the locale JSON does not carry', () => {
    // 'nep' is absent from cym.json's languages block.
    stubDisplayNames((code) => (code === 'nep' ? 'Nepaleg' : code))
    expect(getLanguageName('nep')).toBe('Nepaleg')
  })

  it('calls a language what the people building it call it, not what ICU does', async () => {
    // ICU says "Pennsylvania German", "Hakka Chinese", "Min Nan Chinese". The
    // course teams — and the course-builder dashboard, which mirrors these
    // names — say Pennsylvania Dutch, Hakka, Taiwanese Hokkien. A learner and
    // a course-builder must not read two different words for one language.
    await setLocale('eng')
    stubDisplayNames((code) => ({ pdc: 'Pennsylvania German', hak: 'Hakka Chinese', nan: 'Min Nan Chinese' })[code] || code)
    expect(getLanguageName('pdc')).toBe('Pennsylvania Dutch')
    expect(getLanguageName('hak')).toBe('Hakka')
    expect(getLanguageName('nan')).toBe('Taiwanese Hokkien')
  })

  it('returns an empty string for a missing code rather than throwing', () => {
    expect(getLanguageName(null)).toBe('')
    expect(getLanguageName(undefined)).toBe('')
  })

  it('renders in English once the interface is English again', async () => {
    await setLocale('eng')
    englishOnlyICU()
    expect(getLanguageName('isl')).toBe('Icelandic')
  })
})
