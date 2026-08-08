/**
 * THE KNOWN-SIDE PULL FILTER on REVIEW and CONSOLIDATE slots (Tom, 2026-08-07).
 *
 * SCOPE NOTE, 2026-08-08: this is now a GENERATOR CAPABILITY, not a mode.
 * Easy's long-phrase handling moved to a play-time skip (Tom: "exactly the same
 * script, but with different rules"), so the player passes no pool options at
 * all and both modes generate the identical script. The filter below is still
 * the one place a course-wide known-side pull rule would live if config ever
 * wants one — it is simply no longer reachable from `learningMode`, and must
 * never be wired back to it: whatever is baked here is baked into a CACHED
 * script, which is exactly the bug the play-time move fixed.
 *
 * Three things at once, and all three matter:
 *   - it counts syllables in the KNOWN language — the prompt the learner hears
 *     in their own language — not the target;
 *   - it filters WHICH use phrase is pulled from a LEGO's basket for a review
 *     or consolidate slot; it is not a ceiling over the whole script;
 *   - it is active for rounds 1-100 only, and then simply comes off. Per Tom:
 *     "the whole idea of you've got a cascade, you've got a wall, once you get
 *      to 100 and 101, all these space repetitions is complete nonsense, makes
 *      no difference at all" — because "it's the LEGO that you are practicing",
 *     so a phrase the learner has never met before is fine.
 *
 * Plus the invariant that must survive it: a basket with nothing short enough
 * yields its SHORTEST phrase rather than an empty slot.
 *
 * NOT tested, on Tom's ruling (2026-08-07): that a pulled phrase contains its
 * LEGO. A LEGO's basket IS its own BLD and USE phrases, so by definition every
 * phrase in it contains that LEGO. It is automatic, not a rule to implement.
 * A spaced-rep REVIEW pull is a USE phrase from an EARLIER LEGO's basket, and
 * the same definition holds there.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { countSyllables } from '@ssi/core/text'
import { generateLearningScript, DEFAULT_SCRIPT_SHAPE, type ScriptItem } from './generateLearningScript'
import { filterReviewPool } from '../composables/useAlgorithmConfig'

const audio = (n: string) => ({
  known_audio_id: `${n}-k`,
  target1_audio_id: `${n}-t1`,
  target2_audio_id: `${n}-t2`,
  target1_duration_ms: 1000,
  target2_duration_ms: 1000,
})

// Counted by the canonical English counter at test time rather than asserted
// from a comment, so the fixture can never drift from the rule it is testing.
const SHORT_KNOWN = 'i can see the dog'
const LONG_KNOWN = 'i would definitely have remembered to visit them yesterday afternoon before everybody arrived'
const LIMIT = 15

const knownSyllables = (text: string) => countSyllables(text, 'eng')

/** Enough seeds to walk past the filter's round window. */
const TOTAL_SEEDS = 115

/** `longOnly` gives every LEGO a basket with nothing under the limit. */
function makeCourse(knownLang: string, { longOnly = false } = {}) {
  const legos: any[] = []
  const phrases: any[] = []
  const seeds: any[] = []
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
        known_text: `i want the build ${s}.${p}`, target_text: `je veux mot${s} b${p}`,
        phrase_role: 'build', position: p, target_syllable_count: null, ...audio(`b${s}-${p}`),
      })
    }
    // SHORT use phrases — under the limit on the KNOWN side, and deliberately
    // the LONGER of the two on the target side, so a filter that counted the
    // target would keep exactly the wrong ones.
    if (!longOnly) {
      for (let p = 1; p <= 6; p++) {
        phrases.push({
          seed_number: s, lego_index: 1,
          known_text: `${SHORT_KNOWN} number ${s}.${p}`,
          target_text: `je me souviens tres bien de mot${s} u${p}`,
          phrase_role: 'use', position: 100 + p, target_syllable_count: null, ...audio(`u${s}-${p}`),
        })
      }
    }
    // LONG use phrases — well over the limit on the known side. When longOnly,
    // one of them is deliberately the shortest so the fallback has a target.
    for (let p = 1; p <= 6; p++) {
      const known = longOnly && p === 1
        ? `${LONG_KNOWN} once`                     // shortest of the long ones
        : `${LONG_KNOWN} again and again number ${s}.${p}`
      phrases.push({
        seed_number: s, lego_index: 1,
        known_text: known, target_text: `je vois mot${s} L${p}`,
        phrase_role: 'use', position: 200 + p, target_syllable_count: null, ...audio(`L${s}-${p}`),
      })
    }
  }
  return {
    course_legos: legos,
    course_practice_phrases: phrases,
    course_seeds: seeds,
    courses: [{ course_code: 'tst_for_eng', known_lang: knownLang, target_lang: 'fra' }],
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
  knownLang = 'eng',
  easy: Parameters<typeof generateLearningScript>[6] = {
    reviewMaxKnownSyllables: LIMIT, reviewSyllableFilterMaxRound: 100,
  },
  opts: { longOnly?: boolean } = {},
) => generateLearningScript(
  fakeSupabase(makeCourse(knownLang, opts)),
  'tst_for_eng', 0, { enabled: false, offset: 90 }, DEFAULT_SCRIPT_SHAPE, 1, easy,
)

