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
 * FIXED 2026-08-11 (paddle-webhook.ts, resolveSchoolTarget / resolveOrgTarget):
 * the school / org a platform subscription may write to is now resolved
 * SERVER-SIDE — from the row already bound to this Paddle subscription id, else
 * from the payer's own node reached through the Paddle customer's email. The
 * ADMIN-ENT-01 tests below are therefore REGRESSION LOCKS on the fix (attacker
 * event → no write) rather than characterizations of the hole.
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

/**
 * Make the paying Paddle customer (attacker@example.com, per the paddle mock)
 * resolve server-side to the admin of `schoolId` — the legitimate-payer setup.
 * A `schools` select on provider_subscription_id still finds nothing, so the
 * handler must go through the payer-ownership path to get its target.
 */
function payerAdminsSchool(schoolId: string) {
  responders.learner_emails = () => ({ data: [{ learner_id: 'payer-learner', verified: true }], error: null })
  responders.learners = () => ({ data: [{ user_id: 'payer-uid' }], error: null })
  responders.schools = (calls: any[][]) => {
    const eq = calls.find((c) => c[0] === 'eq')
    if (eq?.[1] === 'admin_user_id') return { data: { id: schoolId }, error: null }
    // A-123: the access guards read the candidate node's own billing state
    // before any write. This school holds NOTHING — lapsed, unbound — so the
    // incoming subscription can take nothing away from it and the write
    // proceeds. (The payer-email rung is deliberately fenced to exactly this
    // case; a node that still holds access can only be addressed by a
    // server-signed checkout intent. See THE BINDING LADDER in
    // paddle-webhook.ts, and paddle-billing-intent-addressing.security.test.ts
    // for the signed path.)
    if (eq?.[1] === 'id' && eq?.[2] === schoolId) {
      return {
        data: {
          id: schoolId,
          provider_subscription_id: null,
          platform_status: 'cancelled',
          platform_expires_at: null,
        },
        error: null,
      }
    }
    return { data: null, error: null }
  }
}

/** Same, for an org leader (govt_admins.group_id). */
function payerLeadsOrg(groupId: string) {
  responders.learner_emails = () => ({ data: [{ learner_id: 'payer-learner', verified: true }], error: null })
  responders.learners = () => ({ data: [{ user_id: 'payer-uid' }], error: null })
  responders.govt_admins = () => ({ data: { group_id: groupId }, error: null })
  responders.groups = (calls: any[][]) => {
    const eq = calls.find((c) => c[0] === 'eq')
    // A-123 guard read (see payerAdminsSchool): an org holding nothing, so the
    // incoming subscription can take nothing away and the write proceeds.
    if (eq?.[1] === 'id' && eq?.[2] === groupId) {
      return {
        data: {
          id: groupId,
          provider_subscription_id: null,
          platform_status: 'cancelled',
          platform_expires_at: null,
        },
        error: null,
      }
    }
    return { data: null, error: null }
  }
}

