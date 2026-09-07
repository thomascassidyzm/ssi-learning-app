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

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => {
      const builder: any = {
        select: () => builder,
        eq: () => builder,
        in: () => builder,
        gte: () => Promise.resolve({ count: 0, error: null }),
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
  const res: any = { statusCode: 0, body: null }
  res.status = (c: number) => { res.statusCode = c; return res }
  res.json = (b: any) => { res.body = b; return res }
  res.setHeader = () => res
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
