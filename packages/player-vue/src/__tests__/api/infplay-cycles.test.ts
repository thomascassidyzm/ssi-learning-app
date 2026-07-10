/**
 * Tests for GET /api/courses/:code/infplay-cycles
 *
 * INF PLAY is post-main-loop content — reachable only after finishing the
 * free-preview window — so the entitlement gate here is a hard allow/deny,
 * not a preview-slice like cycles.ts/bundle.ts. See api/_utils/courseAccess.ts.
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
let authUserResponse: { data: { user: { id: string } | null }; error: { message: string } | null } = {
  data: { user: null },
  error: null,
}

function makeBuilder(table: string): unknown {
  const response = tableResponses[table] ?? { data: null, error: null }
  const builder: any = {
    select: () => builder,
    eq: () => builder,
    is: () => builder,
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
    rpc: () => Promise.resolve({ data: null, error: null }),
  }),
}))

const { default: handler } = await import('../../../../../api/courses/[code]/infplay-cycles')

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

function setupCourseFixture(overrides: Partial<Record<string, unknown>> = {}) {
  tableResponses = {
    courses: {
      data: {
        content_version: 2,
        target_lang: 'spa',
        pricing_tier: 'premium',
        is_community: false,
        ...overrides,
      },
      error: null,
    },
    course_legos: {
      data: [
        {
          seed_number: 1,
          lego_index: 1,
          known_text: 'hello',
          target_text: 'hola',
          target_text_roman: null,
          known_audio_id: 'k1',
          target1_audio_id: 't1-1',
          target2_audio_id: 't2-1',
          target1_duration_ms: 1000,
          target2_duration_ms: 1000,
        },
      ],
      error: null,
    },
    course_practice_phrases: {
      data: [
        {
          seed_number: 1,
          lego_index: 1,
          position: 1,
          phrase_role: 'use',
          known_text: 'we say hello',
          target_text: 'decimos hola',
          target_text_roman: null,
          known_audio_id: 'uk1',
          target1_audio_id: 'ut1-1',
          target2_audio_id: 'ut2-1',
          target1_duration_ms: 1000,
          target2_duration_ms: 1000,
          decomposition: null,
          display_tiling: null,
        },
      ],
      error: null,
    },
  }
}

describe('GET /api/courses/:code/infplay-cycles', () => {
  beforeEach(() => {
    tableResponses = {}
    authUserResponse = { data: { user: null }, error: null }
  })

  it('denies an unauthenticated caller on a premium course', async () => {
    setupCourseFixture()
    const res = makeRes()
    await handler(makeReq({ code: 'premium_course' }), res as any)

    expect(res._status).toBe(403)
    expect((res._body as any).error).toBe('Subscription required')
  })

  it('denies an authenticated caller with no active subscription or entitlement', async () => {
    setupCourseFixture()
    authUserResponse = { data: { user: { id: 'auth-user-1' } }, error: null }
    tableResponses.learners = {
      data: { id: 'learner-1', platform_role: null, educational_role: null },
      error: null,
    }
    tableResponses.subscriptions = { data: null, error: null }
    tableResponses.user_entitlements = { data: [], error: null }

    const res = makeRes()
    await handler(
      makeReq({ code: 'premium_course' }, 'GET', { authorization: 'Bearer faketoken' }),
      res as any,
    )

    expect(res._status).toBe(403)
  })

  it('ships full INF PLAY cycles to an actively-subscribed caller', async () => {
    setupCourseFixture()
    authUserResponse = { data: { user: { id: 'auth-user-2' } }, error: null }
    tableResponses.learners = {
      data: { id: 'learner-2', platform_role: null, educational_role: null },
      error: null,
    }
    tableResponses.subscriptions = { data: { status: 'active', current_period_end: null }, error: null }
    tableResponses.user_entitlements = { data: [], error: null }

    const res = makeRes()
    await handler(
      makeReq({ code: 'premium_course', limit: '1' }, 'GET', { authorization: 'Bearer faketoken' }),
      res as any,
    )

    expect(res._status).toBe(200)
    const body = res._body as any
    expect(body.cycles.length).toBeGreaterThan(0)
  })

  it('ships full INF PLAY cycles to an ssi_admin regardless of subscription', async () => {
    setupCourseFixture()
    authUserResponse = { data: { user: { id: 'auth-user-3' } }, error: null }
    tableResponses.learners = {
      data: { id: 'learner-3', platform_role: 'ssi_admin', educational_role: null },
      error: null,
    }
    tableResponses.subscriptions = { data: null, error: null }
    tableResponses.user_entitlements = { data: [], error: null }

    const res = makeRes()
    await handler(
      makeReq({ code: 'premium_course', limit: '1' }, 'GET', { authorization: 'Bearer faketoken' }),
      res as any,
    )

    expect(res._status).toBe(200)
  })

  it('never gates a community course, even without auth', async () => {
    setupCourseFixture({ pricing_tier: 'community', is_community: true, target_lang: 'cym' })

    const res = makeRes()
    await handler(makeReq({ code: 'community_course', limit: '1' }), res as any)

    expect(res._status).toBe(200)
    const body = res._body as any
    expect(body.cycles.length).toBeGreaterThan(0)
  })
})
