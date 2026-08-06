import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { generateLearningScript, DEFAULT_SCRIPT_SHAPE } from './generateLearningScript'
import { capPhrasesByLength } from '../composables/useAlgorithmConfig'

// maxPhraseLengthFraction (Easy/Fast mode contract, Aran's correction
// 2026-08-06). The cap is a fraction of the LONGEST phrase available for a
// LEGO: 1.0 = uncapped = the pre-2026-08-06 behaviour exactly (Fast ships
// 1.0); 0.5 = Easy, half the longest possible phrase.
//
// Sorting is ALWAYS shortest-first — there is no sort-direction knob — so the
// cap only ever removes the long tail of a pool, and the starvation guard
// means it can never empty a round.

// ── The rule itself ─────────────────────────────────────────────────────────

const syl = (n: number) => n
const pool = (...counts: number[]) => counts

describe('capPhrasesByLength', () => {
  it('sorts shortest-first and is the identity at fraction 1.0', () => {
    expect(capPhrasesByLength(pool(9, 3, 6), syl, 1.0, 3)).toEqual([3, 6, 9])
  })

  it('caps at fraction × the pool maximum', () => {
    // poolMax 10, fraction 0.5 → limit 5 → keep 2,4,5.
    expect(capPhrasesByLength(pool(2, 4, 5, 6, 10), syl, 0.5, 3)).toEqual([2, 4, 5])
  })

  it('keeps phrases exactly ON the limit', () => {
    expect(capPhrasesByLength(pool(4, 8), syl, 0.5, 1)).toEqual([4])
  })

  it('STARVATION GUARD: falls back to the shortest phrases available', () => {
    // poolMax 20, fraction 0.5 → limit 10 → only 2 survive, but the round
    // needs 4. Rather than starve the LEGO, the whole pool comes back,
    // shortest-first, for the caller to truncate.
    expect(capPhrasesByLength(pool(2, 4, 12, 16, 20), syl, 0.5, 4)).toEqual([2, 4, 12, 16, 20])
  })

  it('never returns an empty pool for a non-empty input', () => {
    expect(capPhrasesByLength(pool(10), syl, 0.1, 1)).toEqual([10])
    expect(capPhrasesByLength(pool(), syl, 0.5, 3)).toEqual([])
  })

  it('degrades to uncapped (never to a cap) on a missing or invalid fraction', () => {
    const p = pool(2, 4, 12, 20)
    const bad = [undefined, null, 0, -1, 1.5, NaN, Infinity, '0.5' as unknown as number]
    for (const f of bad) {
      expect(capPhrasesByLength(p, syl, f as number, 1)).toEqual([2, 4, 12, 20])
    }
  })
})

// ── The rule inside the generator ───────────────────────────────────────────

const audio = (n: string) => ({
  known_audio_id: `${n}-k`,
  target1_audio_id: `${n}-t1`,
  target2_audio_id: `${n}-t2`,
  target1_duration_ms: 1000,
  target2_duration_ms: 1000,
})

// Two LEGOs, so the walk reaches round 2 and LEGO 1 comes back for spaced-rep
// review — the only phase that draws from the far end of a USE pool.
const makeLego = (index: number) => ({
  seed_number: 1,
  lego_index: index,
  known_text: `I want ${index}`,
  target_text: `ich will ${index}`,
  target_text_roman: null,
  type: 'M',
  is_new: true,
  presentation_audio_id: `pres-${index}`,
  ...audio(`lego${index}`),
})
const LEGOS = [makeLego(1), makeLego(2)]

const BUILD_SYLLABLES = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
// A wide USE spread: the long ones only ever reach the learner through the
// spaced-rep review pool, which is where the cap has to bite.
const USE_SYLLABLES = [3, 4, 5, 6, 7, 8, 18, 20]

