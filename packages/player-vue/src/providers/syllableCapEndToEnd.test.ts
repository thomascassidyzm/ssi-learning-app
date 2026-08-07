/**
 * The absolute syllable cap, END TO END through generateLearningScript
 * (Tom, 2026-08-07: "we should probably just skip all phrases that are more
 * than X number of syllables").
 *
 * The unit-level rules live in maxPhraseSyllables.test.ts. This file pins the
 * four things that can only be proved with the whole generator in the loop:
 *   1. FAST IS UNCHANGED — no syllable cap ⇒ output identical to the run with
 *      the parameter absent entirely, long phrases and all.
 *   2. Easy drops a phrase above the threshold and keeps one below it.
 *   3. An uncovered target language (kor) leaves the cap INERT and warns —
 *      it does not throw, and it does not empty the phrase pool.
 *   4. The starvation guard still returns the floor count when the cap would
 *      starve a LEGO.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { generateLearningScript, DEFAULT_SCRIPT_SHAPE, type ScriptItem } from './generateLearningScript'
import { MIN_USE_PHRASES_AFTER_CAP } from '../composables/useAlgorithmConfig'

const audio = (n: string) => ({
  known_audio_id: `${n}-k`,
  target1_audio_id: `${n}-t1`,
  target2_audio_id: `${n}-t2`,
  target1_duration_ms: 1000,
  target2_duration_ms: 1000,
})

/**
 * Two French phrases per LEGO whose syllable counts straddle the thresholds
 * under test, counted by the canonical counter (@ssi/core/text). As emitted
 * (each carries a trailing "<seed><index>" token worth one more nucleus):
 *   SHORT  "je ne sais pas use 11"                             =  6 syllables
 *   LONG   "je n'ai pas oublié ce qui s'est passé la dernière
 *           fois qu'ils nous ont rendu visite 11"              = 25 syllables
 * target_syllable_count is deliberately LEFT NULL on every row — that is the
 * production reality (1.3% of 818,220 rows have one), so these tests exercise
 * the counter path, not the stored-value path.
 *
 * usePerLego defaults to 6 so that the SHORT phrases alone clear the
 * MIN_USE_PHRASES_AFTER_CAP floor of 5. Provision fewer and the starvation
 * guard correctly hands a long phrase back — which is its own test below,
 * not a leak.
 */
const SHORT_TARGET = 'je ne sais pas'
const LONG_TARGET = "je n'ai pas oublié ce qui s'est passé la dernière fois qu'ils nous ont rendu visite"

const TOTAL_SEEDS = 12

