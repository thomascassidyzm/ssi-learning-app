/**
 * SECURITY AUDIT 2026-08-11 — area 1 (auth & identity core).
 *
 * POST /api/email/verify is the ONE server-side writer that is meant to prove
 * mailbox ownership before an address lands in learners.verified_emails. That
 * array is an authorization fact downstream: api/access/grant-emails.ts
 * resolves email-allowlist grants (which can carry grants_platform_role) by it,
 * api/family/invite.ts attaches family members by it, and the
 * find_learner_by_email / claim_learner bridge links auth identities by it.
 *
 * Two defects in that gate:
 *
 * AUTH-CORE-04: no app-level throttle on the OTP verification attempt. The
 *   handler forwards { email, token } straight to admin.auth.verifyOtp on every
 *   call, so the only bound on guessing a 6-digit code for an address the
 *   attacker does not control is whatever GoTrue's own per-IP limits happen to
 *   be — and those see the shared Vercel egress IP, not the caller's.
 *
 * AUTH-CORE-06: the "already linked to another account" collision guard uses
 *   .contains(...).single() and DISCARDS the error. .single() errors whenever
 *   the filter matches zero OR MORE THAN ONE row, so once two learners already
 *   carry the address the guard silently passes and a third account binds it.
 *
 * Full write-up: docs/security-audit-2026-08-11/auth-core.md
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-key'

vi.mock('../_utils/auth', () => ({
  getAuthUserId: vi.fn(async () => 'attacker-user'),
}))

let verifyOtpResult: any
let verifyOtpCalls: any[]
let learnerRow: any
/** What the .contains(...).single() collision probe resolves to. */
let collisionProbe: { data: any; error: any }
let learnersUpdateCalls: any[]

function makeLearnersBuilder() {
  const calls: any[] = []
  const builder: any = {
    select: (...args: any[]) => { calls.push(['select', ...args]); return builder },
    update: (obj: any) => { calls.push(['update', obj]); learnersUpdateCalls.push(obj); return builder },
    contains: (...args: any[]) => { calls.push(['contains', ...args]); return builder },
    eq: (...args: any[]) => { calls.push(['eq', ...args]); return builder },
    single: () => {
      if (calls.some((c) => c[0] === 'contains')) return Promise.resolve(collisionProbe)
      return Promise.resolve({ data: learnerRow, error: null })
    },
  }
  return builder
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => makeLearnersBuilder(),
    auth: {
      verifyOtp: (arg: any) => { verifyOtpCalls.push(arg); return Promise.resolve(verifyOtpResult) },
      admin: {
        getUserById: () => Promise.resolve({ data: { user: { id: 'attacker-user', email: 'attacker@example.com', user_metadata: {} } } }),
        updateUserById: () => Promise.resolve({ data: {}, error: null }),
      },
    },
  }),
}))

function makeRes() {
  const res: any = {}
  res.status = vi.fn((code: number) => { res._status = code; return res })
  res.json = vi.fn((body: unknown) => { res._json = body; return res })
  return res as VercelResponse & { _status?: number; _json?: any }
}

function makeReq(body: unknown): VercelRequest {
  return { method: 'POST', headers: { authorization: 'Bearer tok' }, body } as any
}

let handler: typeof import('./verify').default

beforeEach(async () => {
  vi.resetModules()
  verifyOtpCalls = []
  learnersUpdateCalls = []
  verifyOtpResult = { error: null }
  learnerRow = { id: 'learner-attacker', verified_emails: [] }
  collisionProbe = { data: null, error: null }
  handler = (await import('./verify')).default
})

describe('AUTH-CORE-04 — /api/email/verify OTP brute-force bound', () => {
  // SECURITY FINDING AUTH-CORE-04: the handler should keep a per-account /
  // per-target-email attempt budget (the possession_mint_attempts pattern) and
  // 429 once it is spent, rather than relaying every guess to GoTrue.
  it('CHARACTERIZATION: 50 wrong OTPs for someone else\'s address, every one relayed, none throttled', async () => {
    verifyOtpResult = { error: { message: 'Token has expired or is invalid' } }

    const statuses: (number | undefined)[] = []
    for (let i = 0; i < 50; i++) {
      const res = makeRes()
      await handler(makeReq({ email: 'victim@school.example', token: String(100000 + i) }), res)
      statuses.push(res._status)
    }

    expect(statuses.every((s) => s === 400)).toBe(true)
    expect(statuses).not.toContain(429)
    // Every single guess reached GoTrue — nothing was short-circuited locally.
    expect(verifyOtpCalls).toHaveLength(50)
    expect(verifyOtpCalls.every((c) => c.email === 'victim@school.example' && c.type === 'email')).toBe(true)
  })

  // Control that HOLDS: a wrong OTP never writes anything. The brute-force
  // exposure is the attempt COUNT, not a leaky failure path.
  it('CONTROL: a failed OTP writes nothing to verified_emails', async () => {
    verifyOtpResult = { error: { message: 'Token has expired or is invalid' } }
    const res = makeRes()
    await handler(makeReq({ email: 'victim@school.example', token: '000000' }), res)
    expect(res._status).toBe(400)
    expect(learnersUpdateCalls).toHaveLength(0)
  })

  it.todo('AUTH-CORE-04: /api/email/verify answers 429 once the per-account OTP guess budget is spent')
})

describe('AUTH-CORE-06 — /api/email/verify cross-account collision guard', () => {
  // Control that HOLDS: the guard fires on the single-row case it was written
  // for. This is the regression lock on the behaviour that IS correct.
  it('CONTROL: 409s when exactly one OTHER learner already holds the address', async () => {
    collisionProbe = { data: { id: 'learner-victim', user_id: 'victim-user' }, error: null }
    const res = makeRes()
    await handler(makeReq({ email: 'shared@example.com', token: '123456' }), res)
    expect(res._status).toBe(409)
    expect(learnersUpdateCalls).toHaveLength(0)
  })

  // SECURITY FINDING AUTH-CORE-06: .single() errors on MULTIPLE matching rows
  // (PGRST116), the error is discarded, and the guard falls through — so the
  // address binds to a third account. It should use .limit(1).maybeSingle() (or
  // check the error explicitly) and fail CLOSED on an unreadable probe.
  it('CHARACTERIZATION: the guard silently passes when 2+ learners already hold the address', async () => {
    // PostgREST's .single() against a multi-row result: no data, an error.
    collisionProbe = {
      data: null,
      error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' },
    }
    const res = makeRes()
    await handler(makeReq({ email: 'shared@example.com', token: '123456' }), res)

    expect(res._status).toBe(200)
    expect(res._json).toMatchObject({ success: true, email: 'shared@example.com' })
    // …and the contested address is written onto the caller's own learner row.
    expect(learnersUpdateCalls).toContainEqual({ verified_emails: ['shared@example.com'] })
  })

  it.todo('AUTH-CORE-06: the collision guard fails CLOSED when the probe errors or matches multiple learners')
})
