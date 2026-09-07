/**
 * THE PREMIUM → FAMILY PLAN CHANGE, AS THE WEBHOOK SEES IT.
 *
 * api/subscription/change-plan swaps the PRICE on an existing subscription.
 * Paddle then sends subscription.updated for that same subscription id — and
 * its customData.kind still says 'premium', baked in at the first checkout
 * months earlier. Routed on kind, the event writes plan_name 'SSi Premium'
 * straight back over the Family row and the payer is charged £25 for no family
 * seats. These tests pin the price-first routing that stops that.
 *
 * The first test FAILS on the pre-change webhook (it upserts 'SSi Premium')
 * and PASSES after it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { EventName } from '@paddle/paddle-node-sdk'

process.env.SUPABASE_URL = 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'
// PRICE_CATALOG only carries the family tier when these are set — same
// condition as production.
process.env.VITE_PADDLE_FAMILY_PRICE_MONTHLY = 'pri_family_monthly_test'
process.env.VITE_PADDLE_FAMILY_PRICE_ANNUAL = 'pri_family_annual_test'

const PREMIUM_PRICE = 'pri_01kqq85gvncyasfmfvvpcv1xfg'
const FAMILY_PRICE = 'pri_family_monthly_test'

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
function updatedEvent(priceId: string, customData: Record<string, unknown>): any {
  return {
    eventType: EventName.SubscriptionUpdated,
    eventId: `evt-pc-${++evtCounter}`,
    data: {
      id: 'psub_live_1',
      customerId: 'ctm_1',
      status: 'active',
      currentBillingPeriod: { endsAt: '2026-10-01T00:00:00Z' },
      nextBilledAt: '2026-10-01T00:00:00Z',
      items: [{ price: { id: priceId }, quantity: 1 }],
      scheduledChange: null,
      customData,
    },
  }
}

/** The row the upgrader already has: their live Premium subscription. */
function existingPremiumRow(calls: any[][]) {
  if (calls.some((c) => c[0] === 'upsert')) return { data: { id: 'sub-1' }, error: null }
  return {
    data: {
      id: 'sub-1',
      learner_id: 'learner-1',
      plan_name: 'SSi Premium',
      status: 'active',
      provider_subscription_id: 'psub_live_1',
    },
    error: null,
  }
}

describe('paddle-webhook: Premium → Family plan change', () => {
  let handler: typeof import('./paddle-webhook').default

  beforeEach(async () => {
    vi.resetModules()
    writes = {}
    responders = { processed_webhook_events: defaultDedupResponder }
    dedupSeen = new Set()
    currentEvent = null
    evtCounter = 0
    handler = (await import('./paddle-webhook')).default
  })

  it('files a family-priced update on an EXISTING subscription as SSi Family, despite customData.kind still saying premium', async () => {
    responders.learners = () => ({ data: { id: 'learner-1' }, error: null })
    responders.subscriptions = existingPremiumRow
    currentEvent = updatedEvent(FAMILY_PRICE, { kind: 'premium', supabase_user_id: 'user-x' })

    const res = makeRes()
    await handler(makeReq(), res)

    expect(res._status).toBe(200)
    const up = writes.subscriptions.find((w) => w.op === 'upsert')!
    expect(up.payload).toMatchObject({
      learner_id: 'learner-1',
      plan_name: 'SSi Family',
      plan_id: FAMILY_PRICE,
      status: 'active',
      // THE SAME subscription — a plan change, never a second one.
      provider_subscription_id: 'psub_live_1',
    })
  })

  it('the same-id case is not theft: wouldStealLiveSubscriptionRow does not refuse it', async () => {
    responders.learners = () => ({ data: { id: 'learner-1' }, error: null })
    responders.subscriptions = existingPremiumRow
    currentEvent = updatedEvent(FAMILY_PRICE, { kind: 'learner_premium', supabase_user_id: 'user-x' })

    const res = makeRes()
    await handler(makeReq(), res)
    expect(writes.subscriptions?.some((w) => w.op === 'upsert')).toBe(true)
  })

  it('a family-priced event for a subscription we hold NO row for is not written to a guessed learner', async () => {
    responders.learners = () => ({ data: { id: 'learner-1' }, error: null })
    responders.subscriptions = () => ({ data: null, error: null })
    currentEvent = updatedEvent(FAMILY_PRICE, { kind: 'learner_premium', supabase_user_id: 'user-x' })

    const res = makeRes()
    await handler(makeReq(), res)
    expect(res._status).toBe(200)
    // learner_premium billed on a non-premium tier is still rejected outright.
    expect(writes.subscriptions?.some((w) => w.op === 'upsert')).toBeFalsy()
  })

  it('an ordinary premium renewal is untouched by the price-first branch', async () => {
    responders.learners = () => ({ data: { id: 'learner-1' }, error: null })
    responders.subscriptions = existingPremiumRow
    currentEvent = updatedEvent(PREMIUM_PRICE, { kind: 'learner_premium', supabase_user_id: 'user-x' })

    const res = makeRes()
    await handler(makeReq(), res)
    const up = writes.subscriptions.find((w) => w.op === 'upsert')!
    expect(up.payload.plan_name).toBe('SSi Premium')
  })

  it('a genuine first-time family checkout still runs the family_plan path', async () => {
    responders.learners = () => ({ data: { id: 'learner-9' }, error: null })
    responders.subscriptions = (calls) => {
      if (calls.some((c) => c[0] === 'upsert')) return { data: { id: 'sub-9' }, error: null }
      return { data: null, error: null }
    }
    currentEvent = updatedEvent(FAMILY_PRICE, { kind: 'family_plan', supabase_user_id: 'user-9' })

    const res = makeRes()
    await handler(makeReq(), res)
    const up = writes.subscriptions.find((w) => w.op === 'upsert')!
    expect(up.payload).toMatchObject({ learner_id: 'learner-9', plan_name: 'SSi Family' })
  })
})
