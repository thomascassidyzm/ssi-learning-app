import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-key'

let verifyAdminResult: any
vi.mock('../_utils/auth', () => ({
  verifyAdmin: vi.fn(async () => verifyAdminResult),
}))

let messageRows: any[] = []
let updateCalls: any[] = []

function makeChainable() {
  const builder: any = {
    select: () => builder,
    order: () => Promise.resolve({ data: messageRows, error: null }),
    update: (obj: unknown) => { updateCalls.push(obj); return builder },
    eq: (col: string, val: unknown) => {
      builder._eqCol = col
      builder._eqVal = val
      return builder
    },
    maybeSingle: () => {
      if (updateCalls.length > 0) {
        const found = messageRows.find(r => r.id === builder._eqVal)
        if (!found) return Promise.resolve({ data: null, error: null })
        Object.assign(found, updateCalls[updateCalls.length - 1])
        return Promise.resolve({ data: found, error: null })
      }
      return Promise.resolve({ data: null, error: null })
    },
  }
  return builder
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: () => makeChainable() }),
}))

let handler: typeof import('./onboarding-messages').default

function makeReq(method: string, body?: unknown): VercelRequest {
  return { method, body, headers: { authorization: 'Bearer tok' } } as any
}

function makeRes(): VercelResponse & { statusCode?: number; body?: any } {
  const res: any = {}
  res.status = vi.fn((code: number) => { res.statusCode = code; return res })
  res.json = vi.fn((body: any) => { res.body = body; return res })
  return res
}

beforeEach(async () => {
  verifyAdminResult = { userId: 'admin-1' }
  messageRows = [
    { id: 'msg-1', message_key: 'verify_email', title: 'Verify your email', channel: 'email', sort_order: 1, active: false },
    { id: 'msg-2', message_key: 'welcome_day1', title: 'The only rule', channel: 'email', sort_order: 2, active: false },
  ]
  updateCalls = []
  handler = (await import('./onboarding-messages')).default
})

describe('onboarding-messages API', () => {
  it('rejects non-admins', async () => {
    verifyAdminResult = { error: 'Requires SSi admin access', status: 403 }
    const res = makeRes()
    await handler(makeReq('GET'), res)
    expect(res.statusCode).toBe(403)
  })

  it('lists messages in series order for admins', async () => {
    const res = makeRes()
    await handler(makeReq('GET'), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.messages).toHaveLength(2)
  })

  it('updates editable fields and stamps updated_by', async () => {
    const res = makeRes()
    await handler(makeReq('POST', { action: 'update', id: 'msg-1', subject: 'New subject', active: true }), res)
    expect(res.statusCode).toBe(200)
    expect(updateCalls[0].subject).toBe('New subject')
    expect(updateCalls[0].active).toBe(true)
    expect(updateCalls[0].updated_by).toBe('admin-1')
    expect(updateCalls[0].updated_at).toBeTruthy()
  })

  it('rejects an invalid channel value', async () => {
    const res = makeRes()
    await handler(makeReq('POST', { action: 'update', id: 'msg-1', channel: 'sms' }), res)
    expect(res.statusCode).toBe(400)
  })

  it('404s on an unknown id', async () => {
    const res = makeRes()
    await handler(makeReq('POST', { action: 'update', id: 'nope', title: 'x' }), res)
    expect(res.statusCode).toBe(404)
  })

  it('rejects a missing action', async () => {
    const res = makeRes()
    await handler(makeReq('POST', { id: 'msg-1', title: 'x' }), res)
    expect(res.statusCode).toBe(400)
  })
})
