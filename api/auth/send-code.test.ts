/**
 * POST /api/auth/send-code — the delivery-instrumentation contract.
 *
 * The one thing proved here is the thing 2026-09-07 was missing: the audit row
 * carries the Resend message id, which is the only join key between our record
 * of the send and Resend's later delivered/delayed/bounced webhook. Without it
 * "was the code slow, and where" is a forensic session; with it, one query.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

process.env.SUPABASE_URL = 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'
process.env.RESEND_API_KEY = 'test-resend-key'

let inserted: any[] = []
/** What the audit table answers for "sends in the window": how many, and the oldest. */
let attempts: { count: number; created_at: string | null } = { count: 0, created_at: null }

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => {
      const builder: any = {
        select: () => builder,
        eq: () => builder,
        in: () => builder,
        gte: () => builder,
        order: () => builder,
        limit: () => Promise.resolve({
          data: attempts.created_at ? [{ created_at: attempts.created_at }] : [],
          count: attempts.count,
          error: null,
        }),
        insert: (row: any) => {
          inserted.push(row)
          return Promise.resolve({ error: null })
        },
      }
      return builder
    },
    auth: {
      admin: {
        generateLink: async () => ({ data: { properties: { email_otp: '123456' } }, error: null }),
      },
    },
  }),
}))

function makeRes() {
  const res: any = { statusCode: 0, body: null, headers: {} as Record<string, string> }
  res.status = (c: number) => { res.statusCode = c; return res }
  res.json = (b: any) => { res.body = b; return res }
  res.setHeader = (k: string, v: string) => { res.headers[k] = v; return res }
  res.end = () => res
  return res as VercelResponse & { statusCode: number; body: any }
}

const req = (email: string) => ({
  method: 'POST',
  body: { email },
  headers: {},
  socket: { remoteAddress: '203.0.113.9' },
}) as unknown as VercelRequest

describe('send-code delivery instrumentation', () => {
  beforeEach(() => {
    inserted = []
    attempts = { count: 0, created_at: null }
    vi.restoreAllMocks()
  })

  it('records the Resend message id on the audit row', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ id: 'a5c0e524-064b-4c7c-aa89-8af458bc1d86' }),
      text: async () => '',
    })))

    const { default: handler } = await import('./send-code')
    const res = makeRes()
    await handler(req('teacher@example.com'), res)

    expect(res.statusCode).toBe(200)
    const sent = inserted.find(r => r.outcome === 'signin_code_sent')
    expect(sent).toBeTruthy()
    expect(sent.resend_message_id).toBe('a5c0e524-064b-4c7c-aa89-8af458bc1d86')
  })

  it('still logs the send when Resend answers without a usable id', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => { throw new Error('not json') },
      text: async () => '',
    })))

    const { default: handler } = await import('./send-code')
    const res = makeRes()
    await handler(req('teacher2@example.com'), res)

    // Instrumentation must never cost anybody a sign-in.
    expect(res.statusCode).toBe(200)
    const sent = inserted.find(r => r.outcome === 'signin_code_sent')
    expect(sent).toBeTruthy()
    expect(sent.resend_message_id).toBeNull()
  })
})

/**
 * THE REFUSAL MUST QUOTE THE REAL WINDOW.
 *
 * This shipped saying "Give it a couple of minutes, then try again" on top of a
 * fifteen-minute rolling limit. Someone who waits the couple of minutes they
 * were promised is refused again and concludes sign-in is broken — the precise
 * belief the sentence existed to prevent. The wait is now derived from the
 * oldest counted send, so it moves with WINDOW_MS instead of drifting from it.
 */
describe('send-code refusal tells the truth about the wait', () => {
  beforeEach(() => {
    inserted = []
    attempts = { count: 0, created_at: null }
    vi.restoreAllMocks()
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ id: 'x' }), text: async () => '' })))
  })

  it('quotes the minutes left on the window, not a hand-written number', async () => {
    // Five sends in the window, the oldest three minutes ago: twelve to go.
    attempts = { count: 5, created_at: new Date(Date.now() - 3 * 60_000).toISOString() }

    const { default: handler } = await import('./send-code')
    const res = makeRes()
    await handler(req('busy@example.com'), res)

    expect(res.statusCode).toBe(429)
    expect(res.body.error).toContain('in about 12 minutes')
    expect(res.body.error).not.toContain('couple of minutes')
    expect(res.body.retryAfterSeconds).toBe(12 * 60)
    expect(res.headers['Retry-After']).toBe(String(12 * 60))
  })

  it('falls back to the whole window when the oldest send is unknown', async () => {
    attempts = { count: 5, created_at: null }

    const { default: handler } = await import('./send-code')
    const res = makeRes()
    await handler(req('busy2@example.com'), res)

    expect(res.statusCode).toBe(429)
    expect(res.body.error).toContain('in about 15 minutes')
  })
})
