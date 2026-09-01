/**
 * SEC0901-C — api/player-events.ts, the play-as-class attribution exception.
 *
 * SEC25 INPUT-04 (fixed 2026-08-25) already closed the general hole: an
 * unsigned `ssi-user-id` cookie is no longer trusted as identity (see
 * api/player-events.test.ts for that coverage). What that fix ADDED is a
 * narrow exception — `isAuthorisedClassLearner()` — that lets the cookie
 * stand in for a verified bearer's identity when, and only when, the cookie
 * names a class-learner entity the caller's own `resolveVisibleScope` covers.
 * That exception is new code, on the changed lines for this area, and had no
 * dedicated test: this file is that regression lock.
 *
 * THE ATTACK THIS CLOSES: a teacher (or anyone with a valid bearer token) sets
 * the `ssi-user-id` cookie to an arbitrary UUID and expects it to override
 * their own verified identity. If `isAuthorisedClassLearner` did not exist, or
 * mis-scoped, staff could attribute telemetry to ANY class or ANY other
 * learner merely by holding *some* staff scope, not necessarily one that
 * covers the class named in the cookie — a cross-tenant attribution hole.
 *
 * Nothing here touches a network or a live DB — the supabase client and
 * resolveVisibleScope are both mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-key'

const CALLER_LEARNER_ID = '22222222-2222-4222-8222-222222222222'
const IN_SCOPE_CLASS_LEARNER_ID = '33333333-3333-4333-8333-333333333333'
const OUT_OF_SCOPE_CLASS_LEARNER_ID = '44444444-4444-4444-8444-444444444444'
const IN_SCOPE_CLASS_ID = 'class-in-scope'
const OUT_OF_SCOPE_CLASS_ID = 'class-not-in-scope'

let authResult: { valid: boolean; userId?: string; error?: string }
let scope: { role: string; classIds: string[]; schoolIds: string[]; groupId: string | null }

vi.mock('./_utils/auth', () => ({
  verifyAuthToken: vi.fn(async () => authResult),
}))

vi.mock('./_utils/schoolScope', () => ({
  resolveVisibleScope: vi.fn(async () => scope),
}))

let insertedRows: any[]

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => {
      if (table === 'learners') {
        const builder: any = {
          select: () => builder,
          eq: () => builder,
          maybeSingle: async () => ({ data: { id: CALLER_LEARNER_ID }, error: null }),
        }
        return builder
      }
      if (table === 'classes') {
        // The only class-learner entity that exists is IN_SCOPE_CLASS_LEARNER_ID,
        // bound to IN_SCOPE_CLASS_ID. The out-of-scope cookie value below
        // resolves to a REAL class (OUT_OF_SCOPE_CLASS_ID) that the caller's
        // scope does not cover — the case that must still be refused.
        const builder: any = {
          select: () => builder,
          eq: (_col: string, val: string) => {
            builder._lastClassLearnerId = val
            return builder
          },
          maybeSingle: async () => {
            if (builder._lastClassLearnerId === IN_SCOPE_CLASS_LEARNER_ID) {
              return { data: { id: IN_SCOPE_CLASS_ID }, error: null }
            }
            if (builder._lastClassLearnerId === OUT_OF_SCOPE_CLASS_LEARNER_ID) {
              return { data: { id: OUT_OF_SCOPE_CLASS_ID }, error: null }
            }
            return { data: null, error: null }
          },
        }
        return builder
      }
      return {
        insert: vi.fn(async (rows: any) => {
          insertedRows.push(...(Array.isArray(rows) ? rows : [rows]))
          return { error: null }
        }),
      }
    },
  }),
}))

let handler: typeof import('./player-events').default

function makeReq(cookieUserId: string | undefined, body: any, authHeader?: string): VercelRequest {
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
  authResult = { valid: true, userId: 'auth-uid-teacher' }
  scope = { role: 'teacher', classIds: [IN_SCOPE_CLASS_ID], schoolIds: [], groupId: null }
  handler = (await import('./player-events')).default
})

describe('POST /api/player-events — play-as-class attribution exception', () => {
  it('SECURE: honours the cookie when it names a class-learner within the caller\'s own visible scope', async () => {
    const res = makeRes()
    await handler(
      makeReq(IN_SCOPE_CLASS_LEARNER_ID, { events: [{ event_type: 'course_load' }] }, 'Bearer good-token'),
      res,
    )
    expect(res.statusCode).toBe(200)
    expect(insertedRows[0].user_id).toBe(IN_SCOPE_CLASS_LEARNER_ID)
    expect(insertedRows[0].learner_id).toBe(IN_SCOPE_CLASS_LEARNER_ID)
  })

  it('SECURE: refuses the cookie when it names a REAL class-learner OUTSIDE the caller\'s visible scope, falling back to the verified identity', async () => {
    const res = makeRes()
    await handler(
      makeReq(OUT_OF_SCOPE_CLASS_LEARNER_ID, { events: [{ event_type: 'course_load' }] }, 'Bearer good-token'),
      res,
    )
    expect(res.statusCode).toBe(200)
    // Must NOT attribute to the class the caller cannot see.
    expect(insertedRows[0].user_id).not.toBe(OUT_OF_SCOPE_CLASS_LEARNER_ID)
    expect(insertedRows[0].learner_id).not.toBe(OUT_OF_SCOPE_CLASS_LEARNER_ID)
    // Falls back to the caller's own verified learner id.
    expect(insertedRows[0].user_id).toBe(CALLER_LEARNER_ID)
  })

  it('SECURE: refuses the cookie when the caller has NO staff scope at all (plain learner trying to claim a class)', async () => {
    scope = { role: 'learner', classIds: [], schoolIds: [], groupId: null }
    const res = makeRes()
    await handler(
      makeReq(IN_SCOPE_CLASS_LEARNER_ID, { events: [{ event_type: 'course_load' }] }, 'Bearer good-token'),
      res,
    )
    expect(res.statusCode).toBe(200)
    expect(insertedRows[0].user_id).toBe(CALLER_LEARNER_ID)
  })

  it('SECURE: a cookie naming a class-learner id that does not exist at all never attributes to it', async () => {
    const res = makeRes()
    await handler(
      makeReq('99999999-9999-4999-8999-999999999999', { events: [{ event_type: 'course_load' }] }, 'Bearer good-token'),
      res,
    )
    expect(res.statusCode).toBe(200)
    expect(insertedRows[0].user_id).toBe(CALLER_LEARNER_ID)
  })
})

describe('POST /api/player-events — event_type has no server-side allowlist', () => {
  // CHARACTERIZATION, not a fix: event_type is only type/length-checked
  // (a non-empty string, capped at 64 chars), never checked against a known
  // set of event kinds. A caller can write a `cycle_prosody` row — the exact
  // type api/_utils/vadProsody.ts folds into the VAD/prosody teacher and admin
  // boards — with fabricated payload fields, attributed to their OWN row only
  // (attribution is verified elsewhere in this file), which can only skew
  // that learner's own aggregates, not another tenant's. Flagged as
  // SEC0901-C-06 (info/low: self-serving data poisoning, not cross-tenant).
  // This goes red on purpose if an allowlist is later added — red here means
  // the finding is CLOSED.
  it('accepts an arbitrary event_type, including one a privileged dashboard aggregates on', async () => {
    authResult = { valid: false, error: 'no token' }
    const res = makeRes()
    await handler(
      makeReq(undefined, {
        events: [{
          event_type: 'cycle_prosody',
          payload: { peakEnergyDb: 999, averageEnergyDb: 999, peakCount: 999 },
        }],
      }),
      res,
    )
    expect(res.statusCode).toBe(200)
    expect(insertedRows[0].event_type).toBe('cycle_prosody')
    expect(insertedRows[0].payload).toMatchObject({ peakEnergyDb: 999 })
  })
})
