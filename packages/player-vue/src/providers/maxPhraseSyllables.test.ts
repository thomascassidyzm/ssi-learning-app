/**
 * The ABSOLUTE syllable cap — "we should probably just skip all phrases that
 * are more than X number of syllables" (Tom, 2026-08-07).
 *
 * It COMPOSES with the character-fraction cap (maxPhraseLengthFraction.test.ts)
 * rather than replacing it: a phrase is dropped if it exceeds EITHER. The
 * character cap remains the universal backstop, because the syllable cap can
 * only apply where a counter exists for the course's target language — 45 of
 * 99 courses. On the other 54 it must be INERT AND LOUD, never silently
 * nothing, which is precisely how the previous syllable attempt failed.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  capPhrasesByLength,
  phraseTextLength,
  normalizeMaxPhraseSyllables,
  makePhraseSyllableResolver,
  DEFAULT_EASY,
  DEFAULT_FAST,
  MIN_USE_PHRASES_AFTER_CAP,
} from '../composables/useAlgorithmConfig'

interface P { target_text: string; syl: number; target_syllable_count?: number | null }
const p = (target_text: string, syl: number): P => ({ target_text, syl })
const sylOf = (x: P) => x.syl
const lenOf = (x: P) => phraseTextLength(x.target_text)
/** The CAP's syllable measure, as distinct from the historic SORT key. */
const capSyl = (limit: number) => ({ limit, syllablesOf: (x: P) => x.syl })

afterEach(() => { vi.restoreAllMocks() })

describe('normalizeMaxPhraseSyllables', () => {
  it('degrades anything missing or invalid to UNCAPPED, never to a cap', () => {
    // Same discipline as normalizeMaxPhraseLengthFraction: a bad DB value must
    // give today's full-length script, never silently shorten the course.
    for (const bad of [undefined, null, 0, -5, NaN, Infinity, -Infinity]) {
      expect(normalizeMaxPhraseSyllables(bad as number)).toBe(Infinity)
    }
  })

  it('accepts a positive limit and floors a fractional one', () => {
    expect(normalizeMaxPhraseSyllables(20)).toBe(20)
    expect(normalizeMaxPhraseSyllables(20.7)).toBe(20)  // no phantom half-syllable
  })
})

describe('the shipped mode defaults', () => {
  it('FAST HAS NO SYLLABLE LIMIT — the provably-unchanged guarantee', () => {
    expect(normalizeMaxPhraseSyllables(DEFAULT_FAST.maxPhraseSyllables)).toBe(Infinity)
    // and its character cap is still uncapped too, so Fast has no cap at all.
    expect(DEFAULT_FAST.maxPhraseLengthFraction).toBe(1.0)
  })

  it('EASY caps at 20 syllables — the MEASURED value (see DEFAULT_EASY)', () => {
    // Measured over spa_for_eng (n=15,205) + fra_for_eng (n=14,118) with the
    // canonical counter: >20 removes 15.40% / 0.65%, mean 8.0%, the closest
    // integer to the 7.34% today's 0.5 character cap already removes.
    // If this number changes, the DB row easy_mode.maxPhraseSyllables and
    // Popty's seed must change WITH it.
    expect(DEFAULT_EASY.maxPhraseSyllables).toBe(20)
    // Easy keeps the character cap as well — the two compose.
    expect(DEFAULT_EASY.maxPhraseLengthFraction).toBe(0.5)
  })
})

