/**
 * Characterization tests for GET /api/subscription/portal.
 *
 * Pins CURRENT behavior: method/auth guards, own-learner scoping, the
 * no-customer 404, the Paddle customer-portal session creation and the
 * portal-URL extraction (incl. the 500 when Paddle returns no URL).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

process.env.SUPABASE_URL = 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'

let authResult: any = { valid: true, userId: 'auth-user-1' }
vi.mock('../_utils/auth', () => ({
  verifyAuthToken: vi.fn(async () => authResult),
}))

let sessionResult: any
let createCalls: any[] = []
vi.mock('../_utils/paddle', () => ({
  paddle: {
    customerPortalSessions: {
      create: vi.fn(async (customerId: string, subIds: string[]) => {
        createCalls.push({ customerId, subIds })
        return sessionResult
      }),
    },
  },
}))

let responders: Record<string, (calls: any[][]) => any> = {}

function makeChainable(table: string) {
  const calls: any[][] = []
  const builder: any = {
    select: (c: string) => { calls.push(['select', c]); return builder },
    eq: (col: string, val: unknown) => { calls.push(['eq', col, val]); return builder },
    resolve: () => {
      const respond = responders[table]
      if (respond) { const r = respond(calls); if (r !== undefined) return r }
      return { data: null, error: null }
    },
    maybeSingle() { return Promise.resolve(this.resolve()) },
    single() { return Promise.resolve(this.resolve()) },
    then(onF: any, onR: any) { return Promise.resolve(this.resolve()).then(onF, onR) },
  }
  return builder
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: (table: string) => makeChainable(table) }),
}))

function makeReq(overrides: Partial<VercelRequest> = {}): VercelRequest {
  return { method: 'GET', query: {}, headers: { authorization: 'Bearer tok' } , ...overrides } as VercelRequest
}

function makeRes() {
  const res: any = {}
  res.status = vi.fn((code: number) => { res._status = code; return res })
  res.json = vi.fn((body: unknown) => { res._json = body; return res })
  return res as VercelResponse & { _status?: number; _json?: any }
}

describe('GET /api/subscription/portal', () => {
  let handler: typeof import('./portal').default

  beforeEach(async () => {
    vi.resetModules()
    responders = {}
    authResult = { valid: true, userId: 'auth-user-1' }
    sessionResult = { urls: { general: { overview: 'https://paddle.example/portal/abc' } } }
    createCalls = []
    handler = (await import('./portal')).default
  })

  it('rejects a non-GET method', async () => {
    const res = makeRes()
    await handler(makeReq({ method: 'POST' }), res)
    expect(res._status).toBe(405)
  })

  it('rejects an unauthenticated caller', async () => {
    authResult = { valid: false, error: 'nope' }
    const res = makeRes()
    await handler(makeReq(), res)
    expect(res._status).toBe(401)
  })

  it('404s when the caller has no learner row', async () => {
    responders.learners = () => ({ data: null, error: null })
    const res = makeRes()
    await handler(makeReq(), res)
    expect(res._status).toBe(404)
  })

  it('404s when the subscription has no provider_customer_id', async () => {
    responders.learners = () => ({ data: { id: 'learner-1' }, error: null })
    responders.subscriptions = () => ({ data: { provider_customer_id: null, provider_subscription_id: null }, error: null })
    const res = makeRes()
    await handler(makeReq(), res)
    expect(res._status).toBe(404)
  })

  it('own-scope success: creates a portal session for the caller and returns the overview URL', async () => {
    responders.learners = (calls) => {
      expect(calls.some((c) => c[0] === 'eq' && c[1] === 'user_id' && c[2] === 'auth-user-1')).toBe(true)
      return { data: { id: 'learner-1' }, error: null }
    }
    responders.subscriptions = () => ({ data: { provider_customer_id: 'ctm_1', provider_subscription_id: 'psub_1' }, error: null })
    const res = makeRes()
    await handler(makeReq(), res)

    expect(res._status).toBe(200)
    expect(res._json).toEqual({ portalUrl: 'https://paddle.example/portal/abc' })
    expect(createCalls).toEqual([{ customerId: 'ctm_1', subIds: ['psub_1'] }])
  })

  it('passes an empty subscription-id list when the sub has no provider_subscription_id', async () => {
    responders.learners = () => ({ data: { id: 'learner-1' }, error: null })
    responders.subscriptions = () => ({ data: { provider_customer_id: 'ctm_1', provider_subscription_id: null }, error: null })
    const res = makeRes()
    await handler(makeReq(), res)
    expect(res._status).toBe(200)
    expect(createCalls[0].subIds).toEqual([])
  })

  it('500s when Paddle returns no portal URL', async () => {
    responders.learners = () => ({ data: { id: 'learner-1' }, error: null })
    responders.subscriptions = () => ({ data: { provider_customer_id: 'ctm_1', provider_subscription_id: 'psub_1' }, error: null })
    sessionResult = { urls: { general: {} } }
    const res = makeRes()
    await handler(makeReq(), res)
    expect(res._status).toBe(500)
  })
})
