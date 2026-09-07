/**
 * POST /api/auth/resend-delivery-webhook — signature gate and event stamping.
 *
 * The route is public and writes to a live table, so the signature check is
 * the load-bearing part and is tested hardest: a valid signature stamps, and
 * every way of not having one is refused with 401 and NO write.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHmac } from 'crypto'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { verifySvixSignature, SVIX_TOLERANCE_MS } from '../_utils/svixSignature'
import { parseDeliveryEvent } from './resend-delivery-webhook'

/** Test-only signing secret. The live one lives in RESEND_WEBHOOK_SECRET and is never in the repo. */
const SECRET = 'whsec_' + Buffer.from('svix-test-signing-secret').toString('base64')

// Set BEFORE the handler is imported: its supabase/secret consts read env at module load,
// and static imports are hoisted above everything else in the file.
process.env.SUPABASE_URL = 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'
process.env.RESEND_WEBHOOK_SECRET = SECRET

function sign(id: string, tsSeconds: number, body: string, secret = SECRET) {
  const key = Buffer.from(secret.slice('whsec_'.length), 'base64')
  return 'v1,' + createHmac('sha256', key).update(`${id}.${tsSeconds}.${body}`).digest('base64')
}

describe('verifySvixSignature', () => {
  const body = '{"type":"email.delivered"}'
  const ts = Math.floor(Date.UTC(2026, 8, 7, 12, 0, 0) / 1000)
  const now = ts * 1000

  it('accepts a correctly signed payload', () => {
    const r = verifySvixSignature({
      secret: SECRET, body, svixId: 'msg_1', svixTimestamp: String(ts),
      svixSignature: sign('msg_1', ts, body), nowMs: now,
    })
    expect(r.ok).toBe(true)
  })

  it('accepts when the correct signature is one of several offered', () => {
    const header = 'v1,ZmFrZQ== ' + sign('msg_1', ts, body)
    const r = verifySvixSignature({
      secret: SECRET, body, svixId: 'msg_1', svixTimestamp: String(ts),
      svixSignature: header, nowMs: now,
    })
    expect(r.ok).toBe(true)
  })

  it('rejects a payload signed with a different secret', () => {
    const other = 'whsec_' + Buffer.from('a-different-signing-secret').toString('base64')
    const r = verifySvixSignature({
      secret: SECRET, body, svixId: 'msg_1', svixTimestamp: String(ts),
      svixSignature: sign('msg_1', ts, body, other), nowMs: now,
    })
    expect(r).toEqual({ ok: false, reason: 'signature mismatch' })
  })

  it('rejects a tampered body under an otherwise valid signature', () => {
    const r = verifySvixSignature({
      secret: SECRET, body: body.replace('delivered', 'bounced'),
      svixId: 'msg_1', svixTimestamp: String(ts),
      svixSignature: sign('msg_1', ts, body), nowMs: now,
    })
    expect(r.ok).toBe(false)
  })

  it('rejects a replay outside the tolerance window', () => {
    const r = verifySvixSignature({
      secret: SECRET, body, svixId: 'msg_1', svixTimestamp: String(ts),
      svixSignature: sign('msg_1', ts, body), nowMs: now + SVIX_TOLERANCE_MS + 1000,
    })
    expect(r).toEqual({ ok: false, reason: 'timestamp outside tolerance' })
  })

  it('rejects when headers are absent', () => {
    const r = verifySvixSignature({ secret: SECRET, body, svixId: undefined, svixTimestamp: undefined, svixSignature: undefined })
    expect(r).toEqual({ ok: false, reason: 'missing svix headers' })
  })

  it('rejects when no secret is configured, rather than passing everything', () => {
    const r = verifySvixSignature({
      secret: '', body, svixId: 'msg_1', svixTimestamp: String(ts),
      svixSignature: sign('msg_1', ts, body), nowMs: now,
    })
    expect(r.ok).toBe(false)
  })
})

