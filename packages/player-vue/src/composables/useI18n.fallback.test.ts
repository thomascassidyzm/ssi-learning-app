/**
 * t() must never put a blank, a raw key, or `[object Object]` on screen.
 *
 * The parity test (useI18n.localeParity.test.ts) stops locale files drifting
 * apart in the first place; this one pins what happens when they have. Two of
 * these cases used to reach the UI: a key whose translation is an empty string
 * rendered as a bald gap, and a key whose locale value is an object where
 * English has a string (a nesting drift) returned the raw dot-path — in both
 * cases WITHOUT trying the English text that was sitting right there.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import eng from '../locales/eng.json'

// A stand-in locale with the two shapes that used to defeat the fallback:
// a blank translation and an object where English has a string.
vi.mock('../locales/lit.json', () => ({
  default: {
    app: { name: 'SaySomethingin' },
    courseSelector: { forSpeakers: '' },
    settings: { terms: { nested: 'drifted' } },
  },
}))

const { t, setLocale } = await import('./useI18n')

describe('t() fallback', () => {
  afterEach(async () => {
    await setLocale('eng')
  })

  it('uses the current locale string when it has one', async () => {
    await setLocale('cym')
    expect(t('courseSelector.forSpeakers')).toBe('i siaradwyr {lang}')
  })

  it('falls back to English for a key the locale is missing', async () => {
    // Deliberately asserted against the stand-in locale, not a real one: as of the
    // 2026-08-26 localisation batch every real locale carries every English key, and
    // the parity test keeps it that way — so there is no genuine gap left to point at.
    // Pinning this to a real file's shortfall would mean the test only passes while a
    // locale is broken, and goes red the moment someone fixes it.
    await setLocale('lit')
    expect(t('settings.privacy')).toBe(eng.settings.privacy)
  })

  it('falls back to English for a blank translation rather than rendering a gap', async () => {
    await setLocale('lit')
    expect(t('courseSelector.forSpeakers')).toBe(eng.courseSelector.forSpeakers)
  })

  it('falls back to English when the locale nests where English does not', async () => {
    await setLocale('lit')
    expect(t('settings.terms')).toBe(eng.settings.terms)
  })

  it('returns the caller fallback for a key English does not have either', () => {
    expect(t('nope.not.a.key', 'Fallback copy')).toBe('Fallback copy')
  })

  it('returns the key itself when there is no fallback at all', () => {
    expect(t('nope.not.a.key')).toBe('nope.not.a.key')
  })

  it('never returns an object for a branch node', () => {
    expect(t('settings')).toBe('settings')
    expect(t('settings', 'Settings')).toBe('Settings')
  })

  it('does not walk off the end of a path that bottoms out early', () => {
    // `app.name` is a string, so `app.name.deeper` cannot resolve anywhere.
    expect(t('app.name.deeper', 'Safe')).toBe('Safe')
  })
})
