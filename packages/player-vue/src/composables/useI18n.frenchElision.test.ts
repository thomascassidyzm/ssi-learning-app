/**
 * French elision in the course subtitle.
 *
 * The French frame is "pour les locuteurs de {lang}", and French does not
 * write "de Anglais" — the vowel forces "d'Anglais". Which names elide is
 * decided by the name that lands in the slot at runtime, so the template
 * cannot carry it and the composition helper has to.
 *
 * The h cases are the ones worth pinning: h muet elides ("l'hébreu"), h
 * aspiré does not ("le hongrois"), and the spelling says nothing about
 * which — so the list is the specification.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { forSpeakersLabel, interpolateLanguageName, setLocale } from './useI18n'

describe('forSpeakersLabel — French', () => {
  beforeEach(async () => {
    await setLocale('fra')
  })

  afterEach(async () => {
    await setLocale('eng')
  })

  it('elides de before a vowel-initial language name', () => {
    expect(forSpeakersLabel('eng')).toBe("pour les locuteurs d'Anglais")
    expect(forSpeakersLabel('ita')).toBe("pour les locuteurs d'Italien")
    expect(forSpeakersLabel('spa')).toBe("pour les locuteurs d'Espagnol")
  })

  it('elides before every vowel-initial name the course catalogue can name', () => {
    for (const code of ['sqi', 'deu', 'amh', 'ara', 'hye', 'aze', 'est', 'ind', 'gle', 'isl', 'urd', 'ukr']) {
      expect(forSpeakersLabel(code)).toMatch(/^pour les locuteurs d'/)
    }
  })

  it('keeps de before a consonant-initial name', () => {
    expect(forSpeakersLabel('fra')).toBe('pour les locuteurs de Français')
    expect(forSpeakersLabel('cym')).toBe('pour les locuteurs de Gallois')
    expect(forSpeakersLabel('por')).toBe('pour les locuteurs de Portugais')
  })

  it('elides before h muet but not before h aspiré', () => {
    expect(forSpeakersLabel('heb')).toBe("pour les locuteurs d'Hébreu")
    expect(forSpeakersLabel('hin')).toBe("pour les locuteurs d'Hindi")
    expect(forSpeakersLabel('hun')).toBe('pour les locuteurs de Hongrois')
    expect(forSpeakersLabel('hau')).toBe('pour les locuteurs de Haoussa')
  })

  it('elides le, la and que the same way, for any frame that uses them', () => {
    expect(interpolateLanguageName('le {lang} vit', 'eng', 'Anglais')).toBe("l'Anglais vit")
    expect(interpolateLanguageName('la {lang}', 'eng', 'Anglais')).toBe("l'Anglais")
    expect(interpolateLanguageName('que {lang}', 'eng', 'Anglais')).toBe("qu'Anglais")
    expect(interpolateLanguageName('le {lang} vit', 'fra', 'Français')).toBe('le Français vit')
  })

  it('leaves a word merely ending in an elidable one alone', () => {
    expect(interpolateLanguageName('monde {lang}', 'eng', 'Anglais')).toBe('monde Anglais')
  })

  it('returns an empty string for a course with no known language', () => {
    expect(forSpeakersLabel(null)).toBe('')
    expect(forSpeakersLabel(undefined)).toBe('')
    expect(forSpeakersLabel('')).toBe('')
  })
})

describe('forSpeakersLabel — other interfaces are untouched', () => {
  afterEach(async () => {
    await setLocale('eng')
  })

  it('never elides in Spanish or Portuguese, which write de before a vowel', async () => {
    await setLocale('spa')
    expect(forSpeakersLabel('eng')).toBe('para hablantes de Inglés')
    await setLocale('por')
    expect(forSpeakersLabel('ita')).toBe('para falantes de Italiano')
  })

  it('leaves the Italian frame as authored', async () => {
    await setLocale('ita')
    expect(forSpeakersLabel('eng')).toBe('per parlanti di Inglese')
  })

  it('composes English without a preposition at all', async () => {
    await setLocale('eng')
    expect(forSpeakersLabel('eng')).toBe('for English speakers')
  })
})
