/**
 * Tests for GET /api/courses/:code/bundle
 *
 * Mocks @supabase/supabase-js's createClient so the handler thinks it's
 * talking to a real Supabase instance, then asserts the wire shape
 * matches the CourseBundle contract.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// Env must be set BEFORE importing the handler — the module throws on
// load otherwise (mirrors the pattern in api/courses/[code]/cycles.ts).
process.env.SUPABASE_URL = 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key'

// ---------------------------------------------------------------------------
// Supabase mock — the handler chains:
//   client.from(table).select(...).eq(...).eq(...).in(...).order(...).order(...)
//        .maybeSingle?()
// Each link in the chain returns the same builder; awaiting it (or calling
// maybeSingle()) resolves to { data, error }. We let the test set up the
// resolved payload per-table via `mockTable()`.
// ---------------------------------------------------------------------------

interface QueryResult<T> {
  data: T | null
  error: { message: string } | null
}

let tableResponses: Record<string, QueryResult<unknown>> = {}
let lastFromCalls: string[] = []

function makeBuilder(table: string): unknown {
  const response = tableResponses[table] ?? { data: null, error: null }
  // bundle.ts paginates course_practice_phrases via a { count:'exact', head:true }
  // count query followed by .range() pages. Surface a count derived from the
  // mocked array length and support .range() so the full mocked set comes back.
  const withCount = {
    ...response,
    count: Array.isArray((response as QueryResult<unknown[]>).data)
      ? (response as QueryResult<unknown[]>).data!.length
      : null,
  }
  const builder: any = {
    select: () => builder,
    eq: () => builder,
    in: () => builder,
    order: () => builder,
    limit: () => builder,
    range: () => builder,
    maybeSingle: () => Promise.resolve(response),
    single: () => Promise.resolve(response),
    then: (onFulfilled: any) => Promise.resolve(withCount).then(onFulfilled),
  }
  return builder
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => {
      lastFromCalls.push(table)
      return makeBuilder(table)
    },
  }),
}))

// Dynamic import so the mock is in place first.
const { default: handler } = await import('../../../../../api/courses/[code]/bundle')

// ---------------------------------------------------------------------------
// Fake Vercel req/res
// ---------------------------------------------------------------------------

interface FakeRes {
  _status?: number
  _body?: unknown
  _headers: Record<string, string>
  status: (s: number) => FakeRes
  json: (b: unknown) => FakeRes
  setHeader: (k: string, v: string) => void
}

function makeReq(query: Record<string, string>, method = 'GET'): any {
  return { method, query }
}

function makeRes(): FakeRes {
  const res: FakeRes = {
    _headers: {},
    status(s: number) {
      this._status = s
      return this
    },
    json(b: unknown) {
      this._body = b
      return this
    },
    setHeader(k: string, v: string) {
      this._headers[k] = v
    },
  }
  return res
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function setupHappyFixture() {
  tableResponses = {
    courses: { data: { content_version: 7 }, error: null },
    course_legos: {
      data: [
        {
          seed_number: 1,
          lego_index: 1,
          type: 'A',
          known_text: 'hello',
          target_text: 'hola',
          target_text_roman: null,
          components: null,
          is_new: true,
          known_audio_id: 'aud-known-1',
          target1_audio_id: 'aud-t1-1',
          target2_audio_id: 'aud-t2-1',
          presentation_audio_id: 'aud-pres-1',
          known_duration_ms: 800,
          target1_duration_ms: 1200,
          target2_duration_ms: 1100,
          presentation_duration_ms: 2000,
        },
        {
          seed_number: 2,
          lego_index: 1,
          type: 'M',
          known_text: 'good morning',
          target_text: 'おはよう',
          target_text_roman: 'ohayou',
          components: [
            { known: 'good', target: 'お' },
            { known: 'morning', target: 'はよう' },
          ],
          is_new: true,
          known_audio_id: 'aud-known-2',
          target1_audio_id: 'aud-t1-2',
          target2_audio_id: null, // missing — should be omitted
          presentation_audio_id: null,
          known_duration_ms: null,
          target1_duration_ms: 1500,
          target2_duration_ms: null,
          presentation_duration_ms: null,
        },
      ],
      error: null,
    },
    course_practice_phrases: {
      data: [
        // lego 1: two builds and one use
        {
          seed_number: 1,
          lego_index: 1,
          position: 1,
          phrase_role: 'build',
          known_text: 'i say hello',
          target_text: 'digo hola',
          target_text_roman: null,
          decomposition: null,
          known_audio_id: 'b1k',
          target1_audio_id: 'b1t1',
          target2_audio_id: 'b1t2',
          known_duration_ms: 900,
          target1_duration_ms: 1300,
          target2_duration_ms: 1300,
        },
        {
          seed_number: 1,
          lego_index: 1,
          position: 2,
          phrase_role: 'practice', // legacy alias → 'build'
          known_text: 'she says hello',
          target_text: 'dice hola',
          target_text_roman: null,
          decomposition: [
            { legoId: 'S0001L01', target: 'hola', known: 'hello', isGhost: false },
          ],
          known_audio_id: 'b2k',
          target1_audio_id: 'b2t1',
          target2_audio_id: 'b2t2',
          known_duration_ms: 900,
          target1_duration_ms: 1300,
          target2_duration_ms: 1300,
        },
        {
          seed_number: 1,
          lego_index: 1,
          position: 1,
          phrase_role: 'use',
          known_text: 'we say hello to everyone',
          target_text: 'decimos hola a todos',
          target_text_roman: null,
          decomposition: null,
          known_audio_id: 'u1k',
          target1_audio_id: 'u1t1',
          target2_audio_id: 'u1t2',
          known_duration_ms: 1100,
          target1_duration_ms: 1700,
          target2_duration_ms: 1700,
        },
        // lego 2: one eternal_eligible (→ use) with romanised text
        {
          seed_number: 2,
          lego_index: 1,
          position: 1,
          phrase_role: 'eternal_eligible',
          known_text: 'good morning everyone',
          target_text: 'みなさん、おはよう',
          target_text_roman: 'minasan, ohayou',
          decomposition: null,
          known_audio_id: 'u2k',
          target1_audio_id: 'u2t1',
          target2_audio_id: null, // missing — should be omitted from audio
          known_duration_ms: null,
          target1_duration_ms: 1800,
          target2_duration_ms: null,
        },
      ],
      error: null,
    },
    course_round_index: {
      data: [
        { round_index: 1, seed_number: 1, lego_id: 'S0001L01' },
        { round_index: 2, seed_number: 2, lego_id: 'S0002L01' },
      ],
      error: null,
    },
    listening_pods: {
      data: [
        { id: 'spa_for_eng_v2:pod-0', pod_order: null, title: 'Spanish Pod 0' },
      ],
      error: null,
    },
    course_audio: {
      data: [
        { id: 'intro-aud', role: 'bookend_listen_intro', duration_ms: 2100 },
        { id: 'outro-aud', role: 'bookend_listen_outro', duration_ms: 2500 },
      ],
      error: null,
    },
    listening_pod_sentences: {
      data: [
        {
          pod_id: 'spa_for_eng_v2:pod-0',
          global_order: 1,
          target_text: 'hola',
          known_text: 'hello',
          target_audio_id: 'pod-s1-tgt',
          known_audio_id: 'pod-s1-kn',
          glue_to_next: false,
        },
        {
          pod_id: 'spa_for_eng_v2:pod-0',
          global_order: 2,
          target_text: 'adios',
          known_text: 'goodbye',
          target_audio_id: 'pod-s2-tgt',
          known_audio_id: null,
          glue_to_next: true,
        },
      ],
      error: null,
    },
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/courses/:code/bundle', () => {
  beforeEach(() => {
    tableResponses = {}
    lastFromCalls = []
  })

  it('returns a well-formed CourseBundle for the happy path', async () => {
    setupHappyFixture()
    const req = makeReq({ code: 'spa_for_eng_v2' })
    const res = makeRes()
    await handler(req, res as any)

    expect(res._status).toBe(200)
    expect(res._headers['Cache-Control']).toBe(
      'private, max-age=300, s-maxage=86400, stale-while-revalidate=86400',
    )

    const bundle = res._body as any
    expect(bundle.courseCode).toBe('spa_for_eng_v2')
    expect(bundle.version).toBe(7)
    expect(bundle.mainLoopCount).toBe(2)
    expect(bundle.legos).toHaveLength(2)
    expect(bundle.phrases).toHaveLength(4)
    expect(bundle.seeds).toHaveLength(2)
    expect(bundle.roundMap).toHaveLength(2)

    // LEGO 1 — atomic, no romanisation, all 4 ephemeral audio refs present.
    const lego1 = bundle.legos[0]
    expect(lego1.legoId).toBe('S0001L01')
    expect(lego1.seedId).toBe('S0001')
    expect(lego1.seedNumber).toBe(1)
    expect(lego1.legoIndex).toBe(1)
    expect(lego1.type).toBe('A')
    expect(lego1.targetText).toBe('hola')
    expect(lego1.targetTextNative).toBeUndefined()
    expect(lego1.components).toBeUndefined()
    expect(lego1.isNew).toBe(true)
    // known + presentation audio refs have no durationMs because the
    // course_legos / course_practice_phrases tables only carry target1
    // and target2 duration columns (see bundle.ts notes on LegoRow).
    expect(lego1.ephemeralAudio.known).toEqual({
      id: 'aud-known-1',
      lifecycle: 'ephemeral',
    })
    expect(lego1.ephemeralAudio.target1).toEqual({
      id: 'aud-t1-1',
      lifecycle: 'ephemeral',
      durationMs: 1200,
    })
    expect(lego1.ephemeralAudio.target2.id).toBe('aud-t2-1')
    expect(lego1.ephemeralAudio.presentation.id).toBe('aud-pres-1')

    // Seeds derived from the round map, preserving order.
    expect(bundle.seeds).toEqual([
      { seedId: 'S0001', seedNumber: 1 },
      { seedId: 'S0002', seedNumber: 2 },
    ])

    // Round map shape.
    expect(bundle.roundMap[0]).toEqual({
      roundIndex: 1,
      legoId: 'S0001L01',
      seedNumber: 1,
    })

    // Querying hit the right tables. listening_pod_sentences is fetched
    // sequentially (depends on which pod ids exist) — included here too.
    // Assert the unique SET (course_practice_phrases is queried twice now:
    // once for the count, once for the paginated range).
    expect([...new Set(lastFromCalls)].sort()).toEqual(
      [
        'courses',
        'course_legos',
        'course_practice_phrases',
        'course_round_index',
        'listening_pods',
        'course_audio',
        'listening_pod_sentences',
      ].sort(),
    )

    // Pods shape: one pod with two sentences, intro+outro inlined from
    // course_audio.
    expect(bundle.pods).toHaveLength(1)
    const pod = bundle.pods[0]
    expect(pod.podId).toBe('spa_for_eng_v2:pod-0')
    expect(pod.podOrder).toBe(0) // pod_order was null → coerced to 0
    expect(pod.title).toBe('Spanish Pod 0')
    expect(pod.introAudio).toEqual({
      id: 'intro-aud',
      lifecycle: 'persistent',
      durationMs: 2100,
    })
    expect(pod.outroAudio).toEqual({
      id: 'outro-aud',
      lifecycle: 'persistent',
      durationMs: 2500,
    })
    expect(pod.sentences).toHaveLength(2)
    expect(pod.sentences[0]).toEqual({
      globalOrder: 1,
      knownText: 'hello',
      targetText: 'hola',
      glueToNext: false,
      targetAudio: { id: 'pod-s1-tgt', lifecycle: 'persistent' },
      knownAudio: { id: 'pod-s1-kn', lifecycle: 'persistent' },
    })
    // Sentence 2 has no known_audio_id — knownAudio must be absent, not null.
    expect(pod.sentences[1].targetAudio.id).toBe('pod-s2-tgt')
    expect('knownAudio' in pod.sentences[1]).toBe(false)
    expect(pod.sentences[1].glueToNext).toBe(true)
  })

  it('normalises legacy phrase roles (practice → build, eternal_eligible → use)', async () => {
    setupHappyFixture()
    const res = makeRes()
    await handler(makeReq({ code: 'spa_for_eng_v2' }), res as any)

    const bundle = res._body as any
    // Practice phrase becomes a build with the right lifecycle.
    const phraseBuild2 = bundle.phrases.find((p: any) => p.phraseId === 'S0001L01_build_02')
    expect(phraseBuild2).toBeDefined()
    expect(phraseBuild2.role).toBe('build')
    expect(phraseBuild2.audio.known.lifecycle).toBe('ephemeral')
    // decomposition is served verbatim when present — parity with
    // cycles.ts / infplay-cycles.ts (the player's tile-rendering path).
    expect(phraseBuild2.decomposition).toEqual([
      { legoId: 'S0001L01', target: 'hola', known: 'hello', isGhost: false },
    ])

    // eternal_eligible becomes a use with persistent lifecycle.
    const phraseUse2 = bundle.phrases.find((p: any) => p.legoId === 'S0002L01')
    expect(phraseUse2).toBeDefined()
    expect(phraseUse2.role).toBe('use')
    expect(phraseUse2.audio.known.lifecycle).toBe('persistent')
    expect(phraseUse2.audio.target1.lifecycle).toBe('persistent')
  })

  it('handles target_text_roman correctly (both branches)', async () => {
    setupHappyFixture()
    const res = makeRes()
    await handler(makeReq({ code: 'spa_for_eng_v2' }), res as any)

    const bundle = res._body as any

    // LEGO 1: no roman → target_text is shown, no native field.
    const lego1 = bundle.legos[0]
    expect(lego1.targetText).toBe('hola')
    expect(lego1.targetTextNative).toBeUndefined()

    // LEGO 2: romanised → roman is shown, native script in targetTextNative.
    const lego2 = bundle.legos[1]
    expect(lego2.targetText).toBe('ohayou')
    expect(lego2.targetTextNative).toBe('おはよう')

    // Same pattern on phrases.
    const phraseUse2 = bundle.phrases.find((p: any) => p.legoId === 'S0002L01')
    expect(phraseUse2.targetText).toBe('minasan, ohayou')
    expect(phraseUse2.targetTextNative).toBe('みなさん、おはよう')
  })

  it('omits BundleAudioRef entirely when the underlying audio id is null', async () => {
    setupHappyFixture()
    const res = makeRes()
    await handler(makeReq({ code: 'spa_for_eng_v2' }), res as any)

    const bundle = res._body as any

    // LEGO 2 has no target2 or presentation audio — they must be absent.
    const lego2 = bundle.legos[1]
    expect(lego2.ephemeralAudio.known.id).toBe('aud-known-2')
    expect(lego2.ephemeralAudio.target1.id).toBe('aud-t1-2')
    expect('target2' in lego2.ephemeralAudio).toBe(false)
    expect('presentation' in lego2.ephemeralAudio).toBe(false)

    // LEGO 2's use phrase has no target2 audio.
    const phraseUse2 = bundle.phrases.find((p: any) => p.legoId === 'S0002L01')
    expect(phraseUse2.audio.known.id).toBe('u2k')
    expect(phraseUse2.audio.target1.id).toBe('u2t1')
    expect('target2' in phraseUse2.audio).toBe(false)
  })

  it('uses deterministic phrase ids (legoId_role_position)', async () => {
    setupHappyFixture()
    const res = makeRes()
    await handler(makeReq({ code: 'spa_for_eng_v2' }), res as any)

    const bundle = res._body as any
    const phraseIds = bundle.phrases.map((p: any) => p.phraseId).sort()
    expect(phraseIds).toEqual([
      'S0001L01_build_01',
      'S0001L01_build_02',
      'S0001L01_use_01',
      'S0002L01_use_01',
    ])

    // Position is 1-based and resets per (legoId, role).
    const build1 = bundle.phrases.find((p: any) => p.phraseId === 'S0001L01_build_01')
    const build2 = bundle.phrases.find((p: any) => p.phraseId === 'S0001L01_build_02')
    expect(build1.position).toBe(1)
    expect(build2.position).toBe(2)
    const use1 = bundle.phrases.find((p: any) => p.phraseId === 'S0001L01_use_01')
    expect(use1.position).toBe(1) // resets for the 'use' bucket
  })

  it('returns 404 with no-store when course does not exist', async () => {
    tableResponses = {
      courses: { data: null, error: null },
      course_legos: { data: [], error: null },
      course_practice_phrases: { data: [], error: null },
      course_round_index: { data: [], error: null },
    }
    const res = makeRes()
    await handler(makeReq({ code: 'nonexistent' }), res as any)

    expect(res._status).toBe(404)
    expect(res._headers['Cache-Control']).toBe('no-store')
  })

  it('returns 503 with no-store when round-index is empty for an existing course', async () => {
    tableResponses = {
      courses: { data: { content_version: 1 }, error: null },
      course_legos: { data: [], error: null },
      course_practice_phrases: { data: [], error: null },
      course_round_index: { data: [], error: null },
    }
    const res = makeRes()
    await handler(makeReq({ code: 'unrefreshed' }), res as any)

    expect(res._status).toBe(503)
    expect(res._headers['Cache-Control']).toBe('no-store')
  })

  it('rejects non-GET methods with 405', async () => {
    const res = makeRes()
    await handler(makeReq({ code: 'spa_for_eng_v2' }, 'POST'), res as any)
    expect(res._status).toBe(405)
  })

  it('rejects invalid course codes with 400', async () => {
    const res = makeRes()
    await handler(makeReq({ code: 'Spanish v2!' }), res as any)
    expect(res._status).toBe(400)
  })
})