/** `usePerLego` short + `usePerLego` long USE phrases on every LEGO. */
function makeCourse(targetLang: string, usePerLego = 6, longPerLego = usePerLego) {
  const legos: any[] = []
  const phrases: any[] = []
  const seeds: any[] = []
  for (let s = 1; s <= TOTAL_SEEDS; s++) {
    legos.push({
      seed_number: s, lego_index: 1,
      known_text: `word ${s}`, target_text: `mot ${s}`, target_text_roman: null,
      type: 'A', is_new: true, presentation_audio_id: `pres-${s}`, ...audio(`lego${s}`),
    })
    seeds.push({
      seed_number: s, known_text: `sentence ${s}`, target_text: `phrase ${s}`,
      target_text_roman: null, ...audio(`seed${s}`),
    })
    for (let p = 1; p <= 5; p++) {
      phrases.push({
        seed_number: s, lego_index: 1,
        known_text: `build ${s}.${p}`, target_text: `${SHORT_TARGET} ${s}${p}`,
        phrase_role: 'build', position: p, target_syllable_count: null, ...audio(`b${s}-${p}`),
      })
    }
    for (let p = 1; p <= usePerLego; p++) {
      phrases.push({
        seed_number: s, lego_index: 1,
        known_text: `use short ${s}.${p}`, target_text: `${SHORT_TARGET} use ${s}${p}`,
        phrase_role: 'use', position: 100 + p, target_syllable_count: null, ...audio(`us${s}-${p}`),
      })
    }
    for (let p = 1; p <= longPerLego; p++) {
      phrases.push({
        seed_number: s, lego_index: 1,
        known_text: `use long ${s}.${p}`, target_text: `${LONG_TARGET} ${s}${p}`,
        phrase_role: 'use', position: 200 + p, target_syllable_count: null, ...audio(`ul${s}-${p}`),
      })
    }
  }
  return {
    course_legos: legos,
    course_practice_phrases: phrases,
    course_seeds: seeds,
    courses: [{ course_code: 'tst_for_eng', target_lang: targetLang }],
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
        // The courses lookup is a single row — mirror PostgREST's shape.
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

/** `maxSyllables === undefined` OMITS the argument entirely. */
const run = (
  targetLang: string,
  maxSyllables?: number,
  { usePerLego = 6, longPerLego = usePerLego, charFraction = 1 }:
    { usePerLego?: number; longPerLego?: number; charFraction?: number } = {},
) => {
  const sb = fakeSupabase(makeCourse(targetLang, usePerLego, longPerLego))
  const args = [sb, 'tst_for_eng', 0, { enabled: false, offset: 90 }, DEFAULT_SCRIPT_SHAPE, charFraction] as const
  return maxSyllables === undefined
    ? generateLearningScript(...args)
    : generateLearningScript(...args, maxSyllables)
}

const targetsOf = (items: ScriptItem[]) => items.map(i => i.targetText)
const longCount = (items: ScriptItem[]) => targetsOf(items).filter(t => t.startsWith(LONG_TARGET)).length
const shortUseCount = (items: ScriptItem[]) =>
  items.filter(i => (i.knownText || '').startsWith('use short')).length

afterEach(() => { vi.restoreAllMocks() })

describe('1. FAST IS PROVABLY UNCHANGED', () => {
  it('a no-cap run is identical to the run with the argument absent entirely', async () => {
    const omitted = await run('fra')          // parameter never passed
    const zero = await run('fra', 0)          // DEFAULT_FAST.maxPhraseSyllables
    // Deep equality over the WHOLE script — every item, every field, in order.
    expect(JSON.stringify(zero.items)).toBe(JSON.stringify(omitted.items))
    expect(zero.cycleCount).toBe(omitted.cycleCount)
    expect(zero.roundCount).toBe(omitted.roundCount)
    expect(zero.mainLoopRoundCount).toBe(omitted.mainLoopRoundCount)
  })

  it('every invalid cap value also reproduces the untouched script', async () => {
    const omitted = JSON.stringify((await run('fra')).items)
    for (const bad of [0, -1, NaN, Infinity]) {
      expect(JSON.stringify((await run('fra', bad)).items)).toBe(omitted)
    }
  })

  it('Fast still meets the 25-syllable phrases, and reports the cap as not applied', async () => {
    const fast = await run('fra', 0)
    expect(longCount(fast.items)).toBeGreaterThan(0)
    expect(fast.syllableCapApplied).toBe(false)
  })
})

describe('2. Easy drops what is above the threshold and keeps what is below', () => {
  it('a 20-syllable cap removes the 25-syllable phrases and keeps the 6-syllable ones', async () => {
    const easy = await run('fra', 20)
    expect(easy.syllableCapApplied).toBe(true)
    expect(longCount(easy.items)).toBe(0)          // 25 > 20 — gone everywhere,
                                                   // debut fills AND spaced rep
    expect(shortUseCount(easy.items)).toBeGreaterThan(0)  // 4 <= 20 — kept
  })

  it('a cap ABOVE both lengths changes nothing — the threshold is what bites', async () => {
    const uncapped = await run('fra', 0)
    const generous = await run('fra', 40)          // both phrases are under 40
    expect(generous.syllableCapApplied).toBe(true) // applied, just not binding
    expect(JSON.stringify(generous.items)).toBe(JSON.stringify(uncapped.items))
  })

  it('the script still plays: dropping the long phrases does not empty the course', async () => {
    const easy = await run('fra', 20)
    expect(easy.items.length).toBeGreaterThan(0)
    expect(easy.roundCount).toBe((await run('fra', 0)).roundCount)
  })
})

describe('3. an UNCOVERED target language leaves the cap INERT and warns', () => {
  it('kor does not throw, does not empty the pool, and reports not-applied', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const kor = await run('kor', 20)
    const uncapped = await run('kor', 0)

    // INERT: identical to the uncapped run, long phrases still present.
    expect(JSON.stringify(kor.items)).toBe(JSON.stringify(uncapped.items))
    expect(longCount(kor.items)).toBeGreaterThan(0)
    // and LOUD about it — both in the flag and on the console.
    expect(kor.syllableCapApplied).toBe(false)
    expect(warn.mock.calls.some(c => /INERT/.test(String(c[0])))).toBe(true)
  })

  it('a missing courses row is uncovered, not a crash', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const sb = fakeSupabase({ ...makeCourse('fra'), courses: [] })
    const result = await generateLearningScript(
      sb, 'tst_for_eng', 0, { enabled: false, offset: 90 }, DEFAULT_SCRIPT_SHAPE, 1, 20,
    )
    expect(result.syllableCapApplied).toBe(false)
    expect(result.items.length).toBeGreaterThan(0)
    expect(longCount(result.items)).toBeGreaterThan(0)
  })
})

describe('4. the STARVATION GUARD still wins over the syllable cap', () => {
  it('a cap that would starve a LEGO returns the floor count instead of nothing', async () => {
    // Cap of 2 syllables is below EVERY phrase in the fixture (shortest is 4),
    // so on its own it would empty every pool. The floor must hold.
    const starved = await run('fra', 2)
    expect(starved.syllableCapApplied).toBe(true)
    expect(starved.items.length).toBeGreaterThan(0)

    // The guard hands back the shortest MIN_USE_PHRASES_AFTER_CAP, which are
    // the SHORT ones — so shorts survive AND the pool is never emptied.
    // "Fewer phrases is a FAIL" is the hard rail; the cap yields to it.
    expect(shortUseCount(starved.items)).toBeGreaterThan(0)
    expect(MIN_USE_PHRASES_AFTER_CAP).toBe(5)
  })

  it('the guard, not the cap, decides when survivors fall under the floor', () => {
    // The boundary case, stated plainly because it looks like a leak and is
    // not: with only 4 short USE phrases per LEGO, a 20-syllable cap leaves 4
    // survivors — one under the floor of 5 — so the guard returns the shortest
    // 5 instead, and the 5th is necessarily a LONG phrase the cap had excluded.
    // That is the hard rail winning, exactly as specified.
    return run('fra', 20, { usePerLego: 4 }).then((underProvisioned) => {
      expect(longCount(underProvisioned.items)).toBeGreaterThan(0)
      expect(underProvisioned.syllableCapApplied).toBe(true)
    })
  })

  it('the guard holds when BOTH caps are at their tightest', async () => {
    const both = await run('fra', 2, { charFraction: 0.01 })
    expect(both.items.length).toBeGreaterThan(0)
  })
})