describe('paddle-webhook — ADMIN-ENT-01: the billing target is resolved server-side', () => {
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

  // ADMIN-ENT-01 REGRESSION LOCK: a subscription paid for by someone who
  // administers no school names a victim school in customData. The payer
  // resolves to nothing server-side, so NOTHING is written — the victim's
  // platform_status, teacher_seats and provider_* billing pointers (which
  // api/school/portal.ts:53-66 turns into a portal session) are untouched.
  it('ADMIN-ENT-01: a stranger naming a victim school in customData writes nothing', async () => {
    currentEvent = subEvent({
      kind: 'school_platform',
      school_id: 'victim-school-uuid',
      supabase_user_id: 'attacker-uid',
    })
    const res = makeRes()
    await handler(makeReq(), res)

    expect(res._status).toBe(200)
    expect(writes.schools).toBeUndefined()
  })

  // ADMIN-ENT-01 REGRESSION LOCK (impact 3 — cancellation as denial of
  // service): Paddle persists customData on the subscription, so the
  // attacker's own cancellation still carries the victim's school_id. The
  // target is no longer read from it, so the victim cannot be flipped dark.
  it('ADMIN-ENT-01: a stranger cancelling their own sub cannot cancel the named school', async () => {
    currentEvent = subEvent(
      { kind: 'school_platform', school_id: 'victim-school-uuid' },
      { status: 'canceled' },
      EventName.SubscriptionCanceled,
    )
    const res = makeRes()
    await handler(makeReq(), res)

    expect(res._status).toBe(200)
    expect(writes.schools).toBeUndefined()
  })

  // ADMIN-ENT-01 REGRESSION LOCK: identical shape for orgs — customData
  // .group_id is no longer the address of the `groups` write.
  it('ADMIN-ENT-01: a stranger naming a victim group in customData writes nothing', async () => {
    currentEvent = subEvent({ kind: 'org_platform', group_id: 'victim-group-uuid' })
    const res = makeRes()
    await handler(makeReq(), res)

    expect(res._status).toBe(200)
    expect(writes.groups?.find((w) => w.op === 'update')).toBeUndefined()
  })

  // The other half of the fix: a LEGITIMATE payer is still served, and the
  // node written is the payer's own even when the browser named another.
  it('ADMIN-ENT-01: writes to the school the PAYER administers, not the one customData names', async () => {
    payerAdminsSchool('payers-own-school')
    currentEvent = subEvent({ kind: 'school_platform', school_id: 'victim-school-uuid' })
    const res = makeRes()
    await handler(makeReq(), res)

    expect(res._status).toBe(200)
    const schoolWrite = writes.schools?.find((w) => w.op === 'update')
    expect(schoolWrite).toBeDefined()
    expect(schoolWrite!.eqs).toContainEqual(['id', 'payers-own-school'])
    expect(schoolWrite!.eqs).not.toContainEqual(['id', 'victim-school-uuid'])
    expect(schoolWrite!.payload).toMatchObject({
      platform_status: 'active',
      teacher_seats: 1,
      provider_subscription_id: 'psub_attacker',
      provider_customer_id: 'ctm_attacker',
    })
  })

  it('ADMIN-ENT-01: writes to the org the PAYER leads, not the one customData names', async () => {
    payerLeadsOrg('payers-own-org')
    currentEvent = subEvent({ kind: 'org_platform', group_id: 'victim-group-uuid' })
    const res = makeRes()
    await handler(makeReq(), res)

    expect(res._status).toBe(200)
    const groupWrite = writes.groups?.find((w) => w.op === 'update')
    expect(groupWrite).toBeDefined()
    expect(groupWrite!.eqs).toContainEqual(['id', 'payers-own-org'])
  })

  // Renewals / cancellations of an ALREADY-BOUND subscription resolve from the
  // binding itself — no payer lookup needed, and the subscription can never
  // migrate onto a different tenant later in its life.
  it('ADMIN-ENT-01: an existing binding addresses the write, ignoring customData', async () => {
    responders.schools = (calls: any[][]) => {
      const eq = calls.find((c) => c[0] === 'eq')
      if (eq?.[1] === 'provider_subscription_id') return { data: { id: 'bound-school' }, error: null }
      return { data: null, error: null }
    }
    currentEvent = subEvent({ kind: 'school_platform', school_id: 'victim-school-uuid' })
    const res = makeRes()
    await handler(makeReq(), res)

    const schoolWrite = writes.schools?.find((w) => w.op === 'update')
    expect(schoolWrite!.eqs).toContainEqual(['id', 'bound-school'])
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

  // The learner/premium lane is deliberately NOT gated the same way: a parent
  // or guardian paying for a child is a legitimate third-party payment
  // (paddle-webhook.ts logEmailMismatch). Left as the audit found it.
  it.todo(
    'ADMIN-ENT-01: the learner_premium lane should bind its target server-side too, without breaking third-party payment',
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
    payerAdminsSchool('school-1')
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
    payerAdminsSchool('school-1')
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