/** Review and consolidate cycles — the two slot kinds the filter governs. */
const pulled = (items: ScriptItem[]) =>
  items.filter(i => (i.type === 'spaced_rep' || i.type === 'use') && i.reviewItemKind !== 'seed')

afterEach(() => { vi.restoreAllMocks() })

describe('0. the fixture straddles the limit', () => {
  it('short known text is under 15 syllables and long known text is over', () => {
    expect(knownSyllables(`${SHORT_KNOWN} number 1.1`)).toBeLessThanOrEqual(LIMIT)
    expect(knownSyllables(`${LONG_KNOWN} once`)).toBeGreaterThan(LIMIT)
  })
})

describe('1. filterReviewPool — the rule itself', () => {
  const pool = [{ n: 4 }, { n: 20 }, { n: 30 }]
  const filter = { limit: 15, maxRound: 100, syllablesOf: (p: { n: number }) => p.n }

  it('is off when there is no limit', () => {
    expect(filterReviewPool(pool, 1, null)).toBe(pool)
    expect(filterReviewPool(pool, 1, { ...filter, limit: 0 })).toBe(pool)
    expect(filterReviewPool(pool, 1, { ...filter, limit: Infinity })).toBe(pool)
  })

  it('keeps only what is at or under the limit while it is active', () => {
    expect(filterReviewPool(pool, 100, filter)).toEqual([{ n: 4 }])
  })

  it('comes off from the round after maxRound — nothing backlogged', () => {
    expect(filterReviewPool(pool, 101, filter)).toBe(pool)
    expect(filterReviewPool(pool, 5000, filter)).toBe(pool)
  })

  it('falls back to the SHORTEST in the basket when nothing is under the limit', () => {
    const allLong = [{ n: 40 }, { n: 22 }, { n: 31 }]
    expect(filterReviewPool(allLong, 1, filter)).toEqual([{ n: 22 }])
  })

  it('never returns an empty pool', () => {
    expect(filterReviewPool([{ n: 99 }], 1, filter).length).toBe(1)
    expect(filterReviewPool([], 1, filter).length).toBe(0)
  })

  it('lets an uncountable phrase through — the inert path, per phrase', () => {
    const mixed = [{ n: null }, { n: 40 }]
    const nullable = { ...filter, syllablesOf: (p: { n: number | null }) => p.n }
    expect(filterReviewPool(mixed, 1, nullable)).toEqual([{ n: null }])
  })
})

