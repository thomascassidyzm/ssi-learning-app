import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-key'

let insertedRows: any[]
let insertError: any

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => ({
      insert: vi.fn(async (rows: any) => {
        insertedRows.push(...(Array.isArray(rows) ? rows : [rows]))
        return { error: insertError }
      }),
    }),
  }),
}))

let handler: typeof import('./player-events').default

function makeReq(cookieUserId: string | undefined, body?: any): VercelRequest {
  return {
    method: 'POST',
    headers: { host: 'staging.saysomethingin.app', 'user-agent': 'test-agent' },
    cookies: cookieUserId ? { 'ssi-user-id': cookieUserId } : {},
    body,
  } as any
}

function makeRes(): VercelResponse & { statusCode?: number; body?: any } {
  const res: any = {}
  res.setHeader = vi.fn()
  res.status = vi.fn((code: number) => { res.statusCode = code; return res })
  res.json = vi.fn((body: any) => { res.body = body; return res })
  res.end = vi.fn(() => res)
  return res
}

beforeEach(async () => {
  insertedRows = []
  insertError = null
  handler = (await import('./player-events')).default
})

describe('POST /api/player-events', () => {
  it('accepts a genuine uuid learner_id and stores it on user_id/learner_id', async () => {
    const res = makeRes()
    await handler(
      makeReq('11111111-1111-4111-8111-111111111111', { events: [{ event_type: 'course_load' }] }),
      res,
    )
    expect(res.statusCode).toBe(200)
    expect(insertedRows).toHaveLength(1)
    expect(insertedRows[0].user_id).toBe('11111111-1111-4111-8111-111111111111')
    expect(insertedRows[0].learner_id).toBe('11111111-1111-4111-8111-111111111111')
  })

  it('accepts a guest-shaped cookie and logs with null learner attribution instead of 500ing', async () => {
    const res = makeRes()
    await handler(
      makeReq('guest-1234abcd-1234-1234-1234-1234567890ab', { events: [{ event_type: 'course_load' }] }),
      res,
    )
    expect(res.statusCode).toBe(200)
    expect(insertedRows).toHaveLength(1)
    expect(insertedRows[0].user_id).toBeNull()
    expect(insertedRows[0].learner_id).toBeNull()
  })

  it('accepts no cookie at all with null learner attribution', async () => {
    const res = makeRes()
    await handler(makeReq(undefined, { events: [{ event_type: 'course_load' }] }), res)
    expect(res.statusCode).toBe(200)
    expect(insertedRows[0].user_id).toBeNull()
    expect(insertedRows[0].learner_id).toBeNull()
  })

  it('rejects a non-POST method', async () => {
    const req = makeReq(undefined)
    req.method = 'GET'
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(405)
  })

  it('500s when the insert genuinely fails', async () => {
    insertError = { message: 'boom', code: 'XX000' }
    const res = makeRes()
    await handler(
      makeReq('11111111-1111-4111-8111-111111111111', { events: [{ event_type: 'course_load' }] }),
      res,
    )
    expect(res.statusCode).toBe(500)
  })
})
