/**
 * Tests for POST /api/auth/possession-redeem — possession-based invite
 * onboarding (docs/schools/email-deliverability-plan.md, Option A).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

process.env.SUPABASE_URL = 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'
// VITE_SUPABASE_ANON_KEY takes precedence over SUPABASE_ANON_KEY in the
// handler's env resolution and may already be set by the ambient shell/.env
// — override both explicitly so the mock's key-based branching is reliable.
process.env.VITE_SUPABASE_ANON_KEY = 'anon-key'
process.env.SUPABASE_ANON_KEY = 'anon-key'

// Tests use fake domains (school.example etc.) that have no real MX record —
// mock DNS so the (real, network-hitting) MX soft-check doesn't block them.
// Defaults to "has MX" (the common case); individual tests override to
// exercise the no-MX-record rejection path.
let mxResolution: 'has-mx' | 'no-mx' | 'timeout' = 'has-mx'
vi.mock('dns', () => ({
  promises: {
    resolveMx: vi.fn(async () => {
      if (mxResolution === 'no-mx') {
        const err: any = new Error('queryMx ENOTFOUND')
        err.code = 'ENOTFOUND'
        throw err
      }
      if (mxResolution === 'timeout') {
        throw new Error('timeout')
      }
      return [{ exchange: 'mx.example.com', priority: 10 }]
    }),
  },
}))

let inviteRow: any
let rateCounts: { ip: number; code: number }
let attempts: any[]
let createUserResult: any
let generateLinkResult: any
let verifyOtpResult: any
let deleteUserCalls: string[]

function makeAttemptsBuilder() {
  const calls: any[] = []
  const builder: any = {
    select: (...args: any[]) => {
      calls.push(['select', ...args])
      return builder
    },
    insert: (obj: any) => {
      attempts.push(obj)
      return Promise.resolve({ error: null })
    },
    eq: (col: string, val: any) => {
      calls.push(['eq', col, val])
      return builder
    },
    gte: () => {
      const isIp = calls.some((c) => c[0] === 'eq' && c[1] === 'ip_hash')
      const count = isIp ? rateCounts.ip : rateCounts.code
      return Promise.resolve({ count, data: null, error: null })
    },
  }
  return builder
}

function makeInviteValidationBuilder() {
  const builder: any = {
    select: () => builder,
    eq: () => builder,
    maybeSingle: () => Promise.resolve({ data: inviteRow, error: null }),
  }
  return builder
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: (_url: string, key: string) => {
    if (key === 'anon-key') {
      return {
        auth: {
          verifyOtp: () => Promise.resolve(verifyOtpResult),
        },
      }
    }
    return {
      from: (table: string) => {
        if (table === 'possession_mint_attempts') return makeAttemptsBuilder()
        if (table === 'invite_code_validation') return makeInviteValidationBuilder()
        return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) }
      },
      auth: {
        admin: {
          createUser: () => Promise.resolve(createUserResult),
          generateLink: () => Promise.resolve(generateLinkResult),
          deleteUser: (id: string) => {
            deleteUserCalls.push(id)
            return Promise.resolve({ error: null })
          },
        },
      },
    }
  },
}))

function makeRes() {
  const res: any = {}
  res.status = vi.fn((code: number) => {
    res._status = code
    return res
  })
  res.json = vi.fn((body: unknown) => {
    res._json = body
    return res
  })
  return res as VercelResponse & { _status?: number; _json?: any }
}

function makeReq(body: unknown): VercelRequest {
  return { method: 'POST', headers: {}, body } as any
}

describe('POST /api/auth/possession-redeem', () => {
  let handler: typeof import('./possession-redeem').default

  beforeEach(async () => {
    vi.resetModules()
    mxResolution = 'has-mx'
    attempts = []
    deleteUserCalls = []
    rateCounts = { ip: 0, code: 0 }
    inviteRow = {
      id: 'invite-1',
      code: 'TEACH-1',
      code_type: 'teacher',
      max_uses: null,
      use_count: 0,
      expires_at: null,
      is_active: true,
    }
    createUserResult = { data: { user: { id: 'auth-user-1' } }, error: null }
    generateLinkResult = { data: { properties: { hashed_token: 'hashed-token-123' } }, error: null }
    verifyOtpResult = { data: { session: { access_token: 'at-1', refresh_token: 'rt-1' } }, error: null }
    handler = (await import('./possession-redeem')).default
  })

  it('mints a session for a valid teacher invite + fresh email', async () => {
    const res = makeRes()
    await handler(makeReq({ code: 'TEACH-1', email: 'newteacher@school.example', displayName: 'Ms Jones' }), res)

    expect(res._status).toBe(200)
    expect(res._json.success).toBe(true)
    expect(res._json.session).toEqual({ access_token: 'at-1', refresh_token: 'rt-1' })
    expect(attempts.some((a) => a.outcome === 'minted' && a.auth_user_id === 'auth-user-1')).toBe(true)
  })

  it('rejects an already-registered email without minting a session (no account takeover)', async () => {
    createUserResult = { data: { user: null }, error: { code: 'email_exists', message: 'A user with this email address has already been registered' } }
    const res = makeRes()
    await handler(makeReq({ code: 'TEACH-1', email: 'existing@school.example' }), res)

    expect(res._status).toBe(409)
    expect(res._json.success).toBe(false)
    expect(res._json.reason).toBe('already_registered')
    expect(attempts.some((a) => a.outcome === 'already_registered')).toBe(true)
  })

  it('rejects a duplicate email attempt distinctly from a generic create failure', async () => {
    createUserResult = { data: { user: null }, error: { status: 422, message: 'User already registered' } }
    const res = makeRes()
    await handler(makeReq({ code: 'TEACH-1', email: 'dup@school.example' }), res)
    expect(res._status).toBe(409)
    expect(res._json.reason).toBe('already_registered')
  })

  it('rejects an expired code', async () => {
    inviteRow.expires_at = '2020-01-01T00:00:00.000Z'
    const res = makeRes()
    await handler(makeReq({ code: 'TEACH-1', email: 'a@school.example' }), res)
    expect(res._status).toBe(200)
    expect(res._json).toEqual({ success: false, error: 'Code expired' })
  })

  it('rejects an exhausted code', async () => {
    inviteRow.max_uses = 5
    inviteRow.use_count = 5
    const res = makeRes()
    await handler(makeReq({ code: 'TEACH-1', email: 'a@school.example' }), res)
    expect(res._json).toEqual({ success: false, error: 'Code fully used' })
  })

  it('rejects an invalid/unknown code', async () => {
    inviteRow = null
    const res = makeRes()
    await handler(makeReq({ code: 'NOPE-1', email: 'a@school.example' }), res)
    expect(res._json).toEqual({ success: false, error: 'Invalid code' })
  })

  it('rejects code types outside the possession-eligible set (e.g. ssi_admin)', async () => {
    inviteRow.code_type = 'ssi_admin'
    const res = makeRes()
    await handler(makeReq({ code: 'TEACH-1', email: 'a@school.example' }), res)
    expect(res._status).toBe(200)
    expect(res._json.success).toBe(false)
    expect(attempts.some((a) => a.outcome === 'unsupported_code_type')).toBe(true)
  })

  it('rate limits by IP before touching the invite code', async () => {
    rateCounts.ip = 10
    const res = makeRes()
    await handler(makeReq({ code: 'TEACH-1', email: 'a@school.example' }), res)
    expect(res._status).toBe(429)
    expect(attempts.some((a) => a.outcome === 'rate_limited_ip')).toBe(true)
  })

  it('rate limits by code', async () => {
    rateCounts.code = 20
    const res = makeRes()
    await handler(makeReq({ code: 'TEACH-1', email: 'a@school.example' }), res)
    expect(res._status).toBe(429)
    expect(attempts.some((a) => a.outcome === 'rate_limited_code')).toBe(true)
  })

  it('rejects a malformed email', async () => {
    const res = makeRes()
    await handler(makeReq({ code: 'TEACH-1', email: 'not-an-email' }), res)
    expect(res._status).toBe(400)
  })

  it('rejects a missing code', async () => {
    const res = makeRes()
    await handler(makeReq({ email: 'a@school.example' }), res)
    expect(res._status).toBe(400)
  })

  it('cleans up the created auth user if session-minting fails', async () => {
    verifyOtpResult = { data: { session: null }, error: { message: 'boom' } }
    const res = makeRes()
    await handler(makeReq({ code: 'TEACH-1', email: 'a@school.example' }), res)
    expect(res._status).toBe(500)
    expect(deleteUserCalls).toEqual(['auth-user-1'])
    expect(attempts.some((a) => a.outcome === 'mint_failed')).toBe(true)
  })

  it('rejects a disposable-domain email', async () => {
    const res = makeRes()
    await handler(makeReq({ code: 'TEACH-1', email: 'a@mailinator.com' }), res)
    expect(res._status).toBe(400)
    expect(res._json.success).toBe(false)
  })

  it('rejects an email domain with no MX record', async () => {
    mxResolution = 'no-mx'
    const res = makeRes()
    await handler(makeReq({ code: 'TEACH-1', email: 'a@school.example' }), res)
    expect(res._status).toBe(400)
    expect(attempts.some((a) => a.outcome === 'no_mx_domain')).toBe(true)
  })

  it('fails open (still mints) when the MX lookup is inconclusive', async () => {
    mxResolution = 'timeout'
    const res = makeRes()
    await handler(makeReq({ code: 'TEACH-1', email: 'a@school.example' }), res)
    expect(res._status).toBe(200)
    expect(res._json.success).toBe(true)
  })
})
