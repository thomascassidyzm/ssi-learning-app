import { describe, it, expect } from 'vitest'
import {
  computeSeedLastLegoIndex,
  seedOwnAudio,
  deriveSeedFallbackAudio,
  selectFallbackWinnerRows,
  type L1FallbackPhraseRow,
} from './layer1CupFallback'

const row = (over: Partial<L1FallbackPhraseRow> = {}): L1FallbackPhraseRow => ({
  seed_number: 1,
  lego_index: 3,
  phrase_role: 'eternal_eligible',
  known_text: 'known',
  target_text: 'target phrase',
  known_audio_id: 'k1',
  target1_audio_id: 't1',
  target2_audio_id: 't2',
  target1_duration_ms: 2000,
  ...over,
})

const LAST = new Map([[1, 3], [2, 5]])

describe('computeSeedLastLegoIndex', () => {
  it('keeps the highest lego_index per seed regardless of row order', () => {
    const m = computeSeedLastLegoIndex([
      { seed_number: 1, lego_index: 2 },
      { seed_number: 1, lego_index: 5 },
      { seed_number: 1, lego_index: 3 },
      { seed_number: 2, lego_index: 1 },
    ])
    expect(m.get(1)).toBe(5)
    expect(m.get(2)).toBe(1)
  })
})

describe('seedOwnAudio', () => {
  const seed = (t1: string | null, t2: string | null) => ({
    seed_number: 7, known_text: 'k', target_text: 't', target_text_roman: null,
    known_audio_id: 'kn', target1_audio_id: t1, target2_audio_id: t2,
  })
  it('uses target1 when present', () => {
    expect(seedOwnAudio(seed('a', 'b'))?.target1Id).toBe('a')
  })
  it('plays the seed via voice 2 when only target2 exists (t1←t2 mirror)', () => {
    const a = seedOwnAudio(seed(null, 'b'))
    expect(a?.target1Id).toBe('b')
    expect(a?.target2Id).toBe('b')
  })
  it('returns null when the seed has no target audio in either voice', () => {
    expect(seedOwnAudio(seed(null, null))).toBeNull()
    expect(seedOwnAudio(undefined)).toBeNull()
  })
})

describe('deriveSeedFallbackAudio', () => {
  it('only considers rows on the seed\'s LAST lego', () => {
    const out = deriveSeedFallbackAudio([
      row({ lego_index: 1, target1_duration_ms: 9999 }),
      row({ lego_index: 3, target1_audio_id: 'winner', target1_duration_ms: 1000 }),
    ], LAST)
    expect(out.get(1)?.target1Id).toBe('winner')
  })

  it('excludes component rows and rows missing any audio id', () => {
    const out = deriveSeedFallbackAudio([
      row({ phrase_role: 'component', target1_duration_ms: 9999 }),
      row({ target2_audio_id: null, target1_duration_ms: 9999 }),
      row({ known_audio_id: null, target1_duration_ms: 9999 }),
    ], LAST)
    expect(out.size).toBe(0)
  })

  it('prefers USE over BUILD even when the BUILD phrase is longer', () => {
    const out = deriveSeedFallbackAudio([
      row({ phrase_role: 'practice', target1_audio_id: 'build', target1_duration_ms: 9000 }),
      row({ phrase_role: 'eternal_eligible', target1_audio_id: 'use', target1_duration_ms: 1000 }),
    ], LAST)
    expect(out.get(1)?.target1Id).toBe('use')
  })

  it('falls back to BUILD when no USE row survives', () => {
    const out = deriveSeedFallbackAudio([
      row({ phrase_role: 'practice', target1_audio_id: 'build' }),
    ], LAST)
    expect(out.get(1)?.target1Id).toBe('build')
  })

  it('picks the LONGEST by target1_duration_ms', () => {
    const out = deriveSeedFallbackAudio([
      row({ target1_audio_id: 'short', target1_duration_ms: 1000 }),
      row({ target1_audio_id: 'long', target1_duration_ms: 3000 }),
      row({ target1_audio_id: 'mid', target1_duration_ms: 2000 }),
    ], LAST)
    expect(out.get(1)?.target1Id).toBe('long')
  })

  it('null durations rank below real ones; text length stands in when all are null', () => {
    const withNull = deriveSeedFallbackAudio([
      row({ target1_audio_id: 'nodur', target1_duration_ms: null, target_text: 'a very very long phrase indeed' }),
      row({ target1_audio_id: 'timed', target1_duration_ms: 500, target_text: 'x' }),
    ], LAST)
    expect(withNull.get(1)?.target1Id).toBe('timed')
    const allNull = deriveSeedFallbackAudio([
      row({ target1_audio_id: 'short-text', target1_duration_ms: null, target_text: 'ab' }),
      row({ target1_audio_id: 'long-text', target1_duration_ms: null, target_text: 'a much longer target text' }),
    ], LAST)
    expect(allNull.get(1)?.target1Id).toBe('long-text')
  })

  it('is deterministic regardless of input row order', () => {
    const rows = [
      row({ target1_audio_id: 'a', target1_duration_ms: 2000, target_text: 'aaaa' }),
      row({ target1_audio_id: 'b', target1_duration_ms: 2000, target_text: 'bbbb' }),
      row({ target1_audio_id: 'c', target1_duration_ms: 1000 }),
    ]
    const fwd = deriveSeedFallbackAudio(rows, LAST).get(1)?.target1Id
    const rev = deriveSeedFallbackAudio([...rows].reverse(), LAST).get(1)?.target1Id
    expect(fwd).toBe(rev)
  })

  it('carries the PHRASE\'s own known clip and texts', () => {
    const out = deriveSeedFallbackAudio([
      row({ known_audio_id: 'phrase-known', known_text: 'phrase gloss', target_text: 'phrase target' }),
    ], LAST)
    const a = out.get(1)!
    expect(a.knownId).toBe('phrase-known')
    expect(a.knownText).toBe('phrase gloss')
    expect(a.targetText).toBe('phrase target')
  })
})

describe('selectFallbackWinnerRows', () => {
  it('returns exactly one row per rescued seed, and re-derivation over the winners is identical', () => {
    const rows = [
      row({ seed_number: 1, target1_audio_id: 'w1', target1_duration_ms: 3000 }),
      row({ seed_number: 1, target1_audio_id: 'l1', target1_duration_ms: 1000 }),
      row({ seed_number: 2, lego_index: 5, target1_audio_id: 'w2', target1_duration_ms: 2000 }),
      row({ seed_number: 2, lego_index: 4, target1_audio_id: 'wrong-lego', target1_duration_ms: 9000 }),
    ]
    const winners = selectFallbackWinnerRows(rows, LAST)
    expect(winners.length).toBe(2)
    const full = deriveSeedFallbackAudio(rows, LAST)
    const fromWinners = deriveSeedFallbackAudio(winners, LAST)
    expect([...fromWinners.entries()]).toEqual([...full.entries()])
  })
})
