/**
 * Characterization tests for POST /api/teacher/paddle-webhook (1,398-line money
 * spine). Pins CURRENT behavior — the row writes + guard outcomes each branch
 * produces today — so a future change that alters them fails loudly.
 *
 * Covered:
 *   - dispatch guards: method, missing signature, bad signature (unmarshal
 *     throws), event-id idempotency (dedup 23505 no-ops; replay doesn't
 *     double-write).
 *   - subscription branches × subscriber-kind:
 *       learner_premium (accept + price-tier reject),
 *       student_via_teacher (sub + referral + tag + enrolment),
 *       school_platform (accept + price-tier reject),
 *       tutor_platform (platform set + D2 learner-premium bundle + link),
 *       org_platform (accept + price-tier reject + missing group_id skip),
 *       unknown kind (skip).
 *   - plan-precedence guard: a lower-ranked incoming plan does NOT clobber a
 *     higher-ranked active row, but orthogonal side effects still run.
 *   - transaction.paid commission accrual: tutor referral accrues £5; school
 *     referral / £0 collected accrue nothing.
 *   - adjustment: full refund + chargeback revoke; chargeback re-accrual;
 *     chargeback_warning no-ops.
 *
 * Signature verification is satisfied by mocking ../_utils/paddle (the
 * unmarshal seam) — EventName stays the real SDK enum.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { EventName } from '@paddle/paddle-node-sdk'

process.env.SUPABASE_URL = 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'

// ── Price ids from the handler's PRICE_CATALOG (source of truth for tier) ──
const PREMIUM_PRICE = 'pri_01kqq85gvncyasfmfvvpcv1xfg' // tier: premium
const STUDENT_TUTOR_PRICE = 'pri_01kqq89qwnsd3qwxvyybsc6ey1' // tier: student_tutor
const STUDENT_SCHOOL_PRICE = 'pri_01kv5wrc5cz17pwgeva4zk8s0r' // tier: student_school

// ── Paddle mock (unmarshal = the signature seam) ──
let currentEvent: any = null
let unmarshalThrows = false
let txnGetResult: any = { details: { totals: { grandTotal: '1000' } } }
vi.mock('../_utils/paddle', () => ({
  paddle: {
    webhooks: {
      unmarshal: vi.fn(async () => {
        if (unmarshalThrows) throw new Error('bad signature')
        return currentEvent
      }),
    },
    transactions: { get: vi.fn(async () => txnGetResult) },
    customers: { get: vi.fn(async () => ({ email: 'payer@example.com' })) },
  },
  webhookSecret: 'whsec_test',
}))

// ── Supabase mock: per-table write recorder + responders, plus rpc recorder ──
let writes: Record<string, any[]> = {}
let responders: Record<string, (calls: any[][]) => any> = {}
let rpcCalls: { name: string; params: any }[] = []
let rpcResponders: Record<string, (params: any) => any> = {}
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
    rpc: (name: string, params: any) => {
      rpcCalls.push({ name, params })
      const r = rpcResponders[name]
      return Promise.resolve(r ? r(params) : { data: null, error: null })
    },
  }),
}))

// Default dedup ledger: first sighting of an event id succeeds; a replay 23505s.
function defaultDedupResponder(calls: any[][]) {
  const ins = calls.find((c) => c[0] === 'insert')
  if (!ins) return { error: null } // delete cleanup path
  const id = (ins[1] as any)?.event_id
  if (id && dedupSeen.has(id)) return { error: { code: '23505', message: 'dup' } }
  if (id) dedupSeen.add(id)
  return { error: null }
}

function makeReq(headers: Record<string, string> = { 'paddle-signature': 'sig' }, method = 'POST'): VercelRequest {
  const req: any = {
    method,
    headers,
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
function subEvent(customData: Record<string, unknown>, dataOverrides: any = {}): any {
  return {
    eventType: EventName.SubscriptionCreated,
    eventId: `evt-${++evtCounter}`,
    data: {
      id: 'psub_1',
      customerId: 'ctm_1',
      status: 'active',
      currentBillingPeriod: { endsAt: '2026-08-01T00:00:00Z' },
      nextBilledAt: '2026-08-01T00:00:00Z',
      items: [{ price: { id: PREMIUM_PRICE }, quantity: 1 }],
      scheduledChange: null,
      customData,
      ...dataOverrides,
    },
  }
}

describe('POST /api/teacher/paddle-webhook', () => {
  let handler: typeof import('./paddle-webhook').default

  beforeEach(async () => {
    vi.resetModules()
    writes = {}
    responders = { processed_webhook_events: defaultDedupResponder }
    rpcCalls = []
    rpcResponders = {}
    dedupSeen = new Set()
    currentEvent = null
    unmarshalThrows = false
    txnGetResult = { details: { totals: { grandTotal: '1000' } } }
    evtCounter = 0
    handler = (await import('./paddle-webhook')).default
  })

  // ── Dispatch guards ──
  it('rejects a non-POST method', async () => {
    const res = makeRes()
    await handler(makeReq({}, 'GET'), res)
    expect(res._status).toBe(405)
  })

  it('400s when the Paddle-Signature header is missing', async () => {
    const res = makeRes()
    await handler(makeReq({}), res)
    expect(res._status).toBe(400)
  })

  it('401s when signature verification (unmarshal) throws', async () => {
    unmarshalThrows = true
    const res = makeRes()
    await handler(makeReq(), res)
    expect(res._status).toBe(401)
  })

  it('idempotency: a re-delivered event id (dedup 23505) no-ops', async () => {
    currentEvent = subEvent({ kind: 'learner_premium', supabase_user_id: 'user-x' })
    dedupSeen.add(currentEvent.eventId) // pretend already processed
    const res = makeRes()
    await handler(makeReq(), res)
    expect(res._status).toBe(200)
    expect(res._json).toMatchObject({ received: true, deduped: true })
    expect(writes.subscriptions).toBeUndefined()
  })

  // ── learner_premium ──
  it('learner_premium on a premium-tier price upserts an SSi Premium subscription row', async () => {
    responders.learners = () => ({ data: { id: 'learner-1' }, error: null })
    responders.subscriptions = (calls) => {
      if (calls.some((c) => c[0] === 'upsert')) return { data: { id: 'sub-1' }, error: null }
      return { data: null, error: null } // wouldDowngradePlan: no existing
    }
    currentEvent = subEvent({ kind: 'learner_premium', supabase_user_id: 'user-x' })
    const res = makeRes()
    await handler(makeReq(), res)

    expect(res._status).toBe(200)
    const up = writes.subscriptions.find((w) => w.op === 'upsert')!
    expect(up.payload).toMatchObject({ learner_id: 'learner-1', plan_name: 'SSi Premium', status: 'active', provider: 'paddle' })
    expect(writes.teachers).toBeUndefined() // pure premium, no teacher link
  })

  it('learner_premium billed on a NON-premium price is REJECTED (no subscription write)', async () => {
    responders.learners = () => ({ data: { id: 'learner-1' }, error: null })
    currentEvent = subEvent(
      { kind: 'learner_premium', supabase_user_id: 'user-x' },
      { items: [{ price: { id: STUDENT_SCHOOL_PRICE }, quantity: 1 }] },
    )
    const res = makeRes()
    await handler(makeReq(), res)

    expect(res._status).toBe(200)
    expect(writes.subscriptions).toBeUndefined()
  })

  // ── student_via_teacher ──
  it('student_via_teacher (tutor class): writes sub + referral(£10 locked) + tag + enrolment', async () => {
    responders.classes = () => ({ data: { school_id: null, course_code: 'cym_for_eng' }, error: null }) // tutor class → 1000
    responders.learners = () => ({ data: { id: 'learner-1' }, error: null })
    responders.subscriptions = (calls) => {
      if (calls.some((c) => c[0] === 'upsert')) return { data: { id: 'sub-1' }, error: null }
      return { data: null, error: null }
    }
    responders.learner_emails = () => ({ data: [], error: null })
    currentEvent = subEvent(
      { kind: 'student_via_teacher', supabase_user_id: 'user-x', class_id: 'class-1' },
      { items: [{ price: { id: STUDENT_TUTOR_PRICE }, quantity: 1 }] },
    )
    const res = makeRes()
    await handler(makeReq(), res)

    expect(res._status).toBe(200)
    expect(writes.subscriptions.find((w) => w.op === 'upsert')!.payload).toMatchObject({ plan_name: 'SSi Student Access', learner_id: 'learner-1' })
    expect(writes.teacher_referrals.find((w) => w.op === 'upsert')!.payload).toMatchObject({ class_id: 'class-1', locked_price_pence: 1000, student_learner_id: 'learner-1' })
    expect(writes.user_tags.find((w) => w.op === 'upsert')!.payload).toMatchObject({ tag_type: 'class', tag_value: 'CLASS:class-1', role_in_context: 'student' })
    expect(writes.course_enrollments.find((w) => w.op === 'upsert')!.payload).toMatchObject({ learner_id: 'learner-1', course_id: 'cym_for_eng' })
  })

  // ── school_platform ──
  it('school_platform on a premium price sets school platform columns incl. seats = item quantity', async () => {
    responders.schools = () => ({ error: null })
    currentEvent = subEvent(
      { kind: 'school_platform', school_id: 'school-1' },
      { items: [{ price: { id: PREMIUM_PRICE }, quantity: 5 }] },
    )
    const res = makeRes()
    await handler(makeReq(), res)

    expect(res._status).toBe(200)
    const upd = writes.schools.find((w) => w.op === 'update')!
    expect(upd.payload).toMatchObject({ platform_status: 'active', teacher_seats: 5, provider_subscription_id: 'psub_1', provider_customer_id: 'ctm_1', platform_expires_at: '2026-08-01T00:00:00Z' })
  })

  it('school_platform billed on a NON-premium price is REJECTED (no school write)', async () => {
    currentEvent = subEvent(
      { kind: 'school_platform', school_id: 'school-1' },
      { items: [{ price: { id: STUDENT_SCHOOL_PRICE }, quantity: 5 }] },
    )
    const res = makeRes()
    await handler(makeReq(), res)
    expect(res._status).toBe(200)
    expect(writes.schools).toBeUndefined()
  })

  // ── org_platform ──
  it('org_platform on a premium price sets groups platform columns incl. seats = item quantity', async () => {
    responders.groups = () => ({ error: null })
    currentEvent = subEvent(
      { kind: 'org_platform', group_id: 'org-1' },
      { items: [{ price: { id: PREMIUM_PRICE }, quantity: 5 }] },
    )
    const res = makeRes()
    await handler(makeReq(), res)

    expect(res._status).toBe(200)
    const upd = writes.groups.find((w) => w.op === 'update')!
    expect(upd.payload).toMatchObject({ platform_status: 'active', seats: 5, provider_subscription_id: 'psub_1', provider_customer_id: 'ctm_1', platform_expires_at: '2026-08-01T00:00:00Z' })
  })

  it('org_platform billed on a NON-premium price is REJECTED (no groups write)', async () => {
    currentEvent = subEvent(
      { kind: 'org_platform', group_id: 'org-1' },
      { items: [{ price: { id: STUDENT_SCHOOL_PRICE }, quantity: 5 }] },
    )
    const res = makeRes()
    await handler(makeReq(), res)
    expect(res._status).toBe(200)
    expect(writes.groups).toBeUndefined()
  })

  it('org_platform missing group_id in customData is skipped (no groups write)', async () => {
    currentEvent = subEvent(
      { kind: 'org_platform' },
      { items: [{ price: { id: PREMIUM_PRICE }, quantity: 5 }] },
    )
    const res = makeRes()
    await handler(makeReq(), res)
    expect(res._status).toBe(200)
    expect(writes.groups).toBeUndefined()
  })

  // ── tutor_platform ──
  it('tutor_platform: sets teacher platform status, grants D2 learner-premium bundle, links own_subscription_id', async () => {
    responders.teachers = (calls) => {
      if (calls.some((c) => c[0] === 'select')) return { data: { learner_id: 'learner-1' }, error: null }
      return { data: null, error: null } // updates
    }
    responders.subscriptions = (calls) => {
      if (calls.some((c) => c[0] === 'upsert')) return { data: { id: 'sub-1' }, error: null }
      return { data: null, error: null }
    }
    responders.learner_emails = () => ({ data: [], error: null })
    currentEvent = subEvent({ kind: 'tutor_platform', teacher_id: 'teacher-1' })
    const res = makeRes()
    await handler(makeReq(), res)

    expect(res._status).toBe(200)
    // Platform status set on the teacher.
    expect(writes.teachers.some((w) => w.op === 'update' && (w.payload as any).platform_status === 'active')).toBe(true)
    // D2 bundle: same premium subscription row a learner_premium checkout makes.
    expect(writes.subscriptions.find((w) => w.op === 'upsert')!.payload).toMatchObject({ plan_name: 'SSi Premium (tutor bundle)', learner_id: 'learner-1' })
    // own_subscription_id linked back so the portal resolves.
    expect(writes.teachers.some((w) => w.op === 'update' && (w.payload as any).own_subscription_id === 'sub-1')).toBe(true)
  })

  it('subscription event with an unknown kind is skipped (no writes)', async () => {
    currentEvent = subEvent({ kind: 'mystery' })
    const res = makeRes()
    await handler(makeReq(), res)
    expect(res._status).toBe(200)
    expect(writes.subscriptions).toBeUndefined()
    expect(writes.schools).toBeUndefined()
    expect(writes.teachers).toBeUndefined()
  })

  // ── plan-precedence guard ──
  it('plan-precedence: a lower-ranked student sub does NOT clobber an active tutor-bundle row, but tag/enrolment still run', async () => {
    responders.classes = () => ({ data: { school_id: null, course_code: 'cym_for_eng' }, error: null })
    responders.learners = () => ({ data: { id: 'learner-1' }, error: null })
    responders.subscriptions = (calls) => {
      const sel = String(calls.find((c) => c[0] === 'select')?.[1] || '')
      if (sel.includes('plan_name')) return { data: { plan_name: 'SSi Premium (tutor bundle)', status: 'active' }, error: null }
      if (sel.includes('id')) return { data: { id: 'sub-existing' }, error: null }
      return { data: null, error: null }
    }
    responders.learner_emails = () => ({ data: [], error: null })
    currentEvent = subEvent(
      { kind: 'student_via_teacher', supabase_user_id: 'user-x', class_id: 'class-1' },
      { items: [{ price: { id: STUDENT_TUTOR_PRICE }, quantity: 1 }] },
    )
    const res = makeRes()
    await handler(makeReq(), res)

    expect(res._status).toBe(200)
    // Guard suppressed the ROW clobber — no lower-ranked upsert onto subscriptions.
    expect((writes.subscriptions || []).some((w) => w.op === 'upsert')).toBe(false)
    // ...but the orthogonal side effects still ran against the existing row.
    expect(writes.teacher_referrals.find((w) => w.op === 'upsert')!.payload).toMatchObject({ subscription_id: 'sub-existing' })
    expect(writes.user_tags.some((w) => w.op === 'upsert')).toBe(true)
    expect(writes.course_enrollments.some((w) => w.op === 'upsert')).toBe(true)
  })

  // ── transaction.paid commission accrual ──
  function txnEvent(overrides: any = {}): any {
    return {
      eventType: EventName.TransactionPaid,
      eventId: `evt-${++evtCounter}`,
      data: { id: 'txn-1', subscriptionId: 'psub_1', billedAt: '2026-07-17T00:00:00Z', details: { totals: { grandTotal: '1000' } }, ...overrides },
    }
  }

  it('transaction.paid on a tutor referral accrues a £5 held commission', async () => {
    responders.subscriptions = () => ({ data: { id: 'sub-1', learner_id: 'learner-1', plan_name: 'SSi Student Access' }, error: null })
    responders.teacher_referrals = () => ({ data: { class_id: 'class-1', locked_price_pence: 1000 }, error: null })
    responders.classes = () => ({ data: { teacher_user_id: 'tuid' }, error: null })
    responders.learners = () => ({ data: { id: 'tlearner' }, error: null })
    responders.teachers = () => ({ data: { id: 'teacher-1' }, error: null })
    currentEvent = txnEvent()
    const res = makeRes()
    await handler(makeReq(), res)

    expect(res._status).toBe(200)
    const accrue = rpcCalls.find((c) => c.name === 'accrue_teacher_commission_held')
    expect(accrue).toBeDefined()
    expect(accrue!.params).toMatchObject({ p_teacher_id: 'teacher-1', p_pence: 500 })
  })

  it('transaction.paid on a SCHOOL referral (locked 500) accrues no commission', async () => {
    responders.subscriptions = () => ({ data: { id: 'sub-1', learner_id: 'learner-1', plan_name: 'SSi Student Access' }, error: null })
    responders.teacher_referrals = () => ({ data: { class_id: 'class-1', locked_price_pence: 500 }, error: null })
    currentEvent = txnEvent()
    const res = makeRes()
    await handler(makeReq(), res)

    expect(res._status).toBe(200)
    expect(rpcCalls.some((c) => c.name === 'accrue_teacher_commission_held')).toBe(false)
  })

  it('transaction.paid that collected £0 accrues no commission even for a tutor referral', async () => {
    responders.subscriptions = () => ({ data: { id: 'sub-1', learner_id: 'learner-1', plan_name: 'SSi Student Access' }, error: null })
    responders.teacher_referrals = () => ({ data: { class_id: 'class-1', locked_price_pence: 1000 }, error: null })
    currentEvent = txnEvent({ details: { totals: { grandTotal: '0' } } })
    const res = makeRes()
    await handler(makeReq(), res)

    expect(res._status).toBe(200)
    expect(rpcCalls.some((c) => c.name === 'accrue_teacher_commission_held')).toBe(false)
  })

  // ── adjustment (refund / chargeback) ──
  function adjEvent(action: string, overrides: any = {}): any {
    return {
      eventType: EventName.AdjustmentCreated,
      eventId: `evt-${++evtCounter}`,
      data: { id: 'adj-1', action, subscriptionId: 'psub_1', transactionId: 'txn-1', createdAt: '2026-07-17T00:00:00Z', totals: { total: '1000' }, ...overrides },
    }
  }

  it('adjustment full refund revokes the entitlement (subscription → cancelled)', async () => {
    responders.subscriptions = () => ({ data: { id: 'sub-1', learner_id: 'learner-1' }, error: null })
    responders.teacher_referrals = () => ({ data: { class_id: 'class-1', locked_price_pence: 500 }, error: null })
    txnGetResult = { details: { totals: { grandTotal: '1000' } } } // full refund
    currentEvent = adjEvent('refund')
    const res = makeRes()
    await handler(makeReq(), res)

    expect(res._status).toBe(200)
    const upd = writes.subscriptions.find((w) => w.op === 'update')!
    expect(upd.payload).toMatchObject({ status: 'cancelled', cancel_at_period_end: true })
  })

  it('adjustment chargeback revokes AND reverses the tutor commission', async () => {
    responders.subscriptions = () => ({ data: { id: 'sub-1', learner_id: 'learner-1' }, error: null })
    responders.teacher_referrals = () => ({ data: { class_id: 'class-1', locked_price_pence: 1000 }, error: null })
    responders.classes = () => ({ data: { teacher_user_id: 'tuid' }, error: null })
    responders.learners = () => ({ data: { id: 'tlearner' }, error: null })
    responders.teachers = () => ({ data: { id: 'teacher-1' }, error: null })
    currentEvent = adjEvent('chargeback')
    const res = makeRes()
    await handler(makeReq(), res)

    expect(res._status).toBe(200)
    expect(writes.subscriptions.find((w) => w.op === 'update')!.payload).toMatchObject({ status: 'cancelled' })
    const reverse = rpcCalls.find((c) => c.name === 'reverse_teacher_commission')
    expect(reverse).toBeDefined()
    expect(reverse!.params).toMatchObject({ p_teacher_id: 'teacher-1', p_pence: 500 })
  })

  it('adjustment chargeback_warning is a no-op (no revocation)', async () => {
    responders.subscriptions = () => ({ data: { id: 'sub-1', learner_id: 'learner-1' }, error: null })
    currentEvent = adjEvent('chargeback_warning')
    const res = makeRes()
    await handler(makeReq(), res)

    expect(res._status).toBe(200)
    expect(writes.subscriptions).toBeUndefined()
  })

  it('idempotency (replay): processing the same event id twice writes the subscription only once', async () => {
    responders.learners = () => ({ data: { id: 'learner-1' }, error: null })
    responders.subscriptions = (calls) => {
      if (calls.some((c) => c[0] === 'upsert')) return { data: { id: 'sub-1' }, error: null }
      return { data: null, error: null }
    }
    const evt = subEvent({ kind: 'learner_premium', supabase_user_id: 'user-x' })
    currentEvent = evt
    await handler(makeReq(), makeRes()) // first delivery
    currentEvent = evt // same eventId → dedup 23505 on replay
    await handler(makeReq(), makeRes())

    expect(writes.subscriptions.filter((w) => w.op === 'upsert')).toHaveLength(1)
  })
})