describe('2. end to end — rounds 1-100 filtered, 101 onwards open', () => {
  it('no review or consolidate pull exceeds the limit inside the window', async () => {
    const { items, syllableCapApplied } = await run()
    expect(syllableCapApplied).toBe(true)
    const inWindow = pulled(items).filter(i => i.roundNumber <= 100)
    expect(inWindow.length).toBeGreaterThan(0)
    const over = inWindow.filter(i => knownSyllables(i.knownText) > LIMIT)
    expect(over.map(i => `R${i.roundNumber} ${i.knownText}`)).toEqual([])
  })

  it('the long phrases DO come back from round 101', async () => {
    const { items } = await run()
    const afterWindow = pulled(items).filter(i => i.roundNumber > 100)
    expect(afterWindow.length).toBeGreaterThan(0)
    expect(afterWindow.some(i => knownSyllables(i.knownText) > LIMIT)).toBe(true)
  })

  it('the window boundary is where it says it is', async () => {
    const { items } = await run('eng', { reviewMaxKnownSyllables: LIMIT, reviewSyllableFilterMaxRound: 40 })
    const long = (i: ScriptItem) => knownSyllables(i.knownText) > LIMIT
    expect(pulled(items).filter(i => i.roundNumber <= 40).some(long)).toBe(false)
    expect(pulled(items).filter(i => i.roundNumber > 40).some(long)).toBe(true)
  })

  it('no filter (Fast) meets the long phrases from the very first reviews', async () => {
    const { items, syllableCapApplied } = await run('eng', {})
    expect(syllableCapApplied).toBe(false)
    expect(pulled(items).filter(i => i.roundNumber <= 100).some(i => knownSyllables(i.knownText) > LIMIT)).toBe(true)
  })
})

describe('3. shortest-in-basket fallback — the round is never left empty', () => {
  it('a basket with nothing under the limit still yields its shortest phrase', async () => {
    const { items } = await run('eng', { reviewMaxKnownSyllables: LIMIT, reviewSyllableFilterMaxRound: 100 }, { longOnly: true })
    const inWindow = pulled(items).filter(i => i.roundNumber <= 100)
    // Reviews still happen…
    expect(inWindow.length).toBeGreaterThan(0)
    // …and every one of them is the shortest phrase in its LEGO's basket,
    // which is the `${LONG_KNOWN} once` row.
    const shortest = `${LONG_KNOWN} once`
    for (const i of inWindow.filter(x => x.type === 'spaced_rep')) {
      expect(i.knownText).toBe(shortest)
    }
  })

  it('no LEGO is skipped and no round is emptied by the filter', async () => {
    const filtered = await run('eng', { reviewMaxKnownSyllables: LIMIT, reviewSyllableFilterMaxRound: 100 }, { longOnly: true })
    const unfiltered = await run('eng', {}, { longOnly: true })
    expect(filtered.roundCount).toBe(unfiltered.roundCount)
    expect(filtered.items.length).toBeGreaterThan(0)
  })
})

describe('4. INERT AND LOUD where the known language has no counter', () => {
  it('an unregistered known language warns once, reports not-applied, and filters nothing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const inert = await run('kor')
    const unfiltered = await run('kor', {})

    expect(inert.syllableCapApplied).toBe(false)
    expect(JSON.stringify(inert.items)).toBe(JSON.stringify(unfiltered.items))
    expect(warn.mock.calls.some(c => /INERT/.test(String(c[0])))).toBe(true)
  })

  it('a missing courses row is uncovered, not a crash', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const sb = fakeSupabase({ ...makeCourse('eng'), courses: [] })
    const result = await generateLearningScript(
      sb, 'tst_for_eng', 0, { enabled: false, offset: 90 }, DEFAULT_SCRIPT_SHAPE, 1,
      { reviewMaxKnownSyllables: LIMIT },
    )
    expect(result.syllableCapApplied).toBe(false)
    expect(result.items.length).toBeGreaterThan(0)
  })
})

describe('5. BUILD phrases are never filtered in Easy', () => {
  it('filterBuildPhrases:false keeps the whole BUILD pool under a biting character cap', async () => {
    const tight = 0.4
    const filtered = await generateLearningScript(
      fakeSupabase(makeCourse('eng')), 'tst_for_eng', 0, { enabled: false, offset: 90 },
      DEFAULT_SCRIPT_SHAPE, tight, { filterBuildPhrases: true },
    )
    const unfiltered = await generateLearningScript(
      fakeSupabase(makeCourse('eng')), 'tst_for_eng', 0, { enabled: false, offset: 90 },
      DEFAULT_SCRIPT_SHAPE, tight, { filterBuildPhrases: false },
    )
    const builds = (r: { items: ScriptItem[] }) =>
      r.items.filter(i => i.type === 'build' && (i.knownText || '').startsWith('i want the build')).length
    expect(builds(unfiltered)).toBeGreaterThan(builds(filtered))
  })
})
