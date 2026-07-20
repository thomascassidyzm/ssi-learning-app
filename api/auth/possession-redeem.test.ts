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
let rateCounts: { ip: number; code: number; ipNonPersonal?: number }
let attempts: any[]
let createUserResult: any
let createUserArg: any
let generateLinkResult: any
let generateLinkArg: any
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
    neq: (col: string, val: any) => {
      calls.push(['neq', col, val])
      return builder
    },
    gte: () => {
      const isIp = calls.some((c) => c[0] === 'eq' && c[1] === 'ip_hash')
      // The per-IP query excludes successful personal sign-ins
      // (neq outcome personal_signin) — mirror that with a separate fixture
      // so the exclusion is actually testable.
      const excludesPersonal = calls.some((c) => c[0] === 'neq' && c[1] === 'outcome' && c[2] === 'personal_signin')
      const count = isIp
        ? (excludesPersonal && rateCounts.ipNonPersonal !== undefined ? rateCounts.ipNonPersonal : rateCounts.ip)
        : rateCounts.code
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

let getUserByIdResult: any = { data: { user: null }, error: null }
let getUserByIdArg: string | undefined

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
          createUser: (arg: any) => { createUserArg = arg; return Promise.resolve(createUserResult) },
          generateLink: (arg: any) => { generateLinkArg = arg; return Promise.resolve(generateLinkResult) },
          getUserById: (id: string) => { getUserByIdArg = id; return Promise.resolve(getUserByIdResult) },
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
    createUserArg = undefined
    generateLinkArg = undefined
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

  // --- Link-auth (placeholder-email) mode: PUPILS ONLY (founder ruling
  // 2026-07-20). A student/learner link mints from the code + a captured
  // name; young learners have no email to give. Named roles must never
  // reach this path — their accounts are real (typed email), never ghosts. ---
  describe('linkAuth (pupil) mode', () => {
    beforeEach(() => {
      inviteRow.code = 'CLASS-1'
      inviteRow.code_type = 'student'
    })

    it('mints a session from the code alone — no email in the body', async () => {
      const res = makeRes()
      await handler(makeReq({ code: 'CLASS-1', linkAuth: true, displayName: 'Alys' }), res)

      expect(res._status).toBe(200)
      expect(res._json.success).toBe(true)
      expect(res._json.session).toEqual({ access_token: 'at-1', refresh_token: 'rt-1' })
    })

    it('mints the account against a unique placeholder address flagged link_auth, carrying the captured name', async () => {
      const res = makeRes()
      await handler(makeReq({ code: 'CLASS-1', linkAuth: true, displayName: 'Alys' }), res)

      expect(createUserArg.email).toMatch(/^link-[0-9a-f-]+@invite\.saysomethingin\.app$/)
      // Same address flows into the magic-link mint, so the session is for it.
      expect(generateLinkArg.email).toBe(createUserArg.email)
      // onboarded_via stays 'possession' so the needs-real-email prompt fires;
      // link_auth is the analytics-only distinguisher.
      expect(createUserArg.user_metadata.onboarded_via).toBe('possession')
      expect(createUserArg.user_metadata.link_auth).toBe(true)
      expect(createUserArg.user_metadata.display_name).toBe('Alys')
    })

    it('does not require a valid email and skips the MX gate', async () => {
      mxResolution = 'no-mx' // would 400 a typed email; irrelevant to link-auth
      const res = makeRes()
      await handler(makeReq({ code: 'CLASS-1', linkAuth: true }), res)
      expect(res._status).toBe(200)
      expect(res._json.success).toBe(true)
      expect(attempts.some((a) => a.outcome === 'no_mx_domain')).toBe(false)
    })

    it('still enforces code validity (expired code is rejected before minting)', async () => {
      inviteRow.expires_at = '2020-01-01T00:00:00.000Z'
      const res = makeRes()
      await handler(makeReq({ code: 'CLASS-1', linkAuth: true }), res)
      expect(res._json).toEqual({ success: false, error: 'Code expired' })
      expect(createUserArg).toBeUndefined()
    })

    it('still rejects code types outside the possession-eligible set', async () => {
      inviteRow.code_type = 'ssi_admin'
      const res = makeRes()
      await handler(makeReq({ code: 'CLASS-1', linkAuth: true }), res)
      expect(res._json.success).toBe(false)
      expect(attempts.some((a) => a.outcome === 'unsupported_code_type')).toBe(true)
      expect(createUserArg).toBeUndefined()
    })

    it('still rate limits by code', async () => {
      rateCounts.code = 20
      const res = makeRes()
      await handler(makeReq({ code: 'CLASS-1', linkAuth: true }), res)
      expect(res._status).toBe(429)
    })

    // THE PIN (founder ruling 2026-07-20): a named-role link can never mint a
    // link-<uuid> ghost. The client shows the capture screen; if anything
    // still sends linkAuth for a named role, the server refuses and asks for
    // identity.
    it.each(['teacher', 'school_admin', 'school_admin_join', 'govt_admin'])(
      'refuses linkAuth for the named role %s — identity_required, no account created',
      async (codeType) => {
        inviteRow.code_type = codeType
        const res = makeRes()
        await handler(makeReq({ code: 'CLASS-1', linkAuth: true }), res)
        expect(res._json.success).toBe(false)
        expect(res._json.reason).toBe('identity_required')
        expect(createUserArg).toBeUndefined()
        expect(attempts.some((a) => a.outcome === 'identity_required')).toBe(true)
      }
    )
  })

  // --- Personal links (species 1, founder-ruled 2026-07-20): the code is
  // bound at mint time to a PRE-PROVISIONED account; possession IS that
  // account's login. Zero screens, no new account ever created here. ---
  describe('personal (species 1) mode', () => {
    beforeEach(() => {
      inviteRow.code = 'PERS-1'
      inviteRow.code_type = 'govt_admin'
      inviteRow.metadata = { personal_auth_user_id: 'persona-77', personal_name: 'IME Programme Leader' }
      getUserByIdResult = { data: { user: { id: 'persona-77', email: 'persona-77@invite.saysomethingin.app' } }, error: null }
      getUserByIdArg = undefined
    })

    it('mints a session for the BOUND account — no createUser, even for a named role via linkAuth', async () => {
      const res = makeRes()
      await handler(makeReq({ code: 'PERS-1', linkAuth: true }), res)

      expect(res._status).toBe(200)
      expect(res._json.success).toBe(true)
      expect(res._json.personal).toBe(true)
      expect(res._json.session).toEqual({ access_token: 'at-1', refresh_token: 'rt-1' })
      // The session is for the stored user's own email — bound server-side.
      expect(getUserByIdArg).toBe('persona-77')
      expect(generateLinkArg.email).toBe('persona-77@invite.saysomethingin.app')
      // THE PIN: personal sign-in never creates an account.
      expect(createUserArg).toBeUndefined()
      expect(attempts.some((a) => a.outcome === 'personal_signin' && a.auth_user_id === 'persona-77')).toBe(true)
    })

    it('is repeatable — a second click mints again (no exhaustion below max_uses)', async () => {
      await handler(makeReq({ code: 'PERS-1', linkAuth: true }), makeRes())
      const res = makeRes()
      await handler(makeReq({ code: 'PERS-1', linkAuth: true }), res)
      expect(res._json.success).toBe(true)
    })

    it('a revoked-at-auth-layer persona (account deleted) fails friendly, not 500', async () => {
      getUserByIdResult = { data: { user: null }, error: null }
      const res = makeRes()
      await handler(makeReq({ code: 'PERS-1', linkAuth: true }), res)
      expect(res._status).toBe(200)
      expect(res._json.success).toBe(false)
      expect(attempts.some((a) => a.outcome === 'personal_account_missing')).toBe(true)
    })

    it('still enforces expiry before any sign-in', async () => {
      inviteRow.expires_at = '2020-01-01T00:00:00.000Z'
      const res = makeRes()
      await handler(makeReq({ code: 'PERS-1', linkAuth: true }), res)
      expect(res._json).toEqual({ success: false, error: 'Code expired' })
      expect(getUserByIdArg).toBeUndefined()
    })

    it('still rate limits by code', async () => {
      rateCounts.code = 20
      const res = makeRes()
      await handler(makeReq({ code: 'PERS-1', linkAuth: true }), res)
      expect(res._status).toBe(429)
    })

    // Live repro 2026-07-20: successful personal logins burned the per-IP
    // guessing budget (a demo walk rate-limited itself). Successful
    // personal_signin outcomes are excluded from the per-IP count; failed
    // attempts still count, and the per-code limit still counts everything.
    it('is NOT starved by its own prior successful sign-ins on the same IP', async () => {
      rateCounts.ip = 25 // raw attempts, mostly personal_signin successes
      rateCounts.ipNonPersonal = 2 // what the filtered per-IP query sees
      const res = makeRes()
      await handler(makeReq({ code: 'PERS-1', linkAuth: true }), res)
      expect(res._status).toBe(200)
      expect(res._json.success).toBe(true)
    })
  })
})
