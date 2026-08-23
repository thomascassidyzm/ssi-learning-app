/**
 * GET /api/courses/:code/bundle — the pod visibility gate.
 *
 * WHY THIS FILE EXISTS. `listening_pods.visibility` ('live' | 'held', added
 * 2026-08-23) is enforced in RLS, which closes every learner read that uses the
 * anon key. This route does not: it builds its client from
 * SUPABASE_SERVICE_ROLE_KEY, so RLS does not apply to it, and it is
 * learner-facing — its output is the offline bundle a learner downloads. It was
 * therefore the one path that would still hand a learner the content of a pod a
 * human was mid-way through recording (verified live on 2026-08-23:
 * cym_n_for_eng:pod-0 was held with 231 sentences behind it).
 *
 * The contract held here:
 *  1. a held pod contributes NO pod entry to the bundle, and
 *  2. no sentence of a held pod is fetched at all — the sentence read follows
 *     only the pods that survived the filter, so a held pod's text and audio
 *     ids never reach the response even as orphans.
 *
 * (2) is the one that actually matters. A pod entry could in principle be
 * dropped later in assembly; a sentence query that was never issued cannot leak.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-key'

vi.mock('../../_utils/courseAccess', () => ({
  // Full access: pods are premium-only, so a preview-scoped caller would get
  // an empty pods[] for a reason that has nothing to do with visibility.
  resolveServerCourseAccess: vi.fn(async () => ({
    canAccess: true,
    canPreview: true,
    previewMaxSeed: null,
    reason: null,
  })),
}))

vi.mock('../../_utils/audioAccess', () => ({
  fetchRevisedAudioRefs: vi.fn(async () => new Map()),
  stampRowAudioRefs: (_refs: unknown, rows: unknown[]) => rows,
}))

/**
 * One held pod and one live pod on the same course — the shape that catches a
 * filter applied to the wrong query, or dropped from the sentence read.
 */
const POD_ROWS = [
  { id: 'cym:pod-0', course_code: 'cym', pod_order: 1, title: 'Held', visibility: 'held' },
  { id: 'cym:pod-1', course_code: 'cym', pod_order: 2, title: 'Live', visibility: 'live' },
]

const SENTENCE_ROWS = [
  {
    pod_id: 'cym:pod-0',
    global_order: 1,
    target_text: 'SECRET-HELD-SENTENCE',
    known_text: 'still being recorded',
    target_audio_id: null,
    known_audio_id: null,
    explainer_audio_id: null,
    glue_to_next: false,
  },
  {
    pod_id: 'cym:pod-1',
    global_order: 1,
    target_text: 'released sentence',
    known_text: 'released',
    target_audio_id: null,
    known_audio_id: null,
    explainer_audio_id: null,
    glue_to_next: false,
  },
]

const DB: Record<string, any[]> = {
  courses: [
    { course_code: 'cym', content_version: 3, target_lang: 'cy', pricing_tier: 'free', is_community: true },
  ],
  algorithm_config: [{ key: 'script_shape', config: null, version: 1 }],
  // One round of real course content, because the route 503s on an empty
  // course_round_index before it ever assembles pods.
  course_legos: [
    {
      course_code: 'cym', seed_number: 1, lego_index: 1, type: 'A', known_text: 'yes',
      target_text: 'ie', target_text_roman: null, components: null, is_new: true,
      known_audio_id: null, target1_audio_id: null, target2_audio_id: null,
      presentation_audio_id: null, target1_duration_ms: null, target2_duration_ms: null,
    },
  ],
  course_practice_phrases: [],
  course_round_index: [{ course_code: 'cym', round_index: 1, seed_number: 1, lego_id: 'S0001L01' }],
  course_seeds: [],
  course_audio: [],
  listening_pods: POD_ROWS,
  listening_pod_sentences: SENTENCE_ROWS,
}

/** Every filter each table saw, so the test can assert on the query, not just the output. */
let queries: Array<{ table: string; filters: Record<string, unknown> }> = []

function makeChainable(table: string) {
  let rows: any[] = [...(DB[table] ?? [])]
  const filters: Record<string, unknown> = {}
  queries.push({ table, filters })
  const builder: any = {
    select: () => builder,
    eq: (col: string, val: unknown) => {
      filters[col] = val
      rows = rows.filter((r) => r[col] === val)
      return builder
    },
    in: (col: string, vals: unknown[]) => {
      filters[col] = vals
      rows = rows.filter((r) => vals.includes(r[col]))
      return builder
    },
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

function makeReq(): VercelRequest {
  return { method: 'GET', query: { code: 'cym' }, headers: {} } as any
}

function makeRes(): VercelResponse & { statusCode?: number; body?: any } {
  const res: any = {}
  res.setHeader = vi.fn(() => res)
  res.status = vi.fn((code: number) => { res.statusCode = code; return res })
  res.json = vi.fn((body: any) => { res.body = body; return res })
  return res
}

let handler: typeof import('./bundle').default

beforeEach(async () => {
  queries = []
  vi.resetModules()
  handler = (await import('./bundle')).default
})

describe('bundle route — listening pod visibility', () => {
  it('asks the database only for live pods', async () => {
    const res = makeRes()
    await handler(makeReq(), res)

    const podQuery = queries.find((q) => q.table === 'listening_pods')
    expect(podQuery, 'the route must read listening_pods').toBeDefined()
    expect(podQuery!.filters.visibility).toBe('live')
  })

  it('never fetches a held pod’s sentences', async () => {
    const res = makeRes()
    await handler(makeReq(), res)

    const sentenceQuery = queries.find((q) => q.table === 'listening_pod_sentences')
    expect(sentenceQuery, 'the route must read sentences for the live pod').toBeDefined()
    const requestedPodIds = sentenceQuery!.filters.pod_id as string[]
    expect(requestedPodIds).toEqual(['cym:pod-1'])
    expect(requestedPodIds).not.toContain('cym:pod-0')
  })

  it('omits the held pod from the bundle and keeps the live one', async () => {
    const res = makeRes()
    await handler(makeReq(), res)

    expect(res.statusCode).toBe(200)
    const podIds = (res.body.pods as Array<{ podId: string }>).map((p) => p.podId)
    expect(podIds).toEqual(['cym:pod-1'])
  })

  it('leaks no held sentence text anywhere in the response', async () => {
    const res = makeRes()
    await handler(makeReq(), res)

    expect(JSON.stringify(res.body)).not.toContain('SECRET-HELD-SENTENCE')
  })
})
