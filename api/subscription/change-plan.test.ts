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
import { familyCoverEndsAt } from '../_utils/familyGrace'

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
// Errors Paddle should throw, one per update() call, in order. An entry of
// null means that call succeeds.
let updateErrors: any[] = []
vi.mock('../_utils/paddle', () => ({
  paddle: {
    subscriptions: {
      get: vi.fn(async () => liveSub),
      update: vi.fn(async (id: string, opts: any) => {
        updateCalls.push({ id, opts })
        const err = updateErrors.shift()
        if (err) throw err
        return { status: 'active', items: [{ price: { id: opts.items[0].priceId } }] }
      }),
      cancel: vi.fn(async (id: string) => { cancelCalls.push(id) }),
    },
  },
}))

let endsMails: any[] = []
vi.mock('../_utils/familyInviteEmail', () => ({
  safeInviterName: (n: string | null) => n,
  sendFamilyEndsEmail: vi.fn(async (input: any) => { endsMails.push(input); return { sent: true, id: 'mail-1' } }),
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
    is: (col: string, val: unknown) => { calls.push(['is', col, val]); return builder },
    in: (col: string, vals: unknown) => { calls.push(['in', col, vals]); return builder },
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
    updateErrors = []
    cancelCalls = []
    endsMails = []
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

  it('a proration too small for Paddle to bill still changes the plan, unbilled', async () => {
    // Real, reproduced against live Paddle on 2026-09-07: two days from
    // renewal the £15 → £25 delta was 53p against a 55p minimum, and Paddle
    // refused the entire update. Before this fallback the payer got a 500 and
    // stayed on Premium.
    updateErrors = [
      Object.assign(new Error('Unable to charge for Subscription update: Transaction balance is less than what we can charge.'), {
        code: 'subscription_update_transaction_balance_less_than_charge_limit',
      }),
    ]
    const res = makeRes()
    await handler(makeReq(), res)
    expect(res._status).toBe(200)
    // and it reports the mode that ACTUALLY ran, not the one we asked for
    expect(res._json).toMatchObject({ ok: true, planName: 'SSi Family', prorationBillingMode: 'do_not_bill' })
    expect(updateCalls).toHaveLength(2)
    expect(updateCalls[0].opts.prorationBillingMode).toBe('prorated_immediately')
    expect(updateCalls[1].opts.prorationBillingMode).toBe('do_not_bill')
    expect(updateCalls[1].opts.items[0].priceId).toBe('pri_family_monthly')
    expect(cancelCalls).toHaveLength(0)
  })

  it('any other Paddle failure is surfaced, never retried unbilled', async () => {
    updateErrors = [Object.assign(new Error('Something else went wrong'), { code: 'some_other_error' })]
    const res = makeRes()
    await handler(makeReq(), res)
    expect(res._status).toBe(500)
    expect(updateCalls).toHaveLength(1)
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

// ── THE DOWNGRADE (job #376·F, D2/D4/D6/D9) ──────────────────────────────────
const PERIOD_END = '2026-10-07T23:41:26.033896Z'
const familyMonthly = () => ({
  status: 'active',
  items: [{ price: { id: 'pri_family_monthly', billingCycle: { interval: 'month' } }, quantity: 1 }],
})
function familyRow(overrides: Record<string, unknown> = {}) {
  return () => ({
    data: {
      id: 'sub-fam',
      provider_subscription_id: 'psub_fam',
      status: 'active',
      plan_name: 'SSi Family',
      current_period_end: PERIOD_END,
      cancel_at_period_end: false,
      scheduled_plan_name: null,
      scheduled_plan_at: null,
      ...overrides,
    },
    error: null,
  })
}
const PREMIUM_MONTHLY = 'pri_01kqq85gvncyasfmfvvpcv1xfg'
const PREMIUM_ANNUAL = 'pri_01kqq86ymc3yhm8be3w7f7kgr1'

describe('POST /api/subscription/change-plan — Family → Premium, held for the period end', () => {
  let handler: typeof import('./change-plan').default

  beforeEach(async () => {
    vi.resetModules()
    writes = {}
    responders = {}
    updateCalls = []
    updateErrors = []
    cancelCalls = []
    endsMails = []
    authResult = { valid: true, userId: 'auth-user-1' }
    liveSub = familyMonthly()
    responders.learners = () => ({ data: { id: 'learner-owner', display_name: 'Tom' }, error: null })
    responders.subscriptions = familyRow()
    responders.family_members = () => ({ data: [], error: null })
    handler = (await import('./change-plan')).default
  })

  it('THE DOWNGRADE: writes the schedule FIRST, then moves the same subscription onto Premium with do_not_bill', async () => {
    const res = makeRes()
    await handler(makeReq({ body: { plan: 'premium' } }), res)

    expect(res._status).toBe(200)
    expect(res._json).toMatchObject({
      ok: true,
      planName: 'SSi Family',
      scheduledPlanName: 'SSi Premium',
      scheduledPlanAt: PERIOD_END,
      billingPeriod: 'monthly',
      prorationBillingMode: 'do_not_bill',
    })
    // The row keeps SSi Family; only the schedule is written.
    const upd = writes.subscriptions.filter((w) => w.op === 'update')
    expect(upd).toHaveLength(1)
    expect(upd[0].payload).toMatchObject({ scheduled_plan_name: 'SSi Premium', scheduled_plan_at: PERIOD_END })
    expect(upd[0].payload).not.toHaveProperty('plan_name')
    // One Paddle write, unbilled, on the Premium price — never a cancel.
    expect(updateCalls).toEqual([
      { id: 'psub_fam', opts: { items: [{ priceId: PREMIUM_MONTHLY, quantity: 1 }], prorationBillingMode: 'do_not_bill' } },
    ])
    expect(cancelCalls).toHaveLength(0)
  })

  it('an ANNUAL Family payer lands on ANNUAL Premium', async () => {
    liveSub = { status: 'active', items: [{ price: { id: 'pri_family_annual', billingCycle: { interval: 'year' } } }] }
    const res = makeRes()
    await handler(makeReq({ body: { plan: 'premium' } }), res)
    expect(updateCalls[0].opts.items[0].priceId).toBe(PREMIUM_ANNUAL)
    expect(res._json.billingPeriod).toBe('annual')
  })

  it('CANCEL WINS: a subscription already set to end is refused, and Paddle is not touched', async () => {
    responders.subscriptions = familyRow({ cancel_at_period_end: true })
    const res = makeRes()
    await handler(makeReq({ body: { plan: 'premium' } }), res)
    expect(res._status).toBe(409)
    expect(updateCalls).toHaveLength(0)
    expect(writes.subscriptions ?? []).toHaveLength(0)
  })

  it('refuses a plain Premium row asking for Premium', async () => {
    responders.subscriptions = familyRow({ plan_name: 'SSi Premium' })
    const res = makeRes()
    await handler(makeReq({ body: { plan: 'premium' } }), res)
    expect(res._status).toBe(409)
    expect(updateCalls).toHaveLength(0)
  })

  it('when Paddle refuses, the schedule is cleared again and nothing has changed', async () => {
    updateErrors = [Object.assign(new Error('boom'), { code: 'some_other_error' })]
    const res = makeRes()
    await handler(makeReq({ body: { plan: 'premium' } }), res)
    expect(res._status).toBe(500)
    const upd = writes.subscriptions.filter((w) => w.op === 'update')
    expect(upd).toHaveLength(2)
    expect(upd[1].payload).toMatchObject({ scheduled_plan_name: null, scheduled_plan_at: null })
  })

  it('is a no-op when the change is already scheduled', async () => {
    responders.subscriptions = familyRow({ scheduled_plan_name: 'SSi Premium', scheduled_plan_at: PERIOD_END })
    const res = makeRes()
    await handler(makeReq({ body: { plan: 'premium' } }), res)
    expect(res._status).toBe(200)
    expect(res._json.alreadyScheduled).toBe(true)
    expect(updateCalls).toHaveLength(0)
  })

  it('tells every live ADULT member by email at confirm — not the child, not the pending invitee', async () => {
    responders.family_members = () => ({
      data: [
        { id: 'fm-a', status: 'active', is_child_account: false, member_learner_id: 'learner-ffion', invited_email: 'ffion@example.com', removed_at: null },
        { id: 'fm-c', status: 'active', is_child_account: true, member_learner_id: 'learner-lewis', invited_email: null, removed_at: null },
        { id: 'fm-i', status: 'invited', is_child_account: false, member_learner_id: null, invited_email: 'pending@example.com', removed_at: null },
      ],
      error: null,
    })
    const res = makeRes()
    await handler(makeReq({ body: { plan: 'premium' } }), res)
    expect(res._status).toBe(200)
    expect(endsMails).toHaveLength(1)
    // THE DATE IN THE MAIL IS THE COVER END, NOT THE PLAN-CHANGE DATE (Tom's
    // 30-day grace, 2026-09-08): the paid period plus 30 days, from the one
    // helper, so the mail cannot name a different day from the app.
    expect(endsMails[0]).toMatchObject({
      address: 'ffion@example.com',
      inviterName: 'Tom',
      endsAt: familyCoverEndsAt(PERIOD_END),
    })
    expect(res._json.familyCoverEndsAt).toBe(familyCoverEndsAt(PERIOD_END))
    expect(res._json.emailed).toBe(1)
  })

  it('KEEP FAMILY: plan:family on a row with a pending change moves Paddle back onto Family, unbilled, and clears the schedule', async () => {
    responders.subscriptions = familyRow({ scheduled_plan_name: 'SSi Premium', scheduled_plan_at: PERIOD_END })
    liveSub = { status: 'active', items: [{ price: { id: PREMIUM_MONTHLY, billingCycle: { interval: 'month' } } }] }
    const res = makeRes()
    await handler(makeReq({ body: { plan: 'family' } }), res)
    expect(res._status).toBe(200)
    expect(res._json).toMatchObject({ ok: true, reverted: true, planName: 'SSi Family' })
    expect(updateCalls).toEqual([
      { id: 'psub_fam', opts: { items: [{ priceId: 'pri_family_monthly', quantity: 1 }], prorationBillingMode: 'do_not_bill' } },
    ])
    const upd = writes.subscriptions.filter((w) => w.op === 'update')
    expect(upd).toHaveLength(1)
    expect(upd[0].payload).toMatchObject({ scheduled_plan_name: null, scheduled_plan_at: null, plan_name: 'SSi Family' })
    expect(endsMails).toHaveLength(0)
  })
})