describe('parseDeliveryEvent', () => {
  const base = {
    created_at: '2026-09-07T12:44:02.000Z',
    data: { email_id: 'a5c0e524-064b-4c7c-aa89-8af458bc1d86', created_at: '2026-09-07T12:43:34.978Z' },
  }

  it('maps each stamped event to its own column', () => {
    expect(parseDeliveryEvent({ ...base, type: 'email.delivered' })?.column).toBe('delivered_at')
    expect(parseDeliveryEvent({ ...base, type: 'email.delivery_delayed' })?.column).toBe('delivery_delayed_at')
    expect(parseDeliveryEvent({ ...base, type: 'email.bounced' })?.column).toBe('bounced_at')
  })

  it("uses the EVENT's timestamp, not the message's", () => {
    expect(parseDeliveryEvent({ ...base, type: 'email.delivered' })?.at).toBe('2026-09-07T12:44:02.000Z')
  })

  it('accepts the space-separated timestamp form Resend also emits', () => {
    const e = parseDeliveryEvent({ ...base, created_at: '2026-09-07 12:44:02.000+00', type: 'email.delivered' })
    expect(e?.at).toBe('2026-09-07T12:44:02.000Z')
  })

  it('ignores events we do not stamp, and events with no message id', () => {
    expect(parseDeliveryEvent({ ...base, type: 'email.opened' })).toBeNull()
    expect(parseDeliveryEvent({ ...base, type: 'email.delivered', data: {} })).toBeNull()
    expect(parseDeliveryEvent(null)).toBeNull()
  })
})

// ---- the handler, end to end over the mocked table ----

let updates: any[] = []
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => ({
      update: (patch: any) => ({
        eq: (col: string, val: any) => ({
          select: () => {
            updates.push({ table, patch, col, val })
            return Promise.resolve({ data: [{ id: 'row-1' }], error: null })
          },
        }),
      }),
    }),
  }),
}))

function makeReq(body: string, headers: Record<string, string>) {
  const req: any = {
    method: 'POST',
    headers,
    on: (evt: string, cb: any) => {
      if (evt === 'data') cb(Buffer.from(body, 'utf8'))
      if (evt === 'end') cb()
      return req
    },
  }
  return req as VercelRequest
}

function makeRes() {
  const res: any = { statusCode: 0, body: null }
  res.status = (c: number) => { res.statusCode = c; return res }
  res.json = (b: any) => { res.body = b; return res }
  return res as VercelResponse & { statusCode: number; body: any }
}

describe('resend-delivery-webhook handler', () => {
  const payload = JSON.stringify({
    type: 'email.delivered',
    created_at: '2026-09-07T12:44:02.000Z',
    data: { email_id: 'a5c0e524-064b-4c7c-aa89-8af458bc1d86' },
  })
  const ts = Math.floor(Date.now() / 1000)

  beforeEach(() => { updates = [] })

  it('stamps the matching row on a correctly signed delivered event', async () => {
    const { default: handler } = await import('./resend-delivery-webhook')
    const res = makeRes()
    await handler(makeReq(payload, {
      'svix-id': 'msg_2', 'svix-timestamp': String(ts), 'svix-signature': sign('msg_2', ts, payload),
    }), res)

    expect(res.statusCode).toBe(200)
    expect(updates).toHaveLength(1)
    expect(updates[0]).toMatchObject({
      table: 'possession_mint_attempts',
      patch: { delivered_at: '2026-09-07T12:44:02.000Z' },
      col: 'resend_message_id',
      val: 'a5c0e524-064b-4c7c-aa89-8af458bc1d86',
    })
  })

  it('refuses an unsigned post with 401 and writes nothing', async () => {
    const { default: handler } = await import('./resend-delivery-webhook')
    const res = makeRes()
    await handler(makeReq(payload, {}), res)

    expect(res.statusCode).toBe(401)
    expect(updates).toHaveLength(0)
  })

  it('refuses a forged signature with 401 and writes nothing', async () => {
    const { default: handler } = await import('./resend-delivery-webhook')
    const res = makeRes()
    await handler(makeReq(payload, {
      'svix-id': 'msg_3', 'svix-timestamp': String(ts), 'svix-signature': 'v1,' + Buffer.from('nope').toString('base64'),
    }), res)

    expect(res.statusCode).toBe(401)
    expect(updates).toHaveLength(0)
  })
})
