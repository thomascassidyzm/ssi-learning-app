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
  // SEC25 INPUT-04 (FIXED 2026-08-25): a uuid-shaped `ssi-user-id` cookie is
  // no longer an identity — it is unsigned, so trusting it let anyone write
  // telemetry against any learner. The event is still accepted (guest
  // telemetry is a real product path), just unattributed.
  it('accepts a uuid cookie with NO bearer but stores it unattributed', async () => {
    const res = makeRes()
    await handler(
      makeReq('11111111-1111-4111-8111-111111111111', { events: [{ event_type: 'course_load' }] }),
      res,
    )
    expect(res.statusCode).toBe(200)
    expect(insertedRows).toHaveLength(1)
    expect(insertedRows[0].user_id).toBeNull()
    expect(insertedRows[0].learner_id).toBeNull()
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

  it('falls back to NULL attribution when a bearer is present but invalid', async () => {
    authResult = { valid: false, error: 'expired' }
    const res = makeRes()
    await handler(
      makeReq('11111111-1111-4111-8111-111111111111', { events: [{ event_type: 'course_load' }] }, 'Bearer stale-token'),
      res,
    )
    expect(res.statusCode).toBe(200)
    // Stale token forfeits attribution but does not drop the event, and the
    // cookie does not get to stand in for the identity it failed to prove.
    expect(insertedRows[0].user_id).toBeNull()
    expect(insertedRows[0].learner_id).toBeNull()
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

  // ── app_shell: web vs the native shell ─────────────────────────────────
  // device_type is FORM FACTOR and reads 'mobile' for a phone whether it is in
  // the browser or in the wrapped app — which is why Tom's first Android
  // session (2026-09-04) was indistinguishable from mobile web. app_shell is
  // the second, orthogonal axis, and it must never collapse back into the first.
  it('defaults to the web when the client says nothing and the UA is a browser', async () => {
    const res = makeRes()
    await handler(
      makeReq('11111111-1111-4111-8111-111111111111', { events: [{ event_type: 'tap_play' }] }),
      res,
    )
    expect(res.statusCode).toBe(200)
    expect(insertedRows[0].app_shell).toBe('web')
  })

  it('records the native shell when the client declares it', async () => {
    const res = makeRes()
    await handler(
      makeReq('11111111-1111-4111-8111-111111111111', {
        events: [{ event_type: 'tap_play' }],
        app_shell: 'webview',
      }),
      res,
    )
    expect(insertedRows[0].app_shell).toBe('webview')
    // …and leaves device_type alone. Both axes, not one merged bucket.
    expect(insertedRows[0].device_type).toBe('desktop')
  })

  it("falls back to Android's own WebView marker for a client that declares nothing", async () => {
    const res = makeRes()
    const req = makeReq('11111111-1111-4111-8111-111111111111', { events: [{ event_type: 'tap_play' }] })
    ;(req.headers as any)['user-agent'] =
      'Mozilla/5.0 (Linux; Android 16; sdk_gphone64_arm64 Build/BE2A; wv) AppleWebKit/537.36 Chrome/133.0 Mobile Safari/537.36'
    await handler(req, res)
    expect(insertedRows[0].app_shell).toBe('webview')
    expect(insertedRows[0].device_type).toBe('mobile')
  })

  it('ignores a nonsense declared shell rather than persisting free text', async () => {
    const res = makeRes()
    await handler(
      makeReq('11111111-1111-4111-8111-111111111111', {
        events: [{ event_type: 'tap_play' }],
        app_shell: 'DROP TABLE',
      }),
      res,
    )
    expect(insertedRows[0].app_shell).toBe('web')
  })

  it('keeps the rest of the telemetry when the app_shell column is not there yet', async () => {
    // The column is applied by hand. Until it lands, PostgREST rejects the whole
    // batch for an unknown column — one new field must not take out every
    // existing one, so the insert retries once without it.
    const res = makeRes()
    let call = 0
    insertError = null
    // The mocked client reports insertError AFTER capturing the rows, so flip it
    // on the first capture and off on the second: attempt one fails with the
    // undefined-column code, the retry succeeds.
    const origPush = insertedRows.push.bind(insertedRows)
    insertedRows.push = ((...rows: any[]) => {
      call += 1
      insertError = call === 1
        ? { code: 'PGRST204', message: "Could not find the 'app_shell' column" }
        : null
      return origPush(...rows)
    }) as any
    await handler(
      makeReq('11111111-1111-4111-8111-111111111111', {
        events: [{ event_type: 'tap_play' }],
        app_shell: 'webview',
      }),
      res,
    )
    insertedRows.push = origPush as any
    expect(res.statusCode).toBe(200)
    // Two attempts: the first carried app_shell, the retry dropped it.
    expect(insertedRows).toHaveLength(2)
    expect(insertedRows[0].app_shell).toBe('webview')
    expect('app_shell' in insertedRows[1]).toBe(false)
    expect(insertedRows[1].event_type).toBe('tap_play')
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
