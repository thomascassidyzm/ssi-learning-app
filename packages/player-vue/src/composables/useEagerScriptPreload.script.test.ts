/**
 * The preloaded script must BE the active mode's script.
 *
 * Companion to useEagerScriptPreload.mode.test.ts, which pins the arguments.
 * This one runs the REAL generator on both paths and compares the resulting
 * cycle streams: preloaded-in-Easy against a fresh Easy walk of the same
 * course — the exact comparison the course-switch bug failed, since the
 * preload was handing a Fast script to an Easy learner.
 */
import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { generateLearningScript, DEFAULT_SCRIPT_SHAPE, DEFAULT_LISTENING_CONFIG, scriptItemIdentity } from '../providers/generateLearningScript'
import { easyOptionsForMode, maxPhraseLengthFractionForMode } from '../providers/modeScriptOptions'
import { useEagerScriptPreload } from './useEagerScriptPreload'
import { DEFAULT_EASY, DEFAULT_FAST } from './useAlgorithmConfig'

const audio = (n: string) => ({
  known_audio_id: `${n}-k`,
  target1_audio_id: `${n}-t1`,
  target2_audio_id: `${n}-t2`,
  target1_duration_ms: 1000,
  target2_duration_ms: 1000,
})

const TOTAL_SEEDS = 14

function makeCourse() {
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
        known_text: `i want the build ${s}.${p}`, target_text: `je veux mot ${s} b${p}`,
        phrase_role: 'build', position: p, target_syllable_count: null, ...audio(`b${s}-${p}`),
      })
    }
    for (let p = 1; p <= 6; p++) {
      phrases.push({
        seed_number: s, lego_index: 1,
        known_text: `i can see the use ${s}.${p}`, target_text: `je vois mot ${s} u${p}`,
        phrase_role: 'use', position: 100 + p, target_syllable_count: null, ...audio(`u${s}-${p}`),
      })
    }
  }
  return {
    course_legos: legos,
    course_practice_phrases: phrases,
    course_seeds: seeds,
    courses: [{ course_code: 'tst_for_eng', known_lang: 'eng', target_lang: 'fra' }],
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

/** A fresh, non-preloaded walk — what LearningPlayer's own call sites do. */
const freshWalk = (mode: any) => generateLearningScript(
  fakeSupabase(makeCourse()), 'tst_for_eng', 50,
  DEFAULT_LISTENING_CONFIG, DEFAULT_SCRIPT_SHAPE,
  maxPhraseLengthFractionForMode(mode), easyOptionsForMode(mode), 5,
)

const stream = (result: any) => result.items.map(scriptItemIdentity)

describe('the preloaded script equals a fresh walk in the same mode', () => {
  it('Easy preload === fresh Easy walk, and is NOT the Fast script', async () => {
    const preload = useEagerScriptPreload()
    preload.preload(fakeSupabase(makeCourse()), 'tst_for_eng', {
      modeConfig: DEFAULT_EASY,
      listening: DEFAULT_LISTENING_CONFIG,
      scriptShape: DEFAULT_SCRIPT_SHAPE,
    })
    const preloaded = await preload.scriptPromise.value!

    const easy = await freshWalk(DEFAULT_EASY)
    const fast = await freshWalk(DEFAULT_FAST)

    expect(stream(preloaded)).toEqual(stream(easy))
    // The bug: identical to Fast. Easy doubles the practice cycles, so a
    // preload that still matched Fast would be the regression back.
    expect(stream(preloaded)).not.toEqual(stream(fast))
    expect(preloaded.items.length).toBeGreaterThan(fast.items.length)
  })

  it('Fast preload === fresh Fast walk', async () => {
    const preload = useEagerScriptPreload()
    preload.preload(fakeSupabase(makeCourse()), 'tst_for_eng', {
      modeConfig: DEFAULT_FAST,
      listening: DEFAULT_LISTENING_CONFIG,
      scriptShape: DEFAULT_SCRIPT_SHAPE,
    })
    const preloaded = await preload.scriptPromise.value!

    expect(stream(preloaded)).toEqual(stream(await freshWalk(DEFAULT_FAST)))
  })
})
