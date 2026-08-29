/**
 * SEC29-C — webhooks, cron, and the software supply chain (2026-08-29).
 *
 * Scope: api/teacher/paddle-webhook.ts, api/teacher/wise-webhook.ts,
 * api/cron/teacher-payouts.ts, api/cron/expire-demo-schools.ts. Full writeup:
 * docs/security-audit-2026-08-29/area-c-webhooks-cron-supplychain.md
 *
 * LOCKS (pass today, must keep passing):
 *   - Wise webhook signature verification fails CLOSED when
 *     WISE_WEBHOOK_PUBLIC_KEY is unset, and rejects a signature that does not
 *     verify against a real key. It never proceeds to parse/act on the body
 *     without a passing RSA verification.
 *   - Both cron handlers fail CLOSED in production when CRON_SECRET is unset,
 *     and reject a wrong bearer token in production.
 *
 * CHARACTERIZATIONS (pass today, describe a live but bounded issue):
 *   SEC29-C-01 (medium) — api/_utils/paddle.ts's `webhookSecret` is read once
 *     at import with NO presence check (contrast api/_utils/wise.ts, which
 *     verifyWiseWebhook explicitly fails closed on a missing key). Paddle's
 *     signature scheme is `HMAC-SHA256(ts:body, secret)`, and Node's
 *     `createHmac` accepts an empty-string key without error. If
 *     PADDLE_WEBHOOK_SECRET is ever unset/empty in a deployed environment
 *     (misconfigured env var, a preview deploy missing the var), the SDK's
 *     `paddle.webhooks.unmarshal(rawBody, '', signature)` call in
 *     paddle-webhook.ts's handler ACCEPTS any request whose signature is
 *     `HMAC-SHA256('${ts}:${rawBody}', '')` — a value any attacker can compute
 *     themselves, because the "secret" is a public constant (the empty
 *     string). This is the same class of bug the teacher-payouts /
 *     expire-demo-schools crons were explicitly hardened against ("Previously
 *     an unset CRON_SECRET skipped the check entirely… leaving the endpoint
 *     open" — see their own comments) — paddle-webhook.ts never got the
 *     equivalent guard. Bounded: only reachable if the env var is actually
 *     unset/empty in a deployed environment; there is no evidence that is the
 *     case in production today, and the trust-boundary hardening downstream
 *     (billingIntent/billingBinding, SEC22-05) still stands between a forged
 *     event and a tenant write. Characterized directly against the real
 *     @paddle/paddle-node-sdk, not a mock — this is upstream SDK behaviour
 *     the app-level code must guard, not a bug in the SDK itself.
 *   SEC29-C-02 (info) — the Paddle SDK's own signature comparison
 *     (`computedHash === headers.h1` in webhooks-validator.js) is a plain
 *     string equality, not `crypto.timingSafeEqual`. Third-party code, not
 *     ours to patch; a network-observable timing side-channel on an HMAC
 *     compare is a low-practicality attack but a real defect class. Noted,
 *     not characterized with a test (would only test the vendored SDK).
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import { createHmac } from 'node:crypto'
import type { VercelRequest, VercelResponse } from '@vercel/node'

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-key'
process.env.VITE_SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://example.supabase.co'

// ── helpers ──────────────────────────────────────────────────────────────

function makeRes(): VercelResponse & { statusCode?: number; body?: any } {
  const res: any = {}
  res.status = vi.fn((code: number) => {
    res.statusCode = code
    return res
  })
  res.json = vi.fn((body: any) => {
    res.body = body
    return res
  })
  return res
}

function makeJsonReq(opts: {
  method?: string
  headers?: Record<string, string>
  body?: any
}): VercelRequest {
  return {
    method: opts.method || 'POST',
    headers: opts.headers || {},
    body: opts.body,
  } as any
}

// ── SEC29-C-01: Paddle signature verification with an empty secret ────────
// Exercises the REAL @paddle/paddle-node-sdk (not a mock) — this is upstream
// library behaviour the app must guard against, characterized directly.

describe('SEC29-C-01: Paddle webhook signature — empty-secret fail-open (characterization)', () => {
  it('accepts a self-forged signature when the webhook secret is empty, using the real SDK', async () => {
    const { Paddle, Environment } = await import('@paddle/paddle-node-sdk')
    const paddle = new Paddle('test-key', { environment: Environment.sandbox })

    // Simulates PADDLE_WEBHOOK_SECRET being unset/empty (api/_utils/paddle.ts
    // has no presence check, so `webhookSecret` would be '' in this state).
    const secret = ''
    const body = JSON.stringify({
      event_type: 'sec29-c-01.attacker.forged',
      event_id: 'evt_attacker_forged',
      data: {},
    })
    const ts = Math.floor(Date.now() / 1000)
    // An attacker computes this themselves — HMAC-SHA256 with a known,
    // public, empty key requires no secret knowledge at all.
    const h1 = createHmac('sha256', secret).update(`${ts}:${body}`).digest('hex')
    const forgedSignature = `ts=${ts};h1=${h1}`

    // SECURITY FINDING SEC29-C-01: this is exactly the call paddle-webhook.ts
    // makes (`paddle.webhooks.unmarshal(rawBody, webhookSecret, signature)`).
    // With webhookSecret === '', it does NOT throw "signature verification
    // failed" — it returns the parsed, attacker-controlled event.
    const event = await paddle.webhooks.unmarshal(body, secret, forgedSignature)
    expect(event.eventType).toBe('sec29-c-01.attacker.forged')
    expect(event.eventId).toBe('evt_attacker_forged')
  })

  it.todo(
    'SEC29-C-01 fix: api/_utils/paddle.ts (or the handler) must fail closed ' +
      'in production when PADDLE_WEBHOOK_SECRET is unset/empty, mirroring the ' +
      'CRON_SECRET and ENTITLEMENT_TOKEN_SECRET posture elsewhere in this repo ' +
      "(refuse with 500 rather than calling unmarshal with a forgeable ''key)."
  )

  it('a non-empty secret cannot be forged without knowing it', async () => {
    const { Paddle, Environment } = await import('@paddle/paddle-node-sdk')
    const paddle = new Paddle('test-key', { environment: Environment.sandbox })

    const realSecret = 'pdl_ntfset_real_secret_the_attacker_does_not_know'
    const body = JSON.stringify({ event_type: 'sec29-c-01.control', event_id: 'evt_control', data: {} })
    const ts = Math.floor(Date.now() / 1000)
    // Attacker guesses an empty secret (their only free move) — wrong.
    const attackerSig = `ts=${ts};h1=${createHmac('sha256', '').update(`${ts}:${body}`).digest('hex')}`

    await expect(paddle.webhooks.unmarshal(body, realSecret, attackerSig)).rejects.toThrow(
      /signature/i
    )
  })
})

// ── Wise webhook: verifyWiseWebhook fails closed (lock) ────────────────────

describe('Wise webhook signature verification (lock — control holds)', () => {
  const ORIGINAL_KEY = process.env.WISE_WEBHOOK_PUBLIC_KEY

  beforeEach(() => {
    vi.resetModules()
    if (ORIGINAL_KEY === undefined) delete process.env.WISE_WEBHOOK_PUBLIC_KEY
    else process.env.WISE_WEBHOOK_PUBLIC_KEY = ORIGINAL_KEY
  })

  it('fails closed (returns false) when WISE_WEBHOOK_PUBLIC_KEY is unset — unlike Paddle', async () => {
    delete process.env.WISE_WEBHOOK_PUBLIC_KEY
    vi.resetModules()
    const { verifyWiseWebhook } = await import('../_utils/wise')
    const ok = verifyWiseWebhook('{"event_type":"transfers#state-change"}', 'anything==')
    expect(ok).toBe(false)
  })

  it('fails closed when the signature header is missing', async () => {
    process.env.WISE_WEBHOOK_PUBLIC_KEY = '-----BEGIN PUBLIC KEY-----\nMFakeKey\n-----END PUBLIC KEY-----'
    vi.resetModules()
    const { verifyWiseWebhook } = await import('../_utils/wise')
    const ok = verifyWiseWebhook('{"event_type":"transfers#state-change"}', undefined)
    expect(ok).toBe(false)
  })

  it('rejects a signature that does not verify against a real RSA keypair (no accidental accept)', async () => {
    const { generateKeyPairSync, sign } = await import('node:crypto')
    const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
    const pem = publicKey.export({ type: 'spki', format: 'pem' }).toString()
    process.env.WISE_WEBHOOK_PUBLIC_KEY = pem
    vi.resetModules()
    const { verifyWiseWebhook } = await import('../_utils/wise')

    // Attacker has no private key — sends a plausible-looking but wrong signature.
    const ok = verifyWiseWebhook('{"event_type":"transfers#state-change"}', Buffer.from('not-a-real-signature').toString('base64'))
    expect(ok).toBe(false)
  })

  it('accepts a signature genuinely produced by the matching private key (positive control)', async () => {
    const { generateKeyPairSync, createSign } = await import('node:crypto')
    const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
    const pem = publicKey.export({ type: 'spki', format: 'pem' }).toString()
    process.env.WISE_WEBHOOK_PUBLIC_KEY = pem
    vi.resetModules()
    const { verifyWiseWebhook } = await import('../_utils/wise')

    const body = '{"event_type":"transfers#state-change","data":{"resource":{"id":1},"current_state":"outgoing_payment_sent"}}'
    const signer = createSign('RSA-SHA256')
    signer.update(Buffer.from(body, 'utf8'))
    signer.end()
    const sig = signer.sign(privateKey, 'base64')

    const ok = verifyWiseWebhook(body, sig)
    expect(ok).toBe(true)
  })
})

// ── Cron secret gate: teacher-payouts.ts / expire-demo-schools.ts (lock) ──

describe('Cron auth gate — fails closed in production (lock — control holds)', () => {
  const ORIGINAL_ENV = { ...process.env }

  beforeEach(() => {
    vi.resetModules()
    vi.doMock('@supabase/supabase-js', () => ({
      createClient: () => ({
        from: () => ({
          select: () => ({
            eq: () => ({ not: () => ({ lte: () => Promise.resolve({ data: [], error: null }) }) }),
            lte: () => Promise.resolve({ data: [], error: null }),
          }),
        }),
      }),
    }))
    vi.doMock('../_utils/wise', () => ({
      wiseApi: vi.fn(),
      requireProfileId: vi.fn(() => 'profile-1'),
    }))
  })

  const setEnv = (overrides: Record<string, string | undefined>) => {
    for (const [k, v] of Object.entries(overrides)) {
      if (v === undefined) delete (process.env as any)[k]
      else (process.env as any)[k] = v
    }
  }

  it('teacher-payouts.ts: refuses with 500 in production when CRON_SECRET is unset', async () => {
    setEnv({ NODE_ENV: 'production', VERCEL_ENV: 'production', CRON_SECRET: '' })
    vi.resetModules()
    const handler = (await import('../cron/teacher-payouts')).default
    const req = makeJsonReq({ headers: {} })
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(500)
    expect(JSON.stringify(res.body)).toMatch(/CRON_SECRET/)
  })

  it('teacher-payouts.ts: rejects a wrong bearer token in production with 401', async () => {
    setEnv({ NODE_ENV: 'production', VERCEL_ENV: 'production', CRON_SECRET: 'the-real-secret' })
    vi.resetModules()
    const handler = (await import('../cron/teacher-payouts')).default
    const req = makeJsonReq({ headers: { authorization: 'Bearer guessed-wrong' } })
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(401)
  })

  it('expire-demo-schools.ts: refuses with 500 in production when CRON_SECRET is unset', async () => {
    setEnv({ NODE_ENV: 'production', VERCEL_ENV: 'production', CRON_SECRET: '' })
    vi.resetModules()
    const handler = (await import('../cron/expire-demo-schools')).default
    const req = makeJsonReq({ headers: {} })
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(500)
    expect(JSON.stringify(res.body)).toMatch(/CRON_SECRET/)
  })

  it('expire-demo-schools.ts: rejects a wrong bearer token in production with 401', async () => {
    setEnv({ NODE_ENV: 'production', VERCEL_ENV: 'production', CRON_SECRET: 'the-real-secret' })
    vi.resetModules()
    const handler = (await import('../cron/expire-demo-schools')).default
    const req = makeJsonReq({ headers: { authorization: 'Bearer guessed-wrong' } })
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(401)
  })

  afterAll(() => {
    process.env = ORIGINAL_ENV
  })
})

// Keep the "streaming raw-body reader" helper exercised so a future refactor
// of paddle-webhook.ts / wise-webhook.ts that stops disabling bodyParser (and
// therefore stops reading the RAW bytes for the signature check) is caught —
// this is the single most important invariant of both handlers.
describe('Webhook handlers keep bodyParser disabled (lock — raw body required for signature)', () => {
  it('paddle-webhook.ts exports config.api.bodyParser = false', async () => {
    const mod = await import('../teacher/paddle-webhook')
    expect((mod as any).config?.api?.bodyParser).toBe(false)
  })

  it('wise-webhook.ts exports config.api.bodyParser = false', async () => {
    const mod = await import('../teacher/wise-webhook')
    expect((mod as any).config?.api?.bodyParser).toBe(false)
  })
})
