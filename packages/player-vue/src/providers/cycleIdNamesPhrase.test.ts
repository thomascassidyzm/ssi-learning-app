/**
 * Job #128. A CYCLE ID HAS TO NAME THE PHRASE IT PLAYS.
 *
 * The walk used to stamp a bare script counter — `S0001L01_build_11827` — and
 * the class brain read the first two digits of that counter as a phrase index,
 * so the Course journey card drew its arcs and its cloth from a sentence the
 * class had never heard. The id now carries the phrase's own role and index
 * exactly as `course_practice_phrases.id` writes them, which is the same shape
 * the bundle path stamps, so ONE parser reads both.
 */
import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { generateLearningScript, phraseCycleId } from './generateLearningScript'

const audio = (n: string) => ({
  known_audio_id: `${n}-k`,
  target1_audio_id: `${n}-t1`,
  target2_audio_id: `${n}-t2`,
  target1_duration_ms: 1000,
  target2_duration_ms: 1000,
})

const LEGOS = [1, 2, 3].map((i) => ({
  seed_number: i,
  lego_index: 1,
  known_text: `chunk ${i}`,
  target_text: `chunk ${i} target`,
  target_text_roman: null,
  type: 'A',
  is_new: true,
  presentation_audio_id: `pres-${i}`,
  ...audio(`lego${i}`),
}))

const PHRASES = LEGOS.flatMap((l) => [
  ...[1, 2, 3, 4].map((n) => ({
    id: `tst_for_eng:S${String(l.seed_number).padStart(4, '0')}L01B${String(n).padStart(2, '0')}`,
    seed_number: l.seed_number,
    lego_index: 1,
    known_text: `build ${l.seed_number}-${n}`,
    target_text: `bau ${l.seed_number}-${n}`,
    phrase_role: 'build',
    position: n,
    target_syllable_count: 2 + n,
    ...audio(`b${l.seed_number}${n}`),
  })),
  ...[1, 2, 3, 4, 5].map((n) => ({
    id: `tst_for_eng:S${String(l.seed_number).padStart(4, '0')}L01U${String(n).padStart(2, '0')}`,
    seed_number: l.seed_number,
    lego_index: 1,
    known_text: `use ${l.seed_number}-${n} in a whole sentence`,
    target_text: `nutz ${l.seed_number}-${n} ganz`,
    phrase_role: 'use',
    position: 10 + n,
    target_syllable_count: 8 + n,
    ...audio(`u${l.seed_number}${n}`),
  })),
])

const SEEDS = LEGOS.map((l) => ({
  seed_number: l.seed_number,
  known_text: `seed ${l.seed_number}`,
  target_text: `saat ${l.seed_number}`,
  target_text_roman: null,
  ...audio(`seed${l.seed_number}`),
}))

const TABLES: Record<string, any[]> = {
  course_legos: LEGOS,
  course_practice_phrases: PHRASES,
  course_seeds: SEEDS,
  course_audio: [],
  lego_introductions: [],
  listening_pod_sentences: [],
}

/** Same minimal chainable stand-in the other walk tests use. */
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

/** The brain's parser, to the letter (api/_utils/classBrain.ts). */
function phraseIdFromCycleId(cycleId: string, courseCode: string): string | null {
  const m = /^(S\d{4}L\d{2})_(build|use)_(\d{2})(?:_|$)/.exec(cycleId)
  return m ? `${courseCode}:${m[1]}${m[2] === 'use' ? 'U' : 'B'}${m[3]}` : null
}

describe('a minted cycle id names its phrase', () => {
  it('stamps the phrase role and index, and the brain reads back the right row', async () => {
    const { items } = await generateLearningScript(fakeSupabase(), 'tst_for_eng', 0, { enabled: false, offset: 90 })
    const byId = new Map(PHRASES.map((p) => [p.id, p]))

    const phraseCycles = items.filter((i) => i.type === 'build' || i.type === 'use' || i.type === 'spaced_rep')
    expect(phraseCycles.length).toBeGreaterThan(0)

    for (const item of phraseCycles) {
      const resolved = phraseIdFromCycleId(item.uuid, 'tst_for_eng')
      // Every phrase cycle names a phrase…
      expect(resolved, `unnamed cycle id: ${item.uuid}`).not.toBeNull()
      // …and it is the phrase that actually played.
      expect(byId.get(resolved!)?.known_text, `wrong phrase named by ${item.uuid}`).toBe(item.knownText)
    }

    // The old form is gone from the walk entirely.
    expect(items.some((i) => /_(build|use)_\d{3,}$/.test(i.uuid))).toBe(false)
    expect(items.some((i) => /_spaced_rep_/.test(i.uuid))).toBe(false)
  })

  it('falls back to the counter-only form when a phrase row has no readable id', () => {
    expect(phraseCycleId('S0001L01', undefined, 'build', 7)).toBe('S0001L01_build_7')
    expect(phraseCycleId('S0001L01', 'tst_for_eng:S0001L01C01', 'build', 7)).toBe('S0001L01_build_7')
    // …which the brain refuses, rather than naming the wrong sentence.
    expect(phraseIdFromCycleId('S0001L01_build_7', 'tst_for_eng')).toBeNull()
  })

  it('mirrors the bundle path, so one parser reads both', () => {
    expect(phraseCycleId('S0042L03', 'tst_for_eng:S0042L03U05', 'review', 9)).toBe('S0042L03_use_05_review_9')
    expect(phraseCycleId('S0042L03', 'tst_for_eng:S0042L03B03', 'build', 2)).toBe('S0042L03_build_03_build_2')
  })
})
