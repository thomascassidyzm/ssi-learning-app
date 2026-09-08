/**
 * THE FAMILY → PREMIUM PLAN CHANGE, AS THE WEBHOOK SEES IT (job #376·F, D3).
 *
 * api/subscription/change-plan writes a schedule on the owner's row, then
 * moves the PRICE on the same Paddle subscription to Premium with do_not_bill.
 * Paddle sends subscription.updated for that same id, customData.kind still
 * 'family_plan' from the first checkout. On the pre-change webhook that event
 * was REJECTED ("billed price is not the family tier") and the row FROZE at
 * 'SSi Family' with a stale period end — the whole family, owner included,
 * went dark at that date while £15 a month kept being charged.
 *
 * The first two tests FAIL on the pre-change webhook (nothing is written; the
 * row is left 'SSi Family' after the scheduled flip) and PASS after it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { EventName } from '@paddle/paddle-node-sdk'

process.env.SUPABASE_URL = 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'
process.env.VITE_PADDLE_FAMILY_PRICE_MONTHLY = 'pri_family_monthly_test'
process.env.VITE_PADDLE_FAMILY_PRICE_ANNUAL = 'pri_family_annual_test'

const PREMIUM_PRICE = 'pri_01kqq85gvncyasfmfvvpcv1xfg'
const FAMILY_PRICE = 'pri_family_monthly_test'
const SCHEDULED_AT = '2026-10-07T23:41:26.033896Z'

let currentEvent: any = null
vi.mock('../_utils/paddle', () => ({
  paddle: {
    webhooks: { unmarshal: vi.fn(async () => currentEvent) },
    transactions: { get: vi.fn(async () => ({ details: { totals: { grandTotal: '1000' } } })) },
    addresses: { get: vi.fn(async () => ({ countryCode: 'GB' })) },
    customers: { get: vi.fn(async () => ({ email: 'payer@example.com' })) },
  },
  webhookSecret: 'whsec_test',
}))

let writes: Record<string, any[]> = {}
let responders: Record<string, (calls: any[][]) => any> = {}
let dedupSeen: Set<string>

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
    upsert: (o: unknown, opts: unknown) => { calls.push(['upsert', o, opts]); recordWrite(table, 'upsert', o); return builder },
    delete: () => { calls.push(['delete']); recordWrite(table, 'delete', undefined); return builder },
    eq: (col: string, val: unknown) => { calls.push(['eq', col, val]); return builder },
    is: (col: string, val: unknown) => { calls.push(['is', col, val]); return builder },
    in: (col: string, vals: unknown) => { calls.push(['in', col, vals]); return builder },
    limit: (n: number) => { calls.push(['limit', n]); return builder },
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
  createClient: () => ({
    from: (table: string) => makeChainable(table),
    rpc: () => Promise.resolve({ data: null, error: null }),
  }),
}))

function defaultDedupResponder(calls: any[][]) {
  const ins = calls.find((c) => c[0] === 'insert')
  if (!ins) return { error: null }
  const id = (ins[1] as any)?.event_id
  if (id && dedupSeen.has(id)) return { error: { code: '23505', message: 'dup' } }
  if (id) dedupSeen.add(id)
  return { error: null }
}

function makeReq(): VercelRequest {
  const req: any = {
    method: 'POST',
    headers: { 'paddle-signature': 'sig' },
    on(event: string, cb: (arg?: any) => void) {
      if (event === 'data') cb(Buffer.from('{}', 'utf8'))
      if (event === 'end') cb()
      return req
    },
  }
  return req as VercelRequest
}

function makeRes() {
  const res: any = {}
  res.status = vi.fn((code: number) => { res._status = code; return res })
  res.json = vi.fn((body: unknown) => { res._json = body; return res })
  return res as VercelResponse & { _status?: number; _json?: any }
}

let evtCounter = 0
function subscriptionEvent(opts: {
  type?: EventName
  priceId: string
  status?: string
  periodStart: string
  periodEnd: string
  scheduledChange?: any
}): any {
  return {
    eventType: opts.type ?? EventName.SubscriptionUpdated,
    eventId: `evt-dg-${++evtCounter}`,
    data: {
      id: 'psub_family_1',
      customerId: 'ctm_1',
      status: opts.status ?? 'active',
      currentBillingPeriod: { startsAt: opts.periodStart, endsAt: opts.periodEnd },
      nextBilledAt: opts.periodEnd,
      items: [{ price: { id: opts.priceId }, quantity: 1 }],
      scheduledChange: opts.scheduledChange ?? null,
      // Baked in at the first checkout and never updated by a price change.
      customData: { kind: 'family_plan', supabase_user_id: 'user-owner' },
    },
  }
}

/** The owner's row as change-plan left it: Family, with the flip scheduled. */
function familyRowWithSchedule(overrides: Record<string, unknown> = {}) {
  return (calls: any[][]) => {
    if (calls.some((c) => c[0] === 'update' || c[0] === 'upsert')) return { data: { id: 'sub-fam' }, error: null }
    return {
      data: {
        id: 'sub-fam',
        learner_id: 'learner-owner',
        plan_name: 'SSi Family',
        status: 'active',
        provider_subscription_id: 'psub_family_1',
        scheduled_plan_name: 'SSi Premium',
        scheduled_plan_at: SCHEDULED_AT,
        ...overrides,
      },
      error: null,
    }
  }
}

function subscriptionWrites() {
  return (writes.subscriptions || []).filter((w) => w.op === 'update' || w.op === 'upsert')
}

