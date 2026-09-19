/**
 * A LEGACY NARRATION ID IS NOT PROOF OF A NARRATION (job #256, 2026-09-19).
 *
 * `course_legos.presentation_audio_id` is NULL for three cym_s_for_eng LEGOs,
 * so the generator backfills from a 2025 `lego_introductions` row — and all
 * three of those rows name an `audio_uuid` that exists in neither
 * `course_audio` nor `shared_audio`. `/api/audio/<id>` answers 404 with a JSON
 * body, the element refuses it (MEDIA_ERR_SRC_NOT_SUPPORTED, readyState 0),
 * and the intro was skipped: 96 failures on S0006L01_intro in one week, 35 of
 * the 36 learners who reached it.
 *
 * A `course_audio` row is its own proof of existence. A legacy id has to be
 * checked, and one that resolves to nothing is ignored — the intro then
 * prompts with the LEGO's known clip, which is the documented degradation.
 */
import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { generateLearningScript } from './generateLearningScript'

const audio = (n: string) => ({
  known_audio_id: `${n}-k`,
  target1_audio_id: `${n}-t1`,
  target2_audio_id: `${n}-t2`,
  target1_duration_ms: 1000,
  target2_duration_ms: 1000,
})

/** Two seeds, one A-LEGO each, NEITHER carrying a presentation link. */
function makeCourse() {
  const legos: any[] = []
  const phrases: any[] = []
  const seeds: any[] = []
  for (let s = 1; s <= 2; s++) {
    legos.push({
      seed_number: s, lego_index: 1, known_text: `word ${s}`, target_text: `gair ${s}`,
      target_text_roman: null, type: 'A', is_new: true, presentation_audio_id: null,
      ...audio(`lego${s}`),
    })
    seeds.push({
      seed_number: s, known_text: `sentence ${s}`, target_text: `brawddeg ${s}`,
      target_text_roman: null, ...audio(`seed${s}`),
    })
    for (let p = 1; p <= 5; p++) {
      phrases.push({
        seed_number: s, lego_index: 1, known_text: `build ${s}.${p}`, target_text: `bau ${s}.${p}`,
        phrase_role: 'build', position: p, target_syllable_count: p, ...audio(`b${s}-${p}`),
      })
      phrases.push({
        seed_number: s, lego_index: 1, known_text: `use ${s}.${p}`, target_text: `nutz ${s}.${p}`,
        phrase_role: 'use', position: 100 + p, target_syllable_count: 6 + p, ...audio(`u${s}-${p}`),
      })
    }
  }
  return { course_legos: legos, course_practice_phrases: phrases, course_seeds: seeds }
}

/**
 * Filter-aware supabase stand-in — `eq`/`in` actually filter, which is the
 * whole point here: the existence check IS a filtered query, and a fake that
 * ignores filters would answer "it exists" for everything. Rows without the
 * filtered column are left alone (the other queries in the generator don't
 * carry a course_code on their fixtures).
 */
function fakeSupabase(tables: Record<string, any[]>): SupabaseClient {
  const all: Record<string, any[]> = {
    course_audio: [], lego_introductions: [], listening_pod_sentences: [], ...tables,
  }
  return {
    from(table: string) {
      let rows = all[table] ?? []
      let headOnly = false
      const builder: any = {
        select(_c?: string, opts?: { count?: string; head?: boolean }) {
          headOnly = !!opts?.head
          return builder
        },
        eq(col: string, val: unknown) {
          rows = rows.filter((r) => !(col in r) || r[col] === val)
          return builder
        },
        in(col: string, vals: unknown[]) {
          rows = rows.filter((r) => !(col in r) || vals.includes(r[col]))
          return builder
        },
        then(resolve: (v: any) => any, reject?: (e: any) => any) {
          const value = headOnly
            ? { data: null, count: rows.length, error: null }
            : { data: rows, count: rows.length, error: null }
          return Promise.resolve(value).then(resolve, reject)
        },
      }
      for (const m of ['order', 'range', 'limit', 'gte', 'lte', 'not', 'is']) builder[m] = () => builder
      return builder
    },
  } as unknown as SupabaseClient
}

const introFor = async (tables: Record<string, any[]>) => {
  const script = await generateLearningScript(
    fakeSupabase({ ...makeCourse(), ...tables }), 'cym_s_for_eng', 0, { enabled: false, offset: 90 },
  )
  const items: any[] = (script as any).items ?? script
  return items.find((i: any) => i.type === 'intro' && i.legoKey === 'S0001L01')
}

describe('presentation backfill from lego_introductions', () => {
  it('ignores a legacy id that names audio which does not exist', async () => {
    const intro = await introFor({
      lego_introductions: [
        { course_code: 'cym_s_for_eng', lego_id: 'S0001L01', presentation_audio_id: null, audio_uuid: 'dangling-uuid' },
      ],
      course_audio: [],
    })
    expect(intro).toBeTruthy()
    // Not backfilled from the dangling id: the prompt falls to the LEGO's own
    // known clip, which does exist.
    expect(intro.presentationAudioId).not.toBe('dangling-uuid')
    expect(intro.presentationAudioId ?? intro.knownAudioId).toBe('lego1-k')
  })

  it('still uses a legacy id when the audio really is there', async () => {
    const intro = await introFor({
      lego_introductions: [
        { course_code: 'cym_s_for_eng', lego_id: 'S0001L01', presentation_audio_id: null, audio_uuid: 'real-uuid' },
      ],
      course_audio: [{ id: 'real-uuid' }],
    })
    expect(intro.presentationAudioId).toBe('real-uuid')
  })
})
