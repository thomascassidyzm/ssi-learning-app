/**
 * The phrase-length cap — Easy halves the longest possible phrase
 * (Aran, 2026-08-06).
 *
 * These semantics mirror Popty's services/learning-modes.cjs exactly. The two
 * MUST NOT diverge (docs/voice-engine/script-divergence-report.md); an earlier
 * pass had the player on a per-LEGO syllable ceiling while Popty used a
 * course-wide character one, which is the failure this file now pins down.
 */

import { describe, it, expect } from 'vitest'
import {
  capPhrasesByLength,
  courseMaxPhraseLength,
  phraseTextLength,
  normalizeMaxPhraseLengthFraction,
  MIN_BUILD_PHRASES_AFTER_CAP,
  MIN_USE_PHRASES_AFTER_CAP,
} from '../composables/useAlgorithmConfig'

interface P { target_text: string; syl: number }
const p = (target_text: string, syl: number): P => ({ target_text, syl })
const sylOf = (x: P) => x.syl
const lenOf = (x: P) => phraseTextLength(x.target_text)

describe('normalizeMaxPhraseLengthFraction', () => {
  it('degrades anything missing or invalid to UNCAPPED, never to a cap', () => {
    // A bad DB value must give today's full-length script; falling back to a
    // cap would silently shorten every phrase in the course.
    for (const bad of [undefined, null, 0, -0.5, 2, NaN, Infinity]) {
      expect(normalizeMaxPhraseLengthFraction(bad as number)).toBe(1)
    }
    expect(normalizeMaxPhraseLengthFraction(0.5)).toBe(0.5)
  })
})

describe('phraseTextLength — the CAP measures characters, not syllables', () => {
  it('counts target text characters, and works in a non-Latin script', () => {
    // target_syllable_count is NULL for all 11,340 ara_for_eng phrases, and the
    // syllable fallback is a Latin vowel-cluster heuristic returning 1 for all
    // Arabic — a syllable ceiling computed to 0.5 and the cap did nothing.
    expect(phraseTextLength('hello there')).toBe(11)
    expect(phraseTextLength('مرحبا')).toBe(5)
    expect(phraseTextLength(null)).toBe(0)
    expect(phraseTextLength(undefined)).toBe(0)
  })
})

describe('courseMaxPhraseLength — the ceiling is COURSE-WIDE, not per-LEGO', () => {
  it('spans every list it is given', () => {
    const build = [p('ab', 1), p('abcd', 2)]
    const use = [p('abcdefgh', 3)]
    expect(courseMaxPhraseLength<P>([build, use], lenOf)).toBe(8)
  })

  it('tolerates empty and null lists', () => {
    expect(courseMaxPhraseLength<P>([], lenOf)).toBe(0)
    expect(courseMaxPhraseLength<P>([null, [p('abc', 1)]], lenOf)).toBe(3)
  })
})

describe('capPhrasesByLength', () => {
  // syllables ascend with length here so the historic sort is observable.
  const pool = [p('aa', 1), p('aaaa', 2), p('aaaaaa', 3), p('aaaaaaaa', 4), p('aaaaaaaaaa', 5)]

  it('an uncapped run is the plain historic shortest-first sort — Fast is unchanged', () => {
    const out = capPhrasesByLength<P>(pool, sylOf, lenOf, Infinity, 4)
    expect(out.map(lenOf)).toEqual([2, 4, 6, 8, 10])
    // Identical to sorting by syllables alone, which is what the code did before.
    expect(out).toEqual([...pool].sort((a, b) => sylOf(a) - sylOf(b)))
  })

  it('sorts shortest-first even when handed a reversed pool', () => {
    const out = capPhrasesByLength<P>([...pool].reverse(), sylOf, lenOf, Infinity, 4)
    expect(out.map(sylOf)).toEqual([1, 2, 3, 4, 5])
  })

  it('drops phrases longer than the absolute ceiling', () => {
    expect(capPhrasesByLength<P>(pool, sylOf, lenOf, 5, 1).map(lenOf)).toEqual([2, 4])
  })

  it('the ceiling is absolute, so a phrase is judged the same beside long or short neighbours', () => {
    const longNeighbours = [p('aaaa', 1), p('a'.repeat(40), 9), p('a'.repeat(50), 11)]
    expect(capPhrasesByLength<P>(longNeighbours, sylOf, lenOf, 5, 1).map(lenOf)).toEqual([4])
  })

  it('STARVATION GUARD: yields to the phrase floor rather than emptying a LEGO', () => {
    // Cap alone leaves 2; the floor is 4, so the shortest 4 come back instead.
    expect(capPhrasesByLength<P>(pool, sylOf, lenOf, 5, 4).map(lenOf)).toEqual([2, 4, 6, 8])
  })

  it('the guard cannot invent phrases that do not exist', () => {
    const allLong = [p('a'.repeat(60), 9), p('a'.repeat(69), 11)]
    expect(capPhrasesByLength<P>(allLong, sylOf, lenOf, 36, 4)).toHaveLength(2)
  })

  it('handles an empty pool', () => {
    expect(capPhrasesByLength<P>([], sylOf, lenOf, 5, 4)).toEqual([])
  })

  it('does not mutate the pool it was handed', () => {
    const before = JSON.stringify(pool)
    capPhrasesByLength<P>(pool, sylOf, lenOf, 5, 4)
    expect(JSON.stringify(pool)).toBe(before)
  })

  it('uses the methodology floors, not the round ceiling', () => {
    // The floors are why the cap can bite at all: BUILD pools average 3.2
    // phrases, so a ceiling-sized floor would swallow the cap on every LEGO.
    expect(MIN_BUILD_PHRASES_AFTER_CAP).toBe(4)
    expect(MIN_USE_PHRASES_AFTER_CAP).toBe(5)
  })
})
