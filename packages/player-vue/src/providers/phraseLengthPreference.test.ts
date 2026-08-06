import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { generateLearningScript, DEFAULT_SCRIPT_SHAPE } from './generateLearningScript'

// phraseLengthPreference (Easy/Fast mode contract, 2026-08-06).
//
// BUILD and USE phrases are sorted by target syllable count and then TRUNCATED
// at maxBuildPhrases, so the sort DIRECTION decides which phrases a learner
// actually meets. 'shortest' is the default and reproduces the pre-2026-08-06
// behaviour exactly; 'longest' reverses both twin sorts so the longest phrases
// survive the cut — Tom's "longest possible phrase" knob.

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

// 10 BUILD phrases at syllable counts 3..12 — more than maxBuildPhrases (7),
// so the truncation is what the preference has to bite on.
const BUILD_SYLLABLES = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12]

const PHRASES = [
  ...BUILD_SYLLABLES.map((syl, i) => ({
    seed_number: 1,
    lego_index: 1,
    known_text: `I want build ${syl}`,
    target_text: `ich will bauen ${syl}`,
    phrase_role: 'build',
    position: i,
    target_syllable_count: syl,
    ...audio(`b${i}`),
  })),
  ...[4, 6, 8, 10, 12].map((syl, i) => ({
    seed_number: 1,
    lego_index: 1,
    known_text: `I want to use it ${syl}`,
    target_text: `ich will es benutzen ${syl}`,
    phrase_role: 'use',
    position: 100 + i,
    target_syllable_count: syl,
    ...audio(`u${i}`),
  })),
]

const TABLES: Record<string, any[]> = {
  course_legos: [LEGO],
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

const run = (pref?: 'shortest' | 'longest') =>
  generateLearningScript(
    fakeSupabase(),
    'deu_for_eng',
    0,
    { enabled: false, offset: 90 },
    DEFAULT_SCRIPT_SHAPE,
    pref,
  )

const buildSyllables = (items: Array<{ type: string; legoKey?: string; syllableCount?: number }>) =>
  items
    .filter((i) => i.type === 'build' && i.legoKey === 'S0001L01')
    .map((i) => i.syllableCount!)

describe('phraseLengthPreference', () => {
  it("defaults to 'shortest' — the shortest phrases survive truncation", async () => {
    const { items } = await run()
    const syls = buildSyllables(items)
    expect(syls.length).toBeGreaterThan(0)
    expect(syls).toEqual([...syls].sort((a, b) => a - b))
    // The long tail is what got cut.
    expect(Math.max(...syls)).toBeLessThan(12)
  })

  it('omitting the argument matches passing shortest explicitly', async () => {
    expect(buildSyllables((await run()).items)).toEqual(
      buildSyllables((await run('shortest')).items),
    )
  })

  it("'longest' reverses the sort so the longest phrases survive", async () => {
    const { items } = await run('longest')
    const syls = buildSyllables(items)
    expect(syls.length).toBeGreaterThan(0)
    expect(syls).toEqual([...syls].sort((a, b) => b - a))
    // The longest phrase in the inventory now makes the cut; under 'shortest'
    // it was truncated away.
    expect(Math.max(...syls)).toBe(12)
    expect(Math.max(...buildSyllables((await run('shortest')).items))).toBeLessThan(12)
  })
})
