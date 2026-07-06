/**
 * Tests for GET /api/courses/:code/cycles
 *
 * Mocks @supabase/supabase-js's createClient — the handler calls
 * supabase.rpc('get_course_cycles_window', ...) for the cycle window and
 * supabase.from('courses')...maybeSingle() for pricing metadata (needed by
 * the entitlement gate, api/_utils/courseAccess.ts).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

process.env.SUPABASE_URL = 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key'
process.env.SUPABASE_ANON_KEY = 'test-anon-key'

interface QueryResult<T> {
  data: T | null
  error: { message: string } | null
}

let tableResponses: Record<string, QueryResult<unknown>> = {}
let rpcResponse: { data: unknown; error: unknown } = { data: null, error: null }
let authUserResponse: { data: { user: { id: string } | null }; error: { message: string } | null } = {
  data: { user: null },
  error: null,
}

function makeBuilder(table: string): unknown {
  const response = tableResponses[table] ?? { data: null, error: null }
  const builder: any = {
    select: () => builder,
    eq: () => builder,
    in: () => builder,
    order: () => builder,
    limit: () => builder,
    maybeSingle: () => Promise.resolve(response),
    single: () => Promise.resolve(response),
    then: (onFulfilled: any) => Promise.resolve(response).then(onFulfilled),
  }
  return builder
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => makeBuilder(table),
    auth: { getUser: () => Promise.resolve(authUserResponse) },
    rpc: () => Promise.resolve(rpcResponse),
  }),
}))

const { default: handler } = await import('../../../../../api/courses/[code]/cycles')

interface FakeRes {
  _status?: number
  _body?: unknown
  _headers: Record<string, string>
  status: (s: number) => FakeRes
  json: (b: unknown) => FakeRes
  setHeader: (k: string, v: string) => void
}

function makeReq(
  query: Record<string, string>,
  method = 'GET',
  headers: Record<string, string> = {},
): any {
  return { method, query, headers }
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

function makeLegoRow(seed: number, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    seed_number: seed,
    lego_index: 1,
    lego_id: `S${String(seed).padStart(4, '0')}L01`,
    type: 'A',
    known_text: `known-${seed}`,
    target_text: `target-${seed}`,
    target_text_roman: null,
    components: null,
    is_new: true,
    known_audio_id: `k-${seed}`,
    target1_audio_id: `t1-${seed}`,
    target2_audio_id: `t2-${seed}`,
    presentation_audio_id: `pres-${seed}`,
    target1_duration_ms: 1000,
    target2_duration_ms: 1000,
    ...overrides,
  }
}

function setupRpcFixture(seeds: number[]) {
  rpcResponse = {
    data: {
      course: { course_code: 'test_course', version: 4 },
      rounds: seeds.map((s, i) => ({
        round_index: i + 1,
        seed_number: s,
        lego_index: 1,
        lego_id: `S${String(s).padStart(4, '0')}L01`,
      })),
      legos: seeds.map((s) => makeLegoRow(s)),
      phrases: [],
    },
    error: null,
  }
}

describe('GET /api/courses/:code/cycles', () => {
  beforeEach(() => {
    tableResponses = {}
    rpcResponse = { data: null, error: null }
    authUserResponse = { data: { user: null }, error: null }
  })

  it('returns cycles for a free-tier course with no gating', async () => {
    setupRpcFixture([1, 2])
    tableResponses.courses = {
      data: { target_lang: 'brz', pricing_tier: 'free', is_community: false },
      error: null,
    }

    const res = makeRes()
    await handler(makeReq({ code: 'test_course', from: 'S0001L01' }), res as any)

    expect(res._status).toBe(200)
    const body = res._body as any
    expect(body.preview_only).toBeUndefined()
    // intro + debut per lego, 2 legos, no phrases = 4 cycles
    expect(body.cycles).toHaveLength(4)
    expect(body.next_lego_id).toBeNull()
  })

  it('denies an unauthenticated caller requesting cycles beyond the free-preview window on a premium course', async () => {
    setupRpcFixture([25])
    tableResponses.courses = {
      data: { target_lang: 'spa', pricing_tier: 'premium', is_community: false },
      error: null,
    }

    const res = makeRes()
    await handler(makeReq({ code: 'premium_course', from: 'S0025L01' }), res as any)

    expect(res._status).toBe(403)
    expect((res._body as any).error).toBe('Subscription required')
  })

  it('slices cycles down to the free-preview window for an unauthenticated caller starting inside it', async () => {
    setupRpcFixture([10, 25])
    tableResponses.courses = {
      data: { target_lang: 'spa', pricing_tier: 'premium', is_community: false },
      error: null,
    }

    const res = makeRes()
    await handler(makeReq({ code: 'premium_course', from: 'S0010L01' }), res as any)

    expect(res._status).toBe(200)
    const body = res._body as any
    expect(body.preview_only).toBe(true)
    // Only seed 10's intro+debut survive; seed 25 is filtered out entirely.
    expect(body.cycles).toHaveLength(2)
    expect(body.cycles.every((c: any) => c.seed_number === 10)).toBe(true)
  })

  it('ships full cycles to an authenticated, actively-subscribed caller on a premium course', async () => {
    setupRpcFixture([10, 25])
    tableResponses.courses = {
      data: { target_lang: 'spa', pricing_tier: 'premium', is_community: false },
      error: null,
    }
    authUserResponse = { data: { user: { id: 'auth-user-1' } }, error: null }
    tableResponses.learners = {
      data: { id: 'learner-1', platform_role: null, educational_role: null },
      error: null,
    }
    tableResponses.subscriptions = { data: { status: 'active', current_period_end: null }, error: null }
    tableResponses.user_entitlements = { data: [], error: null }

    const res = makeRes()
    await handler(
      makeReq({ code: 'premium_course', from: 'S0010L01' }, 'GET', { authorization: 'Bearer faketoken' }),
      res as any,
    )

    expect(res._status).toBe(200)
    const body = res._body as any
    expect(body.preview_only).toBeUndefined()
    expect(body.cycles).toHaveLength(4)
  })

  it('never gates a community course', async () => {
    setupRpcFixture([1, 500])
    tableResponses.courses = {
      data: { target_lang: 'cym', pricing_tier: 'community', is_community: true },
      error: null,
    }

    const res = makeRes()
    await handler(makeReq({ code: 'community_course', from: 'S0500L01' }), res as any)

    expect(res._status).toBe(200)
    const body = res._body as any
    expect(body.preview_only).toBeUndefined()
    expect(body.cycles).toHaveLength(4)
  })
})
