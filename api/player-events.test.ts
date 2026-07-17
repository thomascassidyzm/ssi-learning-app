import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-key'

let insertedRows: any[]
let insertError: any
// Controls the auth-uid → learners.id mapping used by resolveIdentity.
let learnerMapRow: { id: string } | null
let learnerMapError: any
// Controls what the mocked verifyAuthToken returns.
let authResult: { valid: boolean; userId?: string; error?: string }

vi.mock('./_utils/auth', () => ({
  verifyAuthToken: vi.fn(async () => authResult),
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => {
      if (table === 'learners') {
        const builder: any = {
          select: () => builder,
          eq: () => builder,
          maybeSingle: async () => ({ data: learnerMapRow, error: learnerMapError }),
        }
        return builder
      }
      return {
        insert: vi.fn(async (rows: any) => {
          insertedRows.push(...(Array.isArray(rows) ? rows : [rows]))
          return { error: insertError }
        }),
      }
    },
  }),
}))

let handler: typeof import('./player-events').default

function makeReq(cookieUserId: string | undefined, body?: any, authHeader?: string): VercelRequest {
  const headers: Record<string, string> = {
    host: 'staging.saysomethingin.app',
    'user-agent': 'test-agent',
  }
  if (authHeader) headers.authorization = authHeader
  return {
    method: 'POST',
    headers,
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
  learnerMapRow = null
  learnerMapError = null
  authResult = { valid: false, error: 'no token' }
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

  it('500s with a generic message (no raw DB text) when the insert genuinely fails', async () => {
    insertError = { message: 'boom: relation "player_events" violates constraint', code: 'XX000' }
    const res = makeRes()
    await handler(
      makeReq('11111111-1111-4111-8111-111111111111', { events: [{ event_type: 'course_load' }] }),
      res,
    )
    expect(res.statusCode).toBe(500)
    // The raw PostgREST/Postgres text must never reach the unauthenticated caller.
    expect(res.body).toEqual({ error: 'insert failed' })
    expect(JSON.stringify(res.body)).not.toContain('boom')
  })

  it('a valid bearer token overrides a conflicting ssi-user-id cookie with the verified learner id', async () => {
    authResult = { valid: true, userId: 'auth-uid-xyz' }
    learnerMapRow = { id: '22222222-2222-4222-8222-222222222222' } // learners.id for that auth uid
    const res = makeRes()
    await handler(
      // Cookie claims a DIFFERENT learner id — must be ignored in favour of the JWT.
      makeReq('11111111-1111-4111-8111-111111111111', { events: [{ event_type: 'course_load' }] }, 'Bearer good-token'),
      res,
    )
    expect(res.statusCode).toBe(200)
    expect(insertedRows[0].user_id).toBe('22222222-2222-4222-8222-222222222222')
    expect(insertedRows[0].learner_id).toBe('22222222-2222-4222-8222-222222222222')
  })

  it('falls back to the cookie identity when a bearer is present but invalid', async () => {
    authResult = { valid: false, error: 'expired' }
    const res = makeRes()
    await handler(
      makeReq('11111111-1111-4111-8111-111111111111', { events: [{ event_type: 'course_load' }] }, 'Bearer stale-token'),
      res,
    )
    expect(res.statusCode).toBe(200)
    // Stale token forfeits the trusted upgrade but does not drop the event.
    expect(insertedRows[0].user_id).toBe('11111111-1111-4111-8111-111111111111')
  })

  it('falls back to null when a bearer verifies but no learner row maps to the auth uid', async () => {
    authResult = { valid: true, userId: 'auth-uid-no-learner' }
    learnerMapRow = null
    const res = makeRes()
    await handler(
      makeReq(undefined, { events: [{ event_type: 'course_load' }] }, 'Bearer good-token'),
      res,
    )
    expect(res.statusCode).toBe(200)
    expect(insertedRows[0].user_id).toBeNull()
    expect(insertedRows[0].learner_id).toBeNull()
  })

  it('sanitizes bad fields per-event without rejecting the whole batch', async () => {
    const res = makeRes()
    await handler(
      makeReq('11111111-1111-4111-8111-111111111111', {
        events: [
          { event_type: 'bad_fields', occurred_at: 'not-a-timestamp', session_id: 'not-a-uuid' },
          {
            event_type: 'good_fields',
            occurred_at: '2026-07-17T10:00:00.000Z',
            session_id: '33333333-3333-4333-8333-333333333333',
          },
        ],
      }),
      res,
    )
    expect(res.statusCode).toBe(200)
    // Both events persist — the malformed one is not dropped, only its bad fields.
    expect(insertedRows).toHaveLength(2)
    // Bad occurred_at defaulted to a valid ISO timestamp; bad session_id nulled.
    expect(Number.isNaN(Date.parse(insertedRows[0].occurred_at))).toBe(false)
    expect(insertedRows[0].session_id).toBeNull()
    // Valid fields preserved verbatim.
    expect(insertedRows[1].occurred_at).toBe('2026-07-17T10:00:00.000Z')
    expect(insertedRows[1].session_id).toBe('33333333-3333-4333-8333-333333333333')
  })

  it('collapses an oversized payload to a marker instead of persisting the blob', async () => {
    const res = makeRes()
    const huge = 'x'.repeat(20 * 1024)
    await handler(
      makeReq('11111111-1111-4111-8111-111111111111', {
        events: [{ event_type: 'big', payload: { blob: huge } }],
      }),
      res,
    )
    expect(res.statusCode).toBe(200)
    expect(insertedRows[0].payload).toMatchObject({ _truncated: true })
    expect(insertedRows[0].payload.blob).toBeUndefined()
  })
})
