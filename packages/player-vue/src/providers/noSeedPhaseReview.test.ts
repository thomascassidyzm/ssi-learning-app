import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { generateLearningScript, DEFAULT_SCRIPT_SHAPE } from './generateLearningScript'
import { toSimpleRounds } from './toSimpleRounds'

// A DRAINED SEED IS NEVER RE-SERVED (Tom, 2026-09-18: "Delete the additional
// SEED once it's dropped out of the Spaced Rep. Because the cups handle it.").
//
// Offsets ≥144 used to carry the SEED-PHASE tier — here the four-slot
// t→k→t→t sandwich (`emitSeedSandwich`), on the bundle path an ordinary
// three-clip production exercise. Both are gone: 89 is the last review a LEGO
// gets, and a seed that has drained out of spaced repetition reaches the
// learner only through the cups listening interlude.
//
// These tests are RED on the pre-ruling generator: it emitted four sandwich
// sub-cycles at round 145 of this 150-seed fixture.

const audio = (n: string) => ({
  known_audio_id: `${n}-k`,
  target1_audio_id: `${n}-t1`,
  target2_audio_id: `${n}-t2`,
  target1_duration_ms: 1000,
  target2_duration_ms: 1000,
})

// One A-LEGO per seed. Needs to run past offset 144 for a seed-phase review.
const TOTAL_SEEDS = 150

function makeCourse() {
  const legos: any[] = []
  const phrases: any[] = []
  const seeds: any[] = []
  for (let s = 1; s <= TOTAL_SEEDS; s++) {
    legos.push({
      seed_number: s, lego_index: 1,
      known_text: `word ${s}`, target_text: `wort ${s}`, target_text_roman: null,
      type: 'A', is_new: true, presentation_audio_id: `pres-${s}`, ...audio(`lego${s}`),
    })
    seeds.push({
      seed_number: s,
      known_text: `sentence ${s}`, target_text: `satz ${s}`, target_text_roman: null,
      ...audio(`seed${s}`),
    })
    for (let p = 1; p <= 5; p++) {
      phrases.push({ seed_number: s, lego_index: 1, known_text: `build ${s}.${p}`, target_text: `bau ${s}.${p}`, phrase_role: 'build', position: p, target_syllable_count: p, ...audio(`b${s}-${p}`) })
      phrases.push({ seed_number: s, lego_index: 1, known_text: `use ${s}.${p}`, target_text: `nutz ${s}.${p}`, phrase_role: 'use', position: 100 + p, target_syllable_count: 6 + p, ...audio(`u${s}-${p}`) })
    }
  }
  return { course_legos: legos, course_practice_phrases: phrases, course_seeds: seeds }
}

function fakeSupabase(tables: Record<string, any[]>): SupabaseClient {
  const all: Record<string, any[]> = {
    course_audio: [], lego_introductions: [], listening_pod_sentences: [], ...tables,
  }
  return {
    from(table: string) {
      const rows = all[table] ?? []
      let headOnly = false
      const builder: any = {
        select(_c?: string, opts?: { count?: string; head?: boolean }) { headOnly = !!opts?.head; return builder },
        then(resolve: (v: any) => any, reject?: (e: any) => any) {
          const value = headOnly ? { data: null, count: rows.length, error: null } : { data: rows, count: rows.length, error: null }
          return Promise.resolve(value).then(resolve, reject)
        },
      }
      for (const m of ['eq', 'in', 'order', 'range', 'limit', 'gte', 'lte', 'not', 'is']) builder[m] = () => builder
      return builder
    },
  } as unknown as SupabaseClient
}

const script = async () =>
  generateLearningScript(fakeSupabase(makeCourse()), 'tst_for_eng', 0, { enabled: false, offset: 90 })

describe('no seed-phase review on the walk', () => {
  it('the shipped offsets stop at 89', () => {
    expect(DEFAULT_SCRIPT_SHAPE.spacedRepOffsets).toEqual([1, 2, 3, 5, 8, 13, 21, 34, 55, 89])
  })

  it('emits no seed-sentence review at any offset, on a course long enough for one', async () => {
    const { items } = await script()
    expect(items.some((i: any) => i.reviewItemKind === 'seed')).toBe(false)
    // The seed sentences themselves never reach a cycle: every seed's text is
    // `sentence N` / `satz N`, and nothing in the script may carry it.
    expect(items.some((i: any) => /^satz \d+$/.test(i.targetText ?? ''))).toBe(false)
  })

  it('no review fires further back than 89 rounds', async () => {
    const { items } = await script()
    const reviews = items.filter((i: any) => i.type === 'spaced_rep' && typeof i.reviewOf === 'number')
    expect(reviews.length).toBeGreaterThan(0)
    for (const r of reviews) {
      expect(r.roundNumber - (r.reviewOf as number)).toBeLessThanOrEqual(89)
    }
  })

  it('no cycle carries the retired sandwich flags once converted to rounds', async () => {
    const { items } = await script()
    const cycles = toSimpleRounds(items).flatMap(r => r.cycles)
    expect(cycles.length).toBeGreaterThan(0)
    expect(cycles.some((c: any) => c.seedSandwich)).toBe(false)
  })
})
