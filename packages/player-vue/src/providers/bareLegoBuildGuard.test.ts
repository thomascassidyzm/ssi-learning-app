import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { generateLearningScript } from './generateLearningScript'

// A BUILD is the new LEGO plugged into ALREADY-KNOWN vocabulary — never the
// LEGO on its own (ralph-methodology.md, 2026-02-05). Some courses carry a
// build row whose text equals its own LEGO (real case: deu_for_eng S0001L01,
// "I want / ich will"). The debut already played it, so replaying it as a BUILD
// both breaks the rule and burns one of the 7 build slots.

const audio = (n: string) => ({
  known_audio_id: `${n}-k`,
  target1_audio_id: `${n}-t1`,
  target2_audio_id: `${n}-t2`,
  target1_duration_ms: 1000,
  target2_duration_ms: 1000,
})

const LEGO = {
  seed_number: 1,
  lego_index: 1,
  known_text: 'I want',
  target_text: 'ich will',
  target_text_roman: null,
  type: 'M',
  is_new: true,
  presentation_audio_id: 'pres-1',
  ...audio('lego'),
}

// One bare-LEGO build row (identical text to the LEGO) followed by 8 real
// BUILD phrases — more than MAX_BUILD_PHRASES (7), so the bare row displaces a
// real one if it is allowed through.
const REAL_BUILDS = [
  'lernen',
  'sprechen',
  'anfangen',
  'aufhören',
  'es versuchen',
  'nach Hause gehen',
  'Deutsch sprechen',
  'heute Abend lernen',
]

const PHRASES = [
  {
    seed_number: 1,
    lego_index: 1,
    // Same text as the LEGO, modulo the punctuation/case that getPhraseId normalises.
    known_text: 'I Want.',
    target_text: 'Ich will.',
    phrase_role: 'build',
    position: 0,
    target_syllable_count: 2,
    ...audio('bare'),
  },
  ...REAL_BUILDS.map((t, i) => ({
    seed_number: 1,
    lego_index: 1,
    known_text: `I want ${t}`,
    target_text: `ich will ${t}`,
    phrase_role: 'build',
    position: i + 1,
    target_syllable_count: 4 + i,
    ...audio(`b${i}`),
  })),
  ...[1, 2, 3, 4, 5].map((i) => ({
    seed_number: 1,
    lego_index: 1,
    known_text: `I want to use it ${i}`,
    target_text: `ich will es benutzen ${i}`,
    phrase_role: 'use',
    position: 100 + i,
    target_syllable_count: 8 + i,
    ...audio(`u${i}`),
  })),
]

const SEEDS = [
  {
    seed_number: 1,
    known_text: 'I want to learn German',
    target_text: 'ich will Deutsch lernen',
    target_text_roman: null,
    ...audio('seed'),
  },
]

const TABLES: Record<string, any[]> = {
  course_legos: [LEGO],
  course_practice_phrases: PHRASES,
  course_seeds: SEEDS,
  course_audio: [],
  lego_introductions: [],
  listening_pod_sentences: [],
}

/**
 * Minimal chainable stand-in for the supabase-js query builder: every filter /
 * order / range call is a no-op that returns `this`, and awaiting the builder
 * resolves to the whole table. `head: true` returns a count instead, which is
 * what fetchAllPracticePhrases' pagination probe needs.
 */
function fakeSupabase(tables: Record<string, any[]> = TABLES): SupabaseClient {
  return {
    from(table: string) {
      const rows = tables[table] ?? []
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

const run = () =>
  generateLearningScript(
    fakeSupabase(),
    'deu_for_eng',
    0, // no infinite-play tail — the main walk is what's under test
    { enabled: false, offset: 90 },
  )

describe('BUILD phase never replays the bare LEGO', () => {
  it('omits the build row whose text equals its own LEGO', async () => {
    const { items } = await run()
    const builds = items.filter((i) => i.type === 'build' && i.legoKey === 'S0001L01')

    expect(builds.some((b) => b.knownText === 'I Want.')).toBe(false)
    // The debut still teaches the LEGO itself.
    expect(items.some((i) => i.type === 'debut' && i.knownText === 'I want')).toBe(true)
  })

  it('gives the freed slot to a real BUILD phrase, still filling all 7', async () => {
    const { items } = await run()
    const builds = items.filter((i) => i.type === 'build' && i.legoKey === 'S0001L01')

    expect(builds).toHaveLength(7)
    // Without the guard the bare row eats slot 1 and the 7th real phrase
    // ("Deutsch sprechen") never plays.
    expect(builds.map((b) => b.knownText)).toEqual(
      REAL_BUILDS.slice(0, 7).map((t) => `I want ${t}`),
    )
  })
})