describe('capPhrasesByLength — the syllable cap', () => {
  // Syllables ascend with character length so the historic sort stays visible.
  const pool = [p('aa', 1), p('aaaa', 5), p('aaaaaa', 9), p('aaaaaaaa', 21), p('aaaaaaaaaa', 30)]

  it('FAST IS BYTE-IDENTICAL: no char cap and no syllable cap = the historic sort', () => {
    const historic = [...pool].sort((a, b) => sylOf(a) - sylOf(b))
    // every shape of "no syllable cap" a caller can produce
    for (const noCap of [undefined, null, { limit: Infinity, syllablesOf: sylOf }, { limit: 0, syllablesOf: sylOf }]) {
      const out = capPhrasesByLength<P>(pool, sylOf, lenOf, Infinity, 4, noCap)
      expect(out).toEqual(historic)
    }
  })

  it('drops a phrase ABOVE the threshold and keeps one below it', () => {
    // Limit is inclusive: 21 > 20 goes, 9 <= 20 stays.
    const out = capPhrasesByLength<P>(pool, sylOf, lenOf, Infinity, 1, capSyl(20))
    expect(out.map(sylOf)).toEqual([1, 5, 9])
  })

  it('a phrase exactly ON the threshold is kept', () => {
    const out = capPhrasesByLength<P>([p('a', 20), p('b', 21)], sylOf, lenOf, Infinity, 1, capSyl(20))
    expect(out.map(sylOf)).toEqual([20])
  })

  it('COMPOSES with the character cap — a phrase is dropped if it exceeds EITHER', () => {
    const mixed = [
      p('short', 4),            // 5 chars,  4 syl — survives both
      p('a'.repeat(50), 4),     // 50 chars, 4 syl — killed by the CHARACTER cap
      p('tiny', 40),            // 4 chars, 40 syl — killed by the SYLLABLE cap
    ]
    const out = capPhrasesByLength<P>(mixed, sylOf, lenOf, 10, 1, capSyl(20))
    expect(out.map(x => x.target_text)).toEqual(['short'])
  })

  it('an UNCOUNTABLE phrase (null syllables) passes the cap untouched — inertness', () => {
    // This is the kor/ara/zho path: no counter, so the cap cannot judge and
    // must not guess. The pool comes back whole, not empty.
    const uncountable = { limit: 5, syllablesOf: () => null }
    const out = capPhrasesByLength<P>(pool, sylOf, lenOf, Infinity, 1, uncountable)
    expect(out.map(sylOf)).toEqual([1, 5, 9, 21, 30])
  })

  it('a NaN syllable count is treated as uncountable, not as zero', () => {
    const out = capPhrasesByLength<P>(pool, sylOf, lenOf, Infinity, 1, { limit: 5, syllablesOf: () => NaN })
    expect(out).toHaveLength(pool.length)
  })

  it('STARVATION GUARD STILL WINS: an over-tight syllable cap degrades to the floor', () => {
    // A cap of 2 leaves exactly ONE phrase; the USE floor is 5, so the
    // shortest 5 come back instead. "Fewer phrases is a FAIL" — the cap
    // yields to the methodology floor, never the reverse.
    const out = capPhrasesByLength<P>(pool, sylOf, lenOf, Infinity, MIN_USE_PHRASES_AFTER_CAP, capSyl(2))
    expect(out.map(sylOf)).toEqual([1, 5, 9, 21, 30])
    expect(out).toHaveLength(MIN_USE_PHRASES_AFTER_CAP)
  })

  it('the guard fires for the COMBINED caps, not each one separately', () => {
    // Neither cap alone starves; together they leave 1, under the floor of 4.
    const out = capPhrasesByLength<P>(pool, sylOf, lenOf, 6, 4, capSyl(6))
    expect(out.map(sylOf)).toEqual([1, 5, 9, 21])
  })

  it('never empties a non-empty pool, at any threshold', () => {
    for (const limit of [1, 2, 3, 5, 10, 20, 100]) {
      expect(capPhrasesByLength<P>(pool, sylOf, lenOf, Infinity, 4, capSyl(limit)).length).toBeGreaterThan(0)
    }
  })

  it('does not mutate the pool it was handed', () => {
    const before = JSON.stringify(pool)
    capPhrasesByLength<P>(pool, sylOf, lenOf, Infinity, 4, capSyl(5))
    expect(JSON.stringify(pool)).toBe(before)
  })
})

describe('makePhraseSyllableResolver — the ONE place a phrase is counted', () => {
  it('counts with the canonical counter for a COVERED target language', () => {
    const r = makePhraseSyllableResolver('spa_for_eng', 'spa')
    expect(r.countable).toBe(true)
    expect(r.lang).toBe('spa')
    expect(r.syllablesOf({ target_text: 'Buenos días, cómo estás' })).toBe(8)
  })

  it('prefers a stored positive target_syllable_count over the counter', () => {
    const r = makePhraseSyllableResolver('spa_for_eng_stored', 'spa')
    // Authored data beats a heuristic where it exists — but it is effectively
    // empty in production (1.3% of rows), so the counter is the real path.
    expect(r.syllablesOf({ target_text: 'Buenos días, cómo estás', target_syllable_count: 3 })).toBe(3)
    // 0 / null / negative are NOT data — fall through to the counter.
    for (const empty of [0, null, undefined, -1]) {
      expect(r.syllablesOf({ target_text: 'país', target_syllable_count: empty })).toBe(2)
    }
  })

  it('reduces a REGIONAL target_lang to its parent language', () => {
    expect(makePhraseSyllableResolver('por_br_for_eng', 'por_br').countable).toBe(true)
    expect(makePhraseSyllableResolver('fra_ca_for_eng', 'fra_ca').lang).toBe('fra')
  })

  it('an UNCOVERED language leaves the cap INERT and WARNS — it never throws', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const r = makePhraseSyllableResolver('kor_for_eng', 'kor')

    expect(r.countable).toBe(false)
    // Does not throw, and does not guess with another language's rules.
    expect(() => r.syllablesOf({ target_text: '안녕하세요' })).not.toThrow()
    expect(r.syllablesOf({ target_text: '안녕하세요' })).toBeNull()

    // LOUD, not silent — the whole point.
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toMatch(/INERT for kor_for_eng/)
    expect(warn.mock.calls[0][0]).toMatch(/kor/)
  })

  it('warns ONCE per course, not once per phrase', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    makePhraseSyllableResolver('ara_for_eng', 'ara')
    makePhraseSyllableResolver('ara_for_eng', 'ara')
    makePhraseSyllableResolver('ara_for_eng', 'ara')
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('a MISSING target_lang is uncovered, not a crash', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    for (const [course, lang] of [['x1_for_eng', null], ['x2_for_eng', undefined], ['x3_for_eng', '']] as const) {
      const r = makePhraseSyllableResolver(course, lang)
      expect(r.countable).toBe(false)
      expect(r.syllablesOf({ target_text: 'anything' })).toBeNull()
    }
  })

  it('a covered language with no target text yields null, not a fake zero', () => {
    const r = makePhraseSyllableResolver('fra_for_eng', 'fra')
    expect(r.syllablesOf({ target_text: null })).toBeNull()
    expect(r.syllablesOf({ target_text: '' })).toBeNull()
  })
})
