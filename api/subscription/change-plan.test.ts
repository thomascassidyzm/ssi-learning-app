/**
 * POST /api/subscription/change-plan — the Premium → Family upgrade.
 *
 * The bar these tests hold: the upgrade happens IN PLACE on the existing
 * Paddle subscription (one subscription id, a different price, proration left
 * to Paddle), never as a cancel-and-resubscribe and never as a second
 * checkout — which was the £15 + £25 defect this endpoint exists to end.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

process.env.SUPABASE_URL = 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'
process.env.VITE_PADDLE_FAMILY_PRICE_MONTHLY = 'pri_family_monthly\n'
process.env.VITE_PADDLE_FAMILY_PRICE_ANNUAL = 'pri_family_annual'

let authResult: any = { valid: true, userId: 'auth-user-1' }
vi.mock('../_utils/auth', () => ({
  verifyAuthToken: vi.fn(async () => authResult),
}))

let liveSub: any
let updateCalls: any[] = []
let cancelCalls: any[] = []
vi.mock('../_utils/paddle', () => ({
  paddle: {
    subscriptions: {
      get: vi.fn(async () => liveSub),
      update: vi.fn(async (id: string, opts: any) => {
        updateCalls.push({ id, opts })
        return { status: 'active', items: [{ price: { id: opts.items[0].priceId } }] }
      }),
      cancel: vi.fn(async (id: string) => { cancelCalls.push(id) }),
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
  return { method: 'POST', query: {}, headers: { authorization: 'Bearer tok' }, body: { plan: 'family' }, ...overrides } as VercelRequest
}

function makeRes() {
  const res: any = {}
  res.status = vi.fn((code: number) => { res._status = code; return res })
  res.json = vi.fn((body: unknown) => { res._json = body; return res })
  return res as VercelResponse & { _status?: number; _json?: any }
}

const premiumMonthly = () => ({
  status: 'active',
  items: [{ price: { id: 'pri_premium_monthly', billingCycle: { interval: 'month' } }, quantity: 1 }],
})

describe('POST /api/subscription/change-plan', () => {
  let handler: typeof import('./change-plan').default

  beforeEach(async () => {
    vi.resetModules()
    writes = {}
    responders = {}
    updateCalls = []
    cancelCalls = []
    authResult = { valid: true, userId: 'auth-user-1' }
    liveSub = premiumMonthly()
    responders.learners = () => ({ data: { id: 'learner-1' }, error: null })
    responders.subscriptions = () => ({
      data: { id: 'sub-1', provider_subscription_id: 'psub_1', status: 'active', plan_name: 'SSi Premium' },
      error: null,
    })
    handler = (await import('./change-plan')).default
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

  it('404s when the caller has no subscription of their own', async () => {
    responders.subscriptions = () => ({ data: null, error: null })
    const res = makeRes()
    await handler(makeReq(), res)
    expect(res._status).toBe(404)
    expect(updateCalls).toHaveLength(0)
  })

  it('THE UPGRADE: changes the price on the SAME subscription, prorated immediately, and never cancels', async () => {
    const res = makeRes()
    await handler(makeReq(), res)

    expect(res._status).toBe(200)
    expect(res._json).toMatchObject({ ok: true, planName: 'SSi Family', billingPeriod: 'monthly' })
    // One subscription, a new price — not a second subscription, not a cancel.
    expect(updateCalls).toEqual([
      { id: 'psub_1', opts: { items: [{ priceId: 'pri_family_monthly', quantity: 1 }], prorationBillingMode: 'prorated_immediately' } },
    ])
    expect(cancelCalls).toHaveLength(0)
    // Optimistic mirror so the UI reflects Family at once.
    const upd = writes.subscriptions.find((w) => w.op === 'update')!
    expect(upd.payload.plan_name).toBe('SSi Family')
  })

  it('an ANNUAL Premium payer lands on ANNUAL Family — the period comes from Paddle, not from a guess', async () => {
    liveSub = { status: 'active', items: [{ price: { id: 'pri_premium_annual', billingCycle: { interval: 'year' } } }] }
    const res = makeRes()
    await handler(makeReq(), res)
    expect(updateCalls[0].opts.items[0].priceId).toBe('pri_family_annual')
    expect(res._json.billingPeriod).toBe('annual')
  })

  it('a browser-supplied price id is ignored — the price comes from server env only', async () => {
    const res = makeRes()
    await handler(makeReq({ body: { plan: 'family', priceId: 'pri_attacker_1p' } as any }), res)
    expect(updateCalls[0].opts.items[0].priceId).toBe('pri_family_monthly')
  })

  it('a trialing subscription is not billed for the change', async () => {
    liveSub = { status: 'trialing', items: [{ price: { id: 'pri_premium_monthly', billingCycle: { interval: 'month' } } }] }
    const res = makeRes()
    await handler(makeReq(), res)
    expect(updateCalls[0].opts.prorationBillingMode).toBe('do_not_bill')
  })

  it('refuses a past_due subscription with something the payer can act on', async () => {
    responders.subscriptions = () => ({
      data: { id: 'sub-1', provider_subscription_id: 'psub_1', status: 'past_due', plan_name: 'SSi Premium' },
      error: null,
    })
    const res = makeRes()
    await handler(makeReq(), res)
    expect(res._status).toBe(409)
    expect(res._json.error).toMatch(/outstanding payment/i)
    expect(updateCalls).toHaveLength(0)
  })

  it('is a no-op for someone already on Family', async () => {
    responders.subscriptions = () => ({
      data: { id: 'sub-1', provider_subscription_id: 'psub_1', status: 'active', plan_name: 'SSi Family' },
      error: null,
    })
    const res = makeRes()
    await handler(makeReq(), res)
    expect(res._status).toBe(200)
    expect(res._json.alreadyOnPlan).toBe(true)
    expect(updateCalls).toHaveLength(0)
  })

  it('refuses a plan that is not a plain Premium subscription', async () => {
    responders.subscriptions = () => ({
      data: { id: 'sub-1', provider_subscription_id: 'psub_1', status: 'active', plan_name: 'SSi Premium (tutor bundle)' },
      error: null,
    })
    const res = makeRes()
    await handler(makeReq(), res)
    expect(res._status).toBe(409)
    expect(updateCalls).toHaveLength(0)
  })

  it('503s, without touching Paddle, when the Family price is not configured', async () => {
    vi.resetModules()
    const monthly = process.env.VITE_PADDLE_FAMILY_PRICE_MONTHLY
    delete process.env.VITE_PADDLE_FAMILY_PRICE_MONTHLY
    const h = (await import('./change-plan')).default
    const res = makeRes()
    await h(makeReq(), res)
    process.env.VITE_PADDLE_FAMILY_PRICE_MONTHLY = monthly
    expect(res._status).toBe(503)
    expect(updateCalls).toHaveLength(0)
  })
})
