/**
 * Characterization tests for POST /api/subscription/cancel.
 *
 * Pins CURRENT behavior: method/auth guards, own-learner scoping, the
 * already-cancelled short-circuit, and the optimistic cancel_at_period_end
 * mirror written after Paddle schedules the cancellation. Does NOT assert
 * anything is "correct" — captures what the handler does today.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

process.env.SUPABASE_URL = 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'

let authResult: any = { valid: true, userId: 'auth-user-1' }
vi.mock('../_utils/auth', () => ({
  verifyAuthToken: vi.fn(async () => authResult),
}))

let cancelResult: any
let cancelCalls: any[] = []
vi.mock('../_utils/paddle', () => ({
  paddle: {
    subscriptions: {
      cancel: vi.fn(async (id: string, opts: any) => {
        cancelCalls.push({ id, opts })
        return cancelResult
      }),
    },
  },
}))

let writes: Record<string, any[]> = {}
let responders: Record<string, (calls: any[][]) => any> = {}

function recordWrite(table: string, op: string, payload: unknown) {
  writes[table] = writes[table] || []
  writes[table].push({ op, payload })
}

function makeChainable(table: string) {
  const calls: any[][] = []
  const builder: any = {
    select: (c: string) => { calls.push(['select', c]); return builder },
    insert: (o: unknown) => { calls.push(['insert', o]); recordWrite(table, 'insert', o); return builder },
    update: (o: unknown) => { calls.push(['update', o]); recordWrite(table, 'update', o); return builder },
    upsert: (o: unknown) => { calls.push(['upsert', o]); recordWrite(table, 'upsert', o); return builder },
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
  return { method: 'POST', query: {}, headers: { authorization: 'Bearer tok' }, body: {}, ...overrides } as VercelRequest
}

function makeRes() {
  const res: any = {}
  res.status = vi.fn((code: number) => { res._status = code; return res })
  res.json = vi.fn((body: unknown) => { res._json = body; return res })
  return res as VercelResponse & { _status?: number; _json?: any }
}

describe('POST /api/subscription/cancel', () => {
  let handler: typeof import('./cancel').default

  beforeEach(async () => {
    vi.resetModules()
    writes = {}
    responders = {}
    authResult = { valid: true, userId: 'auth-user-1' }
    cancelResult = { currentBillingPeriod: { endsAt: '2026-08-01T00:00:00Z' } }
    cancelCalls = []
    handler = (await import('./cancel')).default
  })

  it('rejects a non-POST method', async () => {
    const res = makeRes()
    await handler(makeReq({ method: 'GET' }), res)
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
    expect(res._json.error).toBe('No active subscription')
  })

  it('404s when the learner has no subscription with a provider id', async () => {
    responders.learners = () => ({ data: { id: 'learner-1' }, error: null })
    responders.subscriptions = () => ({ data: { id: 'sub-1', provider_subscription_id: null, status: 'active' }, error: null })
    const res = makeRes()
    await handler(makeReq(), res)
    expect(res._status).toBe(404)
  })

  it('short-circuits (no Paddle call, no write) when the subscription is already cancelled', async () => {
    responders.learners = () => ({ data: { id: 'learner-1' }, error: null })
    responders.subscriptions = () => ({ data: { id: 'sub-1', provider_subscription_id: 'psub_1', status: 'cancelled' }, error: null })
    const res = makeRes()
    await handler(makeReq(), res)
    expect(res._status).toBe(200)
    expect(res._json).toEqual({ ok: true, alreadyCancelled: true })
    expect(cancelCalls).toHaveLength(0)
    expect(writes.subscriptions).toBeUndefined()
  })

  it('own-scope success: schedules end-of-period cancel and optimistically mirrors cancel_at_period_end', async () => {
    responders.learners = (calls) => {
      // Scoped to the caller's own learner by auth user id.
      expect(calls.some((c) => c[0] === 'eq' && c[1] === 'user_id' && c[2] === 'auth-user-1')).toBe(true)
      return { data: { id: 'learner-1' }, error: null }
    }
    responders.subscriptions = () => ({ data: { id: 'sub-1', provider_subscription_id: 'psub_1', status: 'active' }, error: null })
    const res = makeRes()
    await handler(makeReq(), res)

    expect(res._status).toBe(200)
    expect(res._json).toEqual({ ok: true, effectiveAt: '2026-08-01T00:00:00Z' })
    // Paddle scheduled cancel at next billing period on the caller's own sub.
    expect(cancelCalls).toEqual([{ id: 'psub_1', opts: { effectiveFrom: 'next_billing_period' } }])
    // Optimistic local mirror.
    const upd = writes.subscriptions.find((w) => w.op === 'update')!
    expect(upd.payload.cancel_at_period_end).toBe(true)
  })

  it('500s when the Paddle cancel call throws', async () => {
    responders.learners = () => ({ data: { id: 'learner-1' }, error: null })
    responders.subscriptions = () => ({ data: { id: 'sub-1', provider_subscription_id: 'psub_1', status: 'active' }, error: null })
    const paddle = (await import('../_utils/paddle')).paddle as any
    paddle.subscriptions.cancel.mockRejectedValueOnce(new Error('paddle down'))
    const res = makeRes()
    await handler(makeReq(), res)
    expect(res._status).toBe(500)
  })
})