describe('paddle-webhook: Family → Premium plan change, held for the period end', () => {
  let handler: typeof import('./paddle-webhook').default

  beforeEach(async () => {
    vi.resetModules()
    writes = {}
    responders = { processed_webhook_events: defaultDedupResponder }
    dedupSeen = new Set()
    currentEvent = null
    evtCounter = 0
    responders.learners = () => ({ data: { id: 'learner-owner' }, error: null })
    handler = (await import('./paddle-webhook')).default
  })

  it('THE HOLD: the Premium-priced event right after the swap updates the period but keeps plan_name SSi Family', async () => {
    responders.subscriptions = familyRowWithSchedule()
    // Paddle's items changed today; the paid period is untouched.
    currentEvent = subscriptionEvent({
      priceId: PREMIUM_PRICE,
      periodStart: '2026-09-07T23:41:26.033896Z',
      periodEnd: SCHEDULED_AT,
    })

    const res = makeRes()
    await handler(makeReq(), res)

    expect(res._status).toBe(200)
    const w = subscriptionWrites()
    expect(w, 'pre-change: REJECTED, nothing written, row frozen').toHaveLength(1)
    expect(w[0].payload).toMatchObject({ status: 'active', current_period_end: SCHEDULED_AT })
    expect(w[0].payload).not.toHaveProperty('plan_name')
    expect(w[0].payload).not.toHaveProperty('plan_id')
    expect(w[0].payload).not.toHaveProperty('scheduled_plan_name')
  })

  it('THE FLIP: the renewal whose period starts at scheduled_plan_at writes SSi Premium, clears the NAME and keeps the DATE', async () => {
    responders.subscriptions = familyRowWithSchedule()
    currentEvent = subscriptionEvent({
      priceId: PREMIUM_PRICE,
      periodStart: SCHEDULED_AT,
      periodEnd: '2026-11-07T23:41:26.033896Z',
    })

    const res = makeRes()
    await handler(makeReq(), res)

    expect(res._status).toBe(200)
    const w = subscriptionWrites()
    expect(w, 'pre-change: the row is left SSi Family after the scheduled flip').toHaveLength(1)
    expect(w[0].payload).toMatchObject({
      plan_name: 'SSi Premium',
      plan_id: PREMIUM_PRICE,
      status: 'active',
      current_period_end: '2026-11-07T23:41:26.033896Z',
      scheduled_plan_name: null,
    })
    // THE DATE STAYS (Tom's 30-day grace, 2026-09-08). It is the record of when
    // the paid Family period ended, and familyAccess.ts adds 30 days to it to
    // keep every member covered. Clearing it here — as this webhook used to —
    // leaves nothing on the row to derive the tail from, and the family goes
    // dark the instant this write lands.
    expect(w[0].payload).not.toHaveProperty('scheduled_plan_at', null)
    expect(w[0].payload.scheduled_plan_at).toBeUndefined()
  })

  it('a hand swap in the Paddle dashboard, with no schedule, flips at once (accepted, D3)', async () => {
    responders.subscriptions = familyRowWithSchedule({ scheduled_plan_name: null, scheduled_plan_at: null })
    currentEvent = subscriptionEvent({
      priceId: PREMIUM_PRICE,
      periodStart: '2026-09-07T23:41:26.033896Z',
      periodEnd: SCHEDULED_AT,
    })
    await handler(makeReq(), makeRes())
    const w = subscriptionWrites()
    expect(w).toHaveLength(1)
    expect(w[0].payload).toMatchObject({ plan_name: 'SSi Premium', plan_id: PREMIUM_PRICE })
  })

  it('a cancellation during the hold lands as cancelled, plan still held', async () => {
    responders.subscriptions = familyRowWithSchedule()
    currentEvent = subscriptionEvent({
      type: EventName.SubscriptionCanceled,
      status: 'canceled',
      priceId: PREMIUM_PRICE,
      periodStart: '2026-09-07T23:41:26.033896Z',
      periodEnd: SCHEDULED_AT,
    })
    await handler(makeReq(), makeRes())
    const w = subscriptionWrites()
    expect(w).toHaveLength(1)
    expect(w[0].payload).toMatchObject({ status: 'cancelled' })
    expect(w[0].payload).not.toHaveProperty('plan_name')
  })

  it('"Keep Family": a Family-priced event on the held row is filed as SSi Family, whatever kind says', async () => {
    responders.subscriptions = familyRowWithSchedule({ scheduled_plan_name: null, scheduled_plan_at: null })
    currentEvent = subscriptionEvent({
      priceId: FAMILY_PRICE,
      periodStart: '2026-09-07T23:41:26.033896Z',
      periodEnd: SCHEDULED_AT,
    })
    await handler(makeReq(), makeRes())
    const up = subscriptionWrites().find((w) => w.op === 'upsert')!
    expect(up.payload).toMatchObject({ plan_name: 'SSi Family', plan_id: FAMILY_PRICE, provider_subscription_id: 'psub_family_1' })
  })

  it('a plain Premium renewal is not touched by the held-subscription path', async () => {
    responders.subscriptions = (calls) => {
      if (calls.some((c) => c[0] === 'upsert')) return { data: { id: 'sub-p' }, error: null }
      return {
        data: { id: 'sub-p', learner_id: 'learner-owner', plan_name: 'SSi Premium', status: 'active', provider_subscription_id: 'psub_family_1', scheduled_plan_name: null, scheduled_plan_at: null },
        error: null,
      }
    }
    currentEvent = subscriptionEvent({ priceId: PREMIUM_PRICE, periodStart: '2026-09-07T00:00:00Z', periodEnd: '2026-10-07T00:00:00Z' })
    currentEvent.data.customData = { kind: 'learner_premium', supabase_user_id: 'user-owner' }
    await handler(makeReq(), makeRes())
    const up = subscriptionWrites().find((w) => w.op === 'upsert')!
    expect(up.payload.plan_name).toBe('SSi Premium')
  })
})
