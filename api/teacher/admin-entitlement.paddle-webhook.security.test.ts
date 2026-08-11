/**
 * Security audit 2026-08-11 — area 4 (admin-entitlement).
 * See docs/security-audit-2026-08-11/admin-entitlement.md
 *
 * ADMIN-ENT-01 (critical): the Paddle webhook validates the PRICE TIER of an
 * incoming subscription server-side — that guard is real and is locked below —
 * but it never checks that the payer is entitled to affect the school / group /
 * learner named in `customData`. `customData` is composed in the browser
 * (packages/player-vue/src/composables/useSchoolCheckout.ts:86), so the target
 * is attacker-chosen.
 *
 * These are CHARACTERIZATION tests: they assert today's (vulnerable) behaviour
 * so the suite stays green, with the desired behaviour recorded as it.todo.
 *
 * Signature verification is satisfied by mocking ../_utils/paddle (the
 * unmarshal seam), matching the harness in paddle-webhook.test.ts. No network,
 * no real Paddle call.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { EventName } from '@paddle/paddle-node-sdk'

process.env.SUPABASE_URL = 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'

// Price ids from the handler's PRICE_CATALOG (paddle-webhook.ts:94-119).
const PREMIUM_PRICE = 'pri_01kqq85gvncyasfmfvvpcv1xfg' // tier: premium — £15/mo, one seat
const STUDENT_SCHOOL_PRICE = 'pri_01kv5wrc5cz17pwgeva4zk8s0r' // tier: student_school — £5/mo

let currentEvent: any = null
vi.mock('../_utils/paddle', () => ({
  paddle: {
    webhooks: { unmarshal: vi.fn(async () => currentEvent) },
    transactions: { get: vi.fn(async () => ({ details: { totals: { grandTotal: '1500' } } })) },
    customers: { get: vi.fn(async () => ({ email: 'attacker@example.com' })) },
  },
  webhookSecret: 'whsec_test',
}))

// ── supabase seam ──────────────────────────────────────────────────────────
let writes: Record<string, Array<{ op: string; payload: any; eqs: Array<[string, unknown]> }>> = {}
let responders: Record<string, (calls: any[][]) => any> = {}
let dedupSeen: Set<string>
let dedupError: { code: string; message: string } | null = null

function makeChainable(table: string) {
  const calls: any[][] = []
  const eqs: Array<[string, unknown]> = []
  const builder: any = {
    select: (c?: string) => { calls.push(['select', c]); return builder },
    insert: (o: unknown) => { calls.push(['insert', o]); writes[table] = writes[table] || []; writes[table].push({ op: 'insert', payload: o, eqs }); return builder },
    update: (o: unknown) => { calls.push(['update', o]); writes[table] = writes[table] || []; writes[table].push({ op: 'update', payload: o, eqs }); return builder },
    upsert: (o: unknown, opts?: unknown) => { calls.push(['upsert', o, opts]); writes[table] = writes[table] || []; writes[table].push({ op: 'upsert', payload: o, eqs }); return builder },
    delete: () => { calls.push(['delete']); return builder },
    eq: (col: string, val: unknown) => { calls.push(['eq', col, val]); eqs.push([col, val]); return builder },
    is: () => { calls.push(['is']); return builder },
    in: () => { calls.push(['in']); return builder },
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

function dedupResponder(calls: any[][]) {
  const ins = calls.find((c) => c[0] === 'insert')
  if (!ins) return { error: null }
  if (dedupError) return { error: dedupError }
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
function subEvent(
  customData: Record<string, unknown>,
  overrides: any = {},
  eventType: any = EventName.SubscriptionCreated,
): any {
  return {
    eventType,
    eventId: `sec-evt-${++evtCounter}`,
    data: {
      id: 'psub_attacker',
      customerId: 'ctm_attacker',
      status: 'active',
      currentBillingPeriod: { endsAt: '2027-01-01T00:00:00Z' },
      nextBilledAt: '2027-01-01T00:00:00Z',
      items: [{ price: { id: PREMIUM_PRICE }, quantity: 1 }],
      scheduledChange: null,
      customData,
      ...overrides,
    },
  }
}

describe('paddle-webhook — ADMIN-ENT-01: customData names the target, unchecked', () => {
  let handler: typeof import('./paddle-webhook').default

  beforeEach(async () => {
    vi.resetModules()
    writes = {}
    responders = { processed_webhook_events: dedupResponder }
    dedupSeen = new Set()
    dedupError = null
    currentEvent = null
    evtCounter = 0
    handler = (await import('./paddle-webhook')).default
  })

  // SECURITY FINDING ADMIN-ENT-01: a subscription paid for by ANYONE, carrying
  // customData.school_id of a school they have no relationship with, is applied
  // to that school's row — overwriting platform_status, platform_expires_at,
  // teacher_seats AND the provider_customer_id / provider_subscription_id that
  // api/school/portal.ts:53-66 uses to mint that school's billing portal.
  // SHOULD BE: the handler resolves the school from the PAYER (or the checkout
  // transaction is created server-side from the caller's own JWT) and rejects
  // an event whose customData names a school the payer does not administer.
  it('ADMIN-ENT-01: writes to a school named only by customData, with no ownership check', async () => {
    currentEvent = subEvent({
      kind: 'school_platform',
      school_id: 'victim-school-uuid',
      supabase_user_id: 'attacker-uid',
    })
    const res = makeRes()
    await handler(makeReq(), res)

    expect(res._status).toBe(200)
    const schoolWrite = writes.schools?.[0]
    expect(schoolWrite).toBeDefined()
    expect(schoolWrite!.op).toBe('update')
    // The victim's row is the one targeted...
    expect(schoolWrite!.eqs).toContainEqual(['id', 'victim-school-uuid'])
    // ...and the attacker's billing identity is written onto it.
    expect(schoolWrite!.payload).toMatchObject({
      platform_status: 'active',
      teacher_seats: 1,
      provider_subscription_id: 'psub_attacker',
      provider_customer_id: 'ctm_attacker',
    })
  })

  // SECURITY FINDING ADMIN-ENT-01 (impact 3 — cancellation as denial of
  // service): Paddle persists customData on the subscription, so when the
  // attacker cancels their OWN £15 subscription the resulting event still
  // carries the victim's school_id, and flips the victim to 'cancelled'.
  // SHOULD BE: same ownership gate, so a stranger's cancellation cannot reach
  // this row at all.
  it('ADMIN-ENT-01: a stranger cancelling their own sub cancels the named school', async () => {
    currentEvent = subEvent(
      { kind: 'school_platform', school_id: 'victim-school-uuid' },
      { status: 'canceled' },
      EventName.SubscriptionCanceled,
    )
    const res = makeRes()
    await handler(makeReq(), res)

    expect(res._status).toBe(200)
    const schoolWrite = writes.schools?.[0]
    expect(schoolWrite!.eqs).toContainEqual(['id', 'victim-school-uuid'])
    expect(schoolWrite!.payload.platform_status).toBe('cancelled')
  })

  // SECURITY FINDING ADMIN-ENT-01: identical shape for orgs —
  // paddle-webhook.ts:526 reads customData.group_id straight from the payload.
  it('ADMIN-ENT-01: writes to a group named only by customData', async () => {
    currentEvent = subEvent({ kind: 'org_platform', group_id: 'victim-group-uuid' })
    const res = makeRes()
    await handler(makeReq(), res)

    expect(res._status).toBe(200)
    const groupWrite = writes.groups?.find((w) => w.op === 'update')
    expect(groupWrite).toBeDefined()
    expect(groupWrite!.eqs).toContainEqual(['id', 'victim-group-uuid'])
  })

  // SECURITY FINDING ADMIN-ENT-01: and for an individual learner —
  // paddle-webhook.ts:726-753 resolves the target from customData
  // .supabase_user_id, then upserts `subscriptions` on onConflict:'learner_id',
  // clobbering whatever row that learner already had. wouldDowngradePlan only
  // blocks a LOWER-ranked plan, so 'SSi Premium' over 'SSi Premium' proceeds.
  it('ADMIN-ENT-01: upserts a subscription for a learner named only by customData', async () => {
    responders.learners = () => ({ data: { id: 'victim-learner-id' }, error: null })
    responders.subscriptions = (calls) => {
      // the precedence read (select+eq+maybeSingle) → no existing row
      if (calls.some((c) => c[0] === 'upsert')) return { data: { id: 'sub-1' }, error: null }
      return { data: null, error: null }
    }
    currentEvent = subEvent({ kind: 'learner_premium', supabase_user_id: 'victim-uid' })
    const res = makeRes()
    await handler(makeReq(), res)

    expect(res._status).toBe(200)
    const upsert = writes.subscriptions?.find((w) => w.op === 'upsert')
    expect(upsert).toBeDefined()
    expect(upsert!.payload).toMatchObject({
      learner_id: 'victim-learner-id',
      provider_subscription_id: 'psub_attacker',
      provider_customer_id: 'ctm_attacker',
    })
  })

  it.todo(
    'ADMIN-ENT-01: platform/premium webhooks should reject an event whose customData names a school/group/learner the paying Paddle customer does not own',
  )
  it.todo(
    'ADMIN-ENT-01: the checkout transaction should be created server-side from the caller JWT so the browser never names the billing target',
  )
  it.todo(
    'ADMIN-ENT-01: provider_customer_id / provider_subscription_id should never be silently re-pointed to a different customer on an existing row',
  )

  // ── The tier guard IS real. Regression lock so it is never removed. ──
  it('CONTROL: rejects a platform claim billed on a non-platform price tier', async () => {
    currentEvent = subEvent(
      { kind: 'school_platform', school_id: 'victim-school-uuid' },
      { items: [{ price: { id: STUDENT_SCHOOL_PRICE }, quantity: 1 }] },
    )
    const res = makeRes()
    await handler(makeReq(), res)

    expect(res._status).toBe(200)
    // No school row touched — the £5 price cannot buy a platform subscription.
    expect(writes.schools).toBeUndefined()
  })

  it('CONTROL: rejects a learner_premium claim billed on the cheap student price', async () => {
    currentEvent = subEvent(
      { kind: 'learner_premium', supabase_user_id: 'someone' },
      { items: [{ price: { id: STUDENT_SCHOOL_PRICE }, quantity: 1 }] },
    )
    const res = makeRes()
    await handler(makeReq(), res)

    expect(res._status).toBe(200)
    expect(writes.subscriptions).toBeUndefined()
  })

  it('CONTROL: an unsigned request never reaches any handler', async () => {
    const req: any = { method: 'POST', headers: {}, on: () => req }
    const res = makeRes()
    await handler(req as VercelRequest, res)
    expect(res._status).toBe(400)
    expect(writes.schools).toBeUndefined()
  })
})

describe('paddle-webhook — ADMIN-ENT-04: idempotency ledger fails open', () => {
  let handler: typeof import('./paddle-webhook').default

  beforeEach(async () => {
    vi.resetModules()
    writes = {}
    responders = { processed_webhook_events: dedupResponder }
    dedupSeen = new Set()
    dedupError = null
    currentEvent = null
    evtCounter = 0
    handler = (await import('./paddle-webhook')).default
  })

  it('CONTROL: a replayed event id is deduped and does not re-write', async () => {
    currentEvent = subEvent({ kind: 'school_platform', school_id: 'school-1' })
    await handler(makeReq(), makeRes())
    expect(writes.schools?.length).toBe(1)

    // Same event id, delivered again.
    const res = makeRes()
    await handler(makeReq(), res)
    expect(res._json).toMatchObject({ deduped: true })
    expect(writes.schools?.length).toBe(1)
  })

  // SECURITY FINDING ADMIN-ENT-04: any ledger error other than 23505 is logged
  // and the handler PROCEEDS (paddle-webhook.ts:295-305), so replay protection
  // silently vanishes whenever processed_webhook_events is unavailable. The
  // pre-migration rationale has expired — the table exists (schema.sql:8387).
  // SHOULD BE: fail closed with a 500 so the provider retries.
  it('ADMIN-ENT-04: processes the event twice when the dedup ledger errors', async () => {
    dedupError = { code: '42P01', message: 'relation "processed_webhook_events" does not exist' }
    currentEvent = subEvent({ kind: 'school_platform', school_id: 'school-1' })

    await handler(makeReq(), makeRes())
    const res = makeRes()
    await handler(makeReq(), res)

    expect(res._status).toBe(200)
    expect(res._json).not.toMatchObject({ deduped: true })
    // Both deliveries applied — no replay protection at all.
    expect(writes.schools?.length).toBe(2)
  })

  it.todo(
    'ADMIN-ENT-04: a dedup-ledger failure should return 500 (fail closed) so the provider retries rather than the handler processing unprotected',
  )
})
