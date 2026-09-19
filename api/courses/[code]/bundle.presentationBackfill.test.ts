/**
 * GET /api/courses/:code/bundle — the presentation-audio backfill does not
 * hand the player an id that names no audio (job #256, 2026-09-19).
 *
 * cym_s_for_eng's three LEGOs with no `course_legos.presentation_audio_id` —
 * S0006L01, S0041L01, S0154L02 — each have a 2025 `lego_introductions` row
 * naming an `audio_uuid` that exists in neither `course_audio` nor
 * `shared_audio`. The bundle backfilled from it on trust, the intro prompt
 * became `/api/audio/62889c49-…`, the proxy answered 404 with a JSON body, and
 * the element refused it: MEDIA_ERR_SRC_NOT_SUPPORTED, `readyState 0`, intro
 * skipped. 96 failures in the week to 19 September, 35 of the 36 learners who
 * reached it, both platforms, five builds.
 *
 * A `course_audio` row is its own proof of existence. A legacy id is checked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-key'

vi.mock('../../_utils/courseAccess', () => ({
  resolveServerCourseAccess: vi.fn(async () => ({
    canAccess: true, canPreview: true, previewMaxSeed: null, reason: null,
  })),
}))
vi.mock('../../_utils/audioAccess', () => ({
  fetchRevisedAudioRefs: vi.fn(async () => new Map()),
  stampRowAudioRefs: (_refs: unknown, rows: unknown[]) => rows,
  // The backfill stamps its ids through this — leaving it out makes the
  // backfill throw into its own non-fatal catch and every assertion here pass
  // for the wrong reason.
  applyAudioRef: (_refs: unknown, id: string | null | undefined) => id ?? undefined,
}))

/** One LEGO, no presentation link — exactly the shape that hits the backfill. */
const baseDB = (): Record<string, any[]> => ({
  courses: [{ course_code: 'cym', content_version: 3, target_lang: 'cy', pricing_tier: 'free', is_community: true }],
  algorithm_config: [{ key: 'script_shape', config: null, version: 1 }],
  course_legos: [{
    course_code: 'cym', seed_number: 1, lego_index: 1, type: 'A', known_text: 'yes',
    target_text: 'ie', target_text_roman: null, components: null, is_new: true,
    known_audio_id: 'known-clip', target1_audio_id: 't1', target2_audio_id: 't2',
    presentation_audio_id: null, target1_duration_ms: 900, target2_duration_ms: 900,
  }],
  course_practice_phrases: [],
  course_round_index: [{ course_code: 'cym', round_index: 1, seed_number: 1, lego_id: 'S0001L01' }],
  course_seeds: [],
  course_audio: [],
  lego_introductions: [],
  listening_pods: [],
  listening_pod_sentences: [],
})

let DB: Record<string, any[]> = baseDB()

function makeChainable(table: string) {
  let rows: any[] = [...(DB[table] ?? [])]
  const builder: any = {
    select: () => builder,
    eq: (col: string, val: unknown) => { rows = rows.filter((r) => r[col] === val); return builder },
    in: (col: string, vals: unknown[]) => { rows = rows.filter((r) => vals.includes(r[col])); return builder },
    is: (col: string, val: unknown) => { rows = rows.filter((r) => (r[col] ?? null) === val); return builder },
    order: () => builder,
    range: () => Promise.resolve({ data: rows, error: null }),
    maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
    single: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
    then: (resolve: any) => Promise.resolve({ data: rows, error: null }).then(resolve),
  }
  return builder
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: (table: string) => makeChainable(table) }),
}))

const makeReq = () => ({ method: 'GET', query: { code: 'cym' }, headers: {} }) as unknown as VercelRequest
function makeRes(): VercelResponse & { statusCode?: number; body?: any } {
  const res: any = {}
  res.setHeader = vi.fn(() => res)
  res.status = vi.fn((code: number) => { res.statusCode = code; return res })
  res.json = vi.fn((body: any) => { res.body = body; return res })
  return res
}

let handler: typeof import('./bundle').default
const presentationOf = async () => {
  const res = makeRes()
  await handler(makeReq(), res)
  return res.body.legos?.[0]?.ephemeralAudio?.presentation ?? null
}

beforeEach(async () => {
  DB = baseDB()
  vi.resetModules()
  handler = (await import('./bundle')).default
})

describe('bundle presentation backfill — a legacy id is checked', () => {
  it('ignores a lego_introductions id that names audio in no audio table', async () => {
    DB.lego_introductions = [
      { course_code: 'cym', lego_id: 'S0001L01', presentation_audio_id: null, audio_uuid: 'dangling-uuid' },
    ]
    expect(await presentationOf()).toBeFalsy()
  })

  it('still backfills when the legacy id really does name audio', async () => {
    DB.lego_introductions = [
      { course_code: 'cym', lego_id: 'S0001L01', presentation_audio_id: null, audio_uuid: 'real-uuid' },
    ]
    // lego_id deliberately null: only the LEGACY link can reach this row, so a
    // pass here is the legacy path working, not the lego_id-match last resort.
    DB.course_audio = [{ id: 'real-uuid', lego_id: null, role: 'presentation', s3_key: 'mastered/REAL.mp3', course_code: 'cym', duration_ms: 4000 }]
    expect((await presentationOf())?.id).toBe('real-uuid')
  })
})
