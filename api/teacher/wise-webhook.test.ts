/**
 * Characterization tests for POST /api/teacher/wise-webhook.
 *
 * Pins CURRENT behavior of the payout reconciliation:
 *   - method / signature guards, invalid-JSON, ignored non-transfer events.
 *   - outgoing_payment_sent → teacher_commissions.status='paid' (only from
 *     pending_payout).
 *   - charged_back → status='failed' (from pending_payout OR paid).
 *   - transient failure (bounced_back) → re-queued to 'accruing', wise ids cleared.
 *   - idempotency: a re-delivered event (processed_webhook_events 23505) no-ops.
 *
 * Signature verification is mocked (verifyWiseWebhook) — the crypto path is
 * covered elsewhere; here we pin the handler's row writes and guard outcomes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

process.env.SUPABASE_URL = 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'

let sigValid = true
vi.mock('../_utils/wise', () => ({
  verifyWiseWebhook: vi.fn(() => sigValid),
}))

// Records each write per table, with the eq/in filters that accompanied it.
let writes: Record<string, any[]> = {}
let responders: Record<string, (calls: any[][]) => any> = {}

function recordWrite(table: string, op: string, payload: unknown, calls: any[][]) {
  writes[table] = writes[table] || []
  // `calls` is the LIVE chain array — eq()/in() are appended AFTER update(), so
  // expose it lazily and derive filters at assertion time.
  writes[table].push({
    op,
    payload,
    get filters() { return calls.filter((c) => c[0] === 'eq' || c[0] === 'in') },
  })
}

function makeChainable(table: string) {
  const calls: any[][] = []
  const builder: any = {
    select: (c: string) => { calls.push(['select', c]); return builder },
    insert: (o: unknown) => { calls.push(['insert', o]); recordWrite(table, 'insert', o, calls); return builder },
    update: (o: unknown) => { calls.push(['update', o]); recordWrite(table, 'update', o, calls); return builder },
    delete: () => { calls.push(['delete']); recordWrite(table, 'delete', undefined, calls); return builder },
    eq: (col: string, val: unknown) => { calls.push(['eq', col, val]); return builder },
    in: (col: string, vals: unknown[]) => { calls.push(['in', col, vals]); return builder },
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

function makeReq(rawBody: string, headers: Record<string, string> = { 'x-signature-sha256': 'sig' }, method = 'POST'): VercelRequest {
  const req: any = {
    method,
    headers,
    on(event: string, cb: (arg?: any) => void) {
      if (event === 'data' && rawBody) cb(Buffer.from(rawBody, 'utf8'))
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

function transferEvent(currentState: string, transferId: number | string = 9001): string {
  return JSON.stringify({
    event_type: 'transfers#state-change',
    data: { resource: { id: transferId, type: 'transfer' }, current_state: currentState, occurred_at: '2026-07-17T00:00:00Z' },
  })
}

describe('POST /api/teacher/wise-webhook', () => {
  let handler: typeof import('./wise-webhook').default

  beforeEach(async () => {
    vi.resetModules()
    writes = {}
    responders = {}
    sigValid = true
    handler = (await import('./wise-webhook')).default
  })

  it('rejects a non-POST method', async () => {
    const res = makeRes()
    await handler(makeReq('', {}, 'GET'), res)
    expect(res._status).toBe(405)
  })

  it('rejects a bad signature with 401', async () => {
    sigValid = false
    const res = makeRes()
    await handler(makeReq(transferEvent('outgoing_payment_sent')), res)
    expect(res._status).toBe(401)
    expect(writes.teacher_commissions).toBeUndefined()
  })

  it('400s on invalid JSON with a valid signature', async () => {
    const res = makeRes()
    await handler(makeReq('not-json{'), res)
    expect(res._status).toBe(400)
  })

  it('ignores a non-transfer / incomplete event (200, no write)', async () => {
    const res = makeRes()
    await handler(makeReq(JSON.stringify({ event_type: 'balances#credit', data: {} })), res)
    expect(res._status).toBe(200)
    expect(res._json).toMatchObject({ received: true, ignored: true })
    expect(writes.teacher_commissions).toBeUndefined()
  })

  it('happy path: outgoing_payment_sent marks the awaiting-payout row paid', async () => {
    responders.processed_webhook_events = () => ({ error: null })
    responders.teacher_commissions = () => ({ data: [{ id: 'tc-1' }], error: null })
    const res = makeRes()
    await handler(makeReq(transferEvent('outgoing_payment_sent')), res)

    expect(res._status).toBe(200)
    expect(res._json).toEqual({ received: true })
    const upd = writes.teacher_commissions.find((w) => w.op === 'update')!
    expect(upd.payload).toMatchObject({ status: 'paid', paid_at: '2026-07-17T00:00:00Z' })
    // Only promotes a pending_payout row, keyed by wise_transfer_id.
    expect(upd.filters).toEqual(expect.arrayContaining([
      ['eq', 'wise_transfer_id', '9001'],
      ['in', 'status', ['pending_payout']],
    ]))
  })

  it('charged_back marks the row failed, demoting pending_payout OR paid', async () => {
    responders.processed_webhook_events = () => ({ error: null })
    responders.teacher_commissions = () => ({ data: [{ id: 'tc-1' }], error: null })
    const res = makeRes()
    await handler(makeReq(transferEvent('charged_back')), res)

    expect(res._status).toBe(200)
    const upd = writes.teacher_commissions.find((w) => w.op === 'update')!
    expect(upd.payload).toMatchObject({ status: 'failed', failure_reason: 'Wise: charged_back' })
    expect(upd.filters).toEqual(expect.arrayContaining([['in', 'status', ['pending_payout', 'paid']]]))
  })

  it('transient failure (bounced_back) re-queues to accruing and clears wise linkage', async () => {
    responders.processed_webhook_events = () => ({ error: null })
    responders.teacher_commissions = () => ({ data: [{ id: 'tc-1' }], error: null })
    const res = makeRes()
    await handler(makeReq(transferEvent('bounced_back')), res)

    expect(res._status).toBe(200)
    const upd = writes.teacher_commissions.find((w) => w.op === 'update')!
    expect(upd.payload).toMatchObject({ status: 'accruing', wise_transfer_id: null, wise_batch_group_id: null })
    expect(upd.filters).toEqual(expect.arrayContaining([['in', 'status', ['pending_payout']]]))
  })

  it('idempotency: a re-delivered event (dedup 23505) is a no-op', async () => {
    responders.processed_webhook_events = () => ({ error: { code: '23505', message: 'dup' } })
    const res = makeRes()
    await handler(makeReq(transferEvent('outgoing_payment_sent')), res)

    expect(res._status).toBe(200)
    expect(res._json).toMatchObject({ received: true, deduped: true })
    expect(writes.teacher_commissions).toBeUndefined()
  })

  it('intermediate state (processing) is logged only — 200, no commission write', async () => {
    responders.processed_webhook_events = () => ({ error: null })
    const res = makeRes()
    await handler(makeReq(transferEvent('processing')), res)
    expect(res._status).toBe(200)
    expect(res._json).toEqual({ received: true })
    expect(writes.teacher_commissions).toBeUndefined()
  })
})
