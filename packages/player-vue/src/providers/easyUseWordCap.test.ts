/**
 * THE SLIDING USE WORD CAP (Tom, 2026-08-09).
 *
 * Four things at once, and all four matter:
 *   - it counts WORDS, not milliseconds. Duration was measured first and
 *     rejected: baked-in silence differs by language and by render batch, so an
 *     ms ceiling ranked the wrong phrases as long;
 *   - it SLIDES — 8 words for rounds 1-20, 10 for rounds 21-100, and off
 *     entirely from round 101, where the learner no longer needs the gentling;
 *   - it counts whichever side of the pair is ENGLISH: known_text when English
 *     is the known language, target_text when English is the target;
 *   - it applies ONLY where English is on one side. The scale was validated on
 *     English-involved pairs (fra_for_eng, eng_for_zho, eng_for_ara,
 *     eng_for_hin, eng_for_spa); the 47 courses with English on neither side
 *     are deferred, and Easy there behaves exactly as it did before.
 *
 * Plus the invariant that must survive it: a round with nothing under the
 * ceiling drops the ceiling rather than playing empty.
 */
import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { generateLearningScript, DEFAULT_SCRIPT_SHAPE, type ScriptItem } from './generateLearningScript'
import {
  capUsePoolByWords, countEnglishWords, englishSideOfCourse,
  makeUseWordCap, normalizeUseWordCapTiers, useWordLimitForRound,
  DEFAULT_EASY_USE_WORD_CAP_TIERS,
} from '../composables/useAlgorithmConfig'

const TIERS = [...DEFAULT_EASY_USE_WORD_CAP_TIERS]

const audio = (n: string) => ({
  known_audio_id: `${n}-k`,
  target1_audio_id: `${n}-t1`,
  target2_audio_id: `${n}-t2`,
  target1_duration_ms: 1000,
  target2_duration_ms: 1000,
})

// Counted at test time by the same counter the cap uses, so the fixtures can
// never drift from the rule they are testing.
const SHORT_EN = 'i can see the dog'                                        // 5
const MID_EN = 'i can see the big brown dog there today'                    // 9
const LONG_EN = 'i would definitely have remembered to visit them yesterday before everybody arrived'  // 13

/** Enough seeds to walk past the ladder's last rung. */
const TOTAL_SEEDS = 115

/**
 * `englishSide` decides which text carries the English. The OTHER side is
 * deliberately given the opposite length profile, so a cap that counted the
 * wrong side would keep exactly the wrong phrases.
 */
function makeCourse(
  { knownLang, targetLang, englishSide, longOnly = false }:
  { knownLang: string; targetLang: string; englishSide: 'known' | 'target'; longOnly?: boolean },
) {
  const legos: any[] = []
  const phrases: any[] = []
  const seeds: any[] = []

  /** English text on its side; a decoy of the inverse length on the other. */
  const pair = (english: string, decoyWords: number, tag: string) => {
    const decoy = Array.from({ length: decoyWords }, (_, i) => `d${i}`).join(' ') + ` ${tag}`
    return englishSide === 'known'
      ? { known_text: `${english} ${tag}`, target_text: decoy }
      : { known_text: decoy, target_text: `${english} ${tag}` }
  }

  for (let s = 1; s <= TOTAL_SEEDS; s++) {
    legos.push({
      seed_number: s, lego_index: 1,
      known_text: `word ${s}`, target_text: `mot${s}`, target_text_roman: null,
      type: 'A', is_new: true, presentation_audio_id: `pres-${s}`, ...audio(`lego${s}`),
    })
    seeds.push({
      seed_number: s, known_text: `sentence ${s}`, target_text: `phrase mot${s}`,
      target_text_roman: null, ...audio(`seed${s}`),
    })
    for (let p = 1; p <= 5; p++) {
      phrases.push({
        seed_number: s, lego_index: 1,
        ...pair('i want the build', 20, `b${s}x${p}`),
        target_text_roman: null,
        phrase_role: 'build', position: p, target_syllable_count: null, ...audio(`b${s}-${p}`),
      })
    }
    // SHORT (5 English words) and MID (9) — the two rungs' worth of headroom.
    if (!longOnly) {
      for (let p = 1; p <= 3; p++) {
        phrases.push({
          seed_number: s, lego_index: 1,
          ...pair(SHORT_EN, 30, `u${s}x${p}`),
          target_text_roman: null,
          phrase_role: 'use', position: 100 + p, target_syllable_count: null, ...audio(`u${s}-${p}`),
        })
        phrases.push({
          seed_number: s, lego_index: 1,
          ...pair(MID_EN, 30, `m${s}x${p}`),
          target_text_roman: null,
          phrase_role: 'use', position: 130 + p, target_syllable_count: null, ...audio(`m${s}-${p}`),
        })
      }
    }
    // LONG (13 English words) — over BOTH rungs; only reachable from round 101,
    // or through the starvation guard when they are all a LEGO has.
    for (let p = 1; p <= 3; p++) {
      phrases.push({
        seed_number: s, lego_index: 1,
        ...pair(LONG_EN, 2, `L${s}x${p}`),
        target_text_roman: null,
        phrase_role: 'use', position: 200 + p, target_syllable_count: null, ...audio(`L${s}-${p}`),
      })
    }
  }
  return {
    course_legos: legos,
    course_practice_phrases: phrases,
    course_seeds: seeds,
    courses: [{ course_code: 'tst', known_lang: knownLang, target_lang: targetLang }],
  }
}