const phrasesForLego = (lego: number) => [
  ...BUILD_SYLLABLES.map((s, i) => ({
    seed_number: 1,
    lego_index: lego,
    known_text: `I want build ${lego}-${s}`,
    target_text: `ich will bauen ${lego}-${s}`,
    phrase_role: 'build',
    position: i,
    target_syllable_count: s,
    ...audio(`b${lego}-${i}`),
  })),
  ...USE_SYLLABLES.map((s, i) => ({
    seed_number: 1,
    lego_index: lego,
    known_text: `I want to use it ${lego}-${s}`,
    target_text: `ich will es benutzen ${lego}-${s}`,
    phrase_role: 'use',
    position: 100 + i,
    target_syllable_count: s,
    ...audio(`u${lego}-${i}`),
  })),
]

const PHRASES = [...phrasesForLego(1), ...phrasesForLego(2)]

const TABLES: Record<string, any[]> = {
  course_legos: LEGOS,
  course_practice_phrases: PHRASES,
  course_seeds: [
    {
      seed_number: 1,
      known_text: 'I want to learn German',
      target_text: 'ich will Deutsch lernen',
      target_text_roman: null,
      ...audio('seed'),
    },
  ],
  course_audio: [],
  lego_introductions: [],
  listening_pod_sentences: [],
}

function fakeSupabase(): SupabaseClient {
  return {
    from(table: string) {
      const rows = TABLES[table] ?? []
      let headOnly = false
      const builder: any = {
        select(_cols?: string, opts?: { count?: string; head?: boolean }) {
          headOnly = !!opts?.head
          return builder
        },
        then(resolve: (v: any) => any, reject?: (e: any) => any) {
          const value = headOnly
            ? { data: null, count: rows.length, error: null }
            : { data: rows, count: rows.length, error: null }
          return Promise.resolve(value).then(resolve, reject)
        },
      }
      for (const m of ['eq', 'in', 'order', 'range', 'limit', 'gte', 'lte', 'not', 'is']) {
        builder[m] = () => builder
      }
      return builder
    },
  } as unknown as SupabaseClient
}

const run = (fraction?: number) =>
  generateLearningScript(
    fakeSupabase(),
    'deu_for_eng',
    // A revival tail, so the spaced-rep / review pool actually gets walked.
    20,
    { enabled: false, offset: 90 },
    DEFAULT_SCRIPT_SHAPE,
    fraction,
  )

// Only BUILD items carry syllableCount, so read the length back out of the
// fixture text instead — that covers review/consolidate items too, which is
// exactly where a LEGO's longest phrases surface.
const legoSyllables = (items: Array<{ targetText?: string }>) =>
  items
    .map((i) => /\d+-(\d+)$/.exec(i.targetText || ''))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => Number(m[1]))

const shape = (items: Array<{ type: string; uuid?: string }>) =>
  items.map((i) => `${i.type}:${i.uuid}`).join('|')

describe('maxPhraseLengthFraction in generateLearningScript', () => {
  it('defaults to uncapped, and 1.0 is byte-identical to omitting it', async () => {
    const omitted = (await run()).items
    const explicit = (await run(1.0)).items
    expect(shape(omitted)).toBe(shape(explicit))
    // Uncapped, the learner does meet the longest USE phrase.
    expect(Math.max(...legoSyllables(omitted))).toBe(20)
  })

  it('an invalid fraction degrades to uncapped, not to a cap', async () => {
    const uncapped = shape((await run(1.0)).items)
    expect(shape((await run(0)).items)).toBe(uncapped)
    expect(shape((await run(-1)).items)).toBe(uncapped)
  })

  it('0.5 halves the longest phrase the learner meets', async () => {
    const syls = legoSyllables((await run(0.5)).items)
    expect(syls.length).toBeGreaterThan(0)
    // USE pool max is 20 → limit 10 → the 18- and 20-syllable phrases are gone.
    expect(Math.max(...syls)).toBeLessThanOrEqual(10)
  })

  it('a cap never empties a round: every round still has cycles', async () => {
    const { items } = await run(0.1)
    expect(items.length).toBeGreaterThan(0)
    const byRound = new Map<number, number>()
    for (const i of items as Array<{ roundNumber: number }>) {
      byRound.set(i.roundNumber, (byRound.get(i.roundNumber) || 0) + 1)
    }
    expect(byRound.size).toBeGreaterThan(0)
    for (const [, count] of byRound) expect(count).toBeGreaterThan(0)
  })
})