function fakeSupabase(tables: Record<string, any[]>): SupabaseClient {
  const all: Record<string, any[]> = {
    course_audio: [], lego_introductions: [], listening_pod_sentences: [], courses: [],
    ...tables,
  }
  return {
    from(table: string) {
      const rows = all[table] ?? []
      let headOnly = false
      const builder: any = {
        select(_c?: string, opts?: { count?: string; head?: boolean }) {
          headOnly = !!opts?.head
          return builder
        },
        maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
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

const run = (
  course: Parameters<typeof makeCourse>[0],
  easy: Parameters<typeof generateLearningScript>[6] = { useWordCapTiers: TIERS },
) => generateLearningScript(
  fakeSupabase(makeCourse(course)),
  'tst', 0, { enabled: false, offset: 90 }, DEFAULT_SCRIPT_SHAPE, 1, easy,
)

const ENG_KNOWN = { knownLang: 'eng', targetLang: 'fra', englishSide: 'known' as const }
const ENG_TARGET = { knownLang: 'zho', targetLang: 'eng', englishSide: 'target' as const }
const NO_ENGLISH = { knownLang: 'tam', targetLang: 'kor', englishSide: 'known' as const }

/** Every USE-family cycle: the debut USE fill, reviews, and consolidates. */
const useItems = (items: ScriptItem[]) =>
  items.filter(i => (i.type === 'spaced_rep' || i.type === 'use' || i.type === 'build') && i.reviewItemKind !== 'seed')

/** The English-side word count of an emitted item, for a given course shape. */
const englishWordsOf = (item: ScriptItem, side: 'known' | 'target') =>
  countEnglishWords(side === 'known' ? item.knownText : item.targetText)

describe('0. the fixtures straddle both rungs', () => {
  it('short is under 8, mid is between 8 and 10, long is over 10', () => {
    expect(countEnglishWords(SHORT_EN)).toBeLessThanOrEqual(8)
    expect(countEnglishWords(MID_EN)).toBeGreaterThan(8)
    expect(countEnglishWords(MID_EN)).toBeLessThanOrEqual(10)
    expect(countEnglishWords(LONG_EN)).toBeGreaterThan(10)
  })
})

describe('1. countEnglishWords', () => {
  it('ignores punctuation and stray whitespace', () => {
    expect(countEnglishWords('  Hello,   world!  ')).toBe(2)
  })
  it('counts a contraction and a hyphenated compound as one word each', () => {
    expect(countEnglishWords("i don't have twenty-one")).toBe(4)
  })
  it('is 0 for nothing at all', () => {
    expect(countEnglishWords('')).toBe(0)
    expect(countEnglishWords(null)).toBe(0)
    expect(countEnglishWords(undefined)).toBe(0)
  })
})

describe('2. englishSideOfCourse — where the cap applies at all', () => {
  it('finds English as the known language', () => {
    expect(englishSideOfCourse('eng', 'fra')).toBe('known')
  })
  it('finds English as the target language', () => {
    expect(englishSideOfCourse('zho', 'eng')).toBe('target')
  })
  it('accepts the other spellings of English', () => {
    expect(englishSideOfCourse('en-GB', 'fra')).toBe('known')
    expect(englishSideOfCourse('spa', 'en_US')).toBe('target')
  })
  it('is null when English is on NEITHER side — the deferred case', () => {
    expect(englishSideOfCourse('tam', 'kor')).toBeNull()
    expect(englishSideOfCourse(null, undefined)).toBeNull()
  })
})

describe('3. normalizeUseWordCapTiers — a bad row degrades to NO cap', () => {
  it('keeps a valid ladder, ascending', () => {
    expect(normalizeUseWordCapTiers([{ maxRound: 100, maxWords: 10 }, { maxRound: 20, maxWords: 8 }]))
      .toEqual([{ maxRound: 20, maxWords: 8 }, { maxRound: 100, maxWords: 10 }])
  })
  it('drops rungs that make no sense rather than guessing at them', () => {
    expect(normalizeUseWordCapTiers([{ maxRound: 0, maxWords: 8 }, { maxRound: 20, maxWords: -1 } as any]))
      .toEqual([])
  })
  it('is empty — no cap — for anything that is not an array', () => {
    expect(normalizeUseWordCapTiers(undefined)).toEqual([])
    expect(normalizeUseWordCapTiers(null)).toEqual([])
    expect(normalizeUseWordCapTiers('8' as any)).toEqual([])
  })
})

describe('4. useWordLimitForRound — the slide itself', () => {
  const cap = makeUseWordCap('eng', 'fra', TIERS)!
  it('is 8 for rounds 1-20, inclusive of 20', () => {
    expect(useWordLimitForRound(cap, 1)).toBe(8)
    expect(useWordLimitForRound(cap, 20)).toBe(8)
  })
  it('is 10 for rounds 21-100, inclusive of 100', () => {
    expect(useWordLimitForRound(cap, 21)).toBe(10)
    expect(useWordLimitForRound(cap, 100)).toBe(10)
  })
  it('comes OFF from round 101 — nothing backlogged', () => {
    expect(useWordLimitForRound(cap, 101)).toBe(Infinity)
    expect(useWordLimitForRound(cap, 5000)).toBe(Infinity)
  })
  it('is off entirely with no cap', () => {
    expect(useWordLimitForRound(null, 1)).toBe(Infinity)
  })
})

describe('5. makeUseWordCap — when it resolves to nothing', () => {
  it('is null with no ladder (Fast)', () => {
    expect(makeUseWordCap('eng', 'fra', [])).toBeNull()
    expect(makeUseWordCap('eng', 'fra', undefined)).toBeNull()
  })
  it('is null when English is on neither side, however good the ladder', () => {
    expect(makeUseWordCap('tam', 'kor', TIERS)).toBeNull()
  })
  it('resolves the side it must count', () => {
    expect(makeUseWordCap('zho', 'eng', TIERS)).toEqual({ side: 'target', tiers: TIERS })
  })
})

describe('6. capUsePoolByWords — the rule, including the starvation guard', () => {
  const cap = makeUseWordCap('eng', 'fra', TIERS)!
  const pool = [
    { known_text: SHORT_EN, target_text: 'x' },
    { known_text: MID_EN, target_text: 'x' },
    { known_text: LONG_EN, target_text: 'x' },
  ]
  it('keeps only what is at or under the rung', () => {
    expect(capUsePoolByWords(pool, 1, cap).map(p => p.known_text)).toEqual([SHORT_EN])
    expect(capUsePoolByWords(pool, 50, cap).map(p => p.known_text)).toEqual([SHORT_EN, MID_EN])
  })
  it('hands the pool back untouched past the last rung', () => {
    expect(capUsePoolByWords(pool, 101, cap)).toEqual(pool)
  })
  it('STARVATION GUARD: a round with nothing eligible drops the cap, not the round', () => {
    const longOnly = [{ known_text: LONG_EN, target_text: 'x' }]
    expect(capUsePoolByWords(longOnly, 1, cap)).toEqual(longOnly)
  })
  it('never returns an empty pool', () => {
    for (const round of [1, 20, 21, 100, 101]) {
      expect(capUsePoolByWords(pool, round, cap).length).toBeGreaterThan(0)
    }
  })
  it('lets a phrase with no text on the English side through', () => {
    expect(capUsePoolByWords([{ known_text: '', target_text: 'x' }], 1, cap)).toHaveLength(1)
  })
  it('does nothing at all with no cap', () => {
    expect(capUsePoolByWords(pool, 1, null)).toEqual(pool)
  })
})

describe('7. end to end — English on the KNOWN side', () => {
  it('no USE-family phrase exceeds 8 English words in rounds 1-20', async () => {
    const { items, useWordCapApplied } = await run(ENG_KNOWN)
    expect(useWordCapApplied).toBe(true)
    const early = items.filter(i => i.roundNumber <= 20)
    expect(early.length).toBeGreaterThan(0)
    for (const item of useItems(early)) {
      expect(englishWordsOf(item, 'known')).toBeLessThanOrEqual(8)
    }
  })

  it('the 9-word phrases arrive on the second rung and the 13-word ones do not', async () => {
    const { items } = await run(ENG_KNOWN)
    const middle = useItems(items.filter(i => i.roundNumber > 20 && i.roundNumber <= 100))
    const counts = middle.map(i => englishWordsOf(i, 'known'))
    expect(Math.max(...counts)).toBeGreaterThan(8)
    expect(Math.max(...counts)).toBeLessThanOrEqual(10)
  })

  it('the long phrases come back from round 101 — the cap lifts', async () => {
    const { items } = await run(ENG_KNOWN)
    const late = useItems(items.filter(i => i.roundNumber > 100))
    expect(late.length).toBeGreaterThan(0)
    expect(Math.max(...late.map(i => englishWordsOf(i, 'known')))).toBeGreaterThan(10)
  })

  it('the pool it draws from really is smaller early than late', async () => {
    const { items } = await run(ENG_KNOWN)
    const distinct = (from: number, to: number) => new Set(
      useItems(items.filter(i => i.roundNumber >= from && i.roundNumber <= to)).map(i => i.knownText),
    ).size
    expect(distinct(1, 20)).toBeLessThan(distinct(101, 200) || Infinity)
  })
})

describe('8. end to end — English on the TARGET side', () => {
  it('counts the TARGET text, and the long-known decoys do not fool it', async () => {
    const { items, useWordCapApplied } = await run(ENG_TARGET)
    expect(useWordCapApplied).toBe(true)
    for (const item of useItems(items.filter(i => i.roundNumber <= 20))) {
      expect(englishWordsOf(item, 'target')).toBeLessThanOrEqual(8)
    }
  })
})

describe('9. English on NEITHER side — deferred, so nothing changes', () => {
  it('reports the cap not applied and emits exactly what an uncapped run emits', async () => {
    const capped = await run(NO_ENGLISH)
    const uncapped = await run(NO_ENGLISH, {})
    expect(capped.useWordCapApplied).toBe(false)
    expect(capped.items.map(i => i.uuid)).toEqual(uncapped.items.map(i => i.uuid))
  })
})

describe('10. Fast is provably unchanged', () => {
  it('an empty ladder emits exactly what passing no options emits', async () => {
    const fast = await run(ENG_KNOWN, { useWordCapTiers: [] })
    const none = await run(ENG_KNOWN, {})
    expect(fast.useWordCapApplied).toBe(false)
    expect(fast.items.map(i => i.uuid)).toEqual(none.items.map(i => i.uuid))
  })

  it('Fast meets the long phrases from the very first rounds', async () => {
    const { items } = await run(ENG_KNOWN, { useWordCapTiers: [] })
    const early = useItems(items.filter(i => i.roundNumber <= 20))
    expect(Math.max(...early.map(i => englishWordsOf(i, 'known')))).toBeGreaterThan(10)
  })
})

describe('11. a round is never emptied by the cap', () => {
  it('every round the uncapped run plays, the capped run plays too', async () => {
    const capped = await run(ENG_KNOWN)
    const uncapped = await run(ENG_KNOWN, {})
    const rounds = (items: ScriptItem[]) => new Set(items.map(i => i.roundNumber))
    for (const r of rounds(uncapped.items)) {
      expect(rounds(capped.items).has(r)).toBe(true)
    }
  })
})
