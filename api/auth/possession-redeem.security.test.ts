/**
 * SECURITY AUDIT 2026-08-11 — area 1 (auth & identity core).
 *
 * POST /api/auth/possession-redeem is the one endpoint in this area that mints
 * a real Supabase session with NO bearer token — possession of an invite code
 * is the whole credential. Its rails are therefore load-bearing.
 *
 * AUTH-CORE-05 (finding): the per-IP guess budget is keyed on the FIRST element
 *   of a client-supplied `X-Forwarded-For` header (possession-redeem.ts:95-101,
 *   the same helper in api/code/validate.ts:92-98 and
 *   api/try-link/validate.ts:102-104). On any proxy that APPENDS the real hop
 *   rather than replacing the header, that first element is fully
 *   attacker-chosen, so rotating it gives an unlimited per-IP budget and the
 *   throttle collapses to the per-code limit alone.
 *
 * AUTH-CORE-11 (control that HOLDS): the personal-link branch signs the caller
 *   straight into a PRE-BOUND account. That binding comes only from the invite
 *   row's server-written metadata; nothing in the request body reaches it.
 *
 * Full write-up: docs/security-audit-2026-08-11/auth-core.md
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createHash } from 'crypto'

process.env.SUPABASE_URL = 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'
process.env.VITE_SUPABASE_ANON_KEY = 'anon-key'
process.env.SUPABASE_ANON_KEY = 'anon-key'

vi.mock('dns', () => ({
  promises: { resolveMx: vi.fn(async () => [{ exchange: 'mx.example.com', priority: 10 }]) },
}))

let inviteRow: any
/** Rows the mocked possession_mint_attempts table already holds, by ip_hash. */
let attempts: any[]
let createUserResult: any
let generateLinkResult: any
let verifyOtpResult: any
let getUserByIdResult: any
let getUserByIdArg: string | undefined

/** Counts live off `attempts`, so the mock behaves like the real ledger. */
function makeAttemptsBuilder() {
  const calls: any[][] = []
  const builder: any = {
    select: (...a: any[]) => { calls.push(['select', ...a]); return builder },
    insert: (obj: any) => { attempts.push(obj); return Promise.resolve({ error: null }) },
    eq: (col: string, val: any) => { calls.push(['eq', col, val]); return builder },
    neq: (col: string, val: any) => { calls.push(['neq', col, val]); return builder },
    gte: () => {
      const ipFilter = calls.find((c) => c[0] === 'eq' && c[1] === 'ip_hash')
      const excluded = new Set(calls.filter((c) => c[0] === 'neq' && c[1] === 'outcome').map((c) => c[2]))
      const rows = attempts.filter((a) => !excluded.has(a.outcome))
      const count = ipFilter ? rows.filter((a) => a.ip_hash === ipFilter[2]).length : rows.length
      return Promise.resolve({ count, data: null, error: null })
    },
  }
  return builder
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: (_url: string, key: string) => {
    if (key === 'anon-key') {
      return { auth: { verifyOtp: () => Promise.resolve(verifyOtpResult) } }
    }
    return {
      from: (table: string) => {
        if (table === 'possession_mint_attempts') return makeAttemptsBuilder()
        if (table === 'invite_code_validation') {
          const b: any = { select: () => b, eq: () => b, maybeSingle: () => Promise.resolve({ data: inviteRow, error: null }) }
          return b
        }
        return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) }
      },
      auth: {
        admin: {
          createUser: () => Promise.resolve(createUserResult),
          generateLink: () => Promise.resolve(generateLinkResult),
          getUserById: (id: string) => { getUserByIdArg = id; return Promise.resolve(getUserByIdResult) },
          deleteUser: () => Promise.resolve({ error: null }),
        },
      },
    }
  },
}))

function makeRes() {
  const res: any = {}
  res.status = vi.fn((code: number) => { res._status = code; return res })
  res.json = vi.fn((body: unknown) => { res._json = body; return res })
  return res as VercelResponse & { _status?: number; _json?: any }
}

function makeReq(body: unknown, headers: Record<string, string> = {}): VercelRequest {
  return { method: 'POST', headers, body } as any
}

const hashIp = (ip: string) => createHash('sha256').update(ip).digest('hex').slice(0, 16)

let handler: typeof import('./possession-redeem').default

beforeEach(async () => {
  vi.resetModules()
  attempts = []
  getUserByIdArg = undefined
  getUserByIdResult = { data: { user: { id: 'persona-77', email: 'leader@ime.example' } }, error: null }
  inviteRow = {
    id: 'invite-1',
    code: 'TEACH-1',
    code_type: 'teacher',
    metadata: null,
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

describe('AUTH-CORE-05 — per-IP guess budget is keyed on a client-supplied header', () => {
  // Control that HOLDS: with a STABLE client IP the limiter genuinely bites —
  // the 11th substantive attempt in the window is refused. This is the
  // behaviour the finding says an attacker sidesteps, not one that is absent.
  it('CONTROL: 10 wrong guesses from one IP, the 11th is 429', async () => {
    inviteRow = null // every guess misses
    const ip = { 'x-forwarded-for': '203.0.113.9' }

    for (let i = 0; i < 10; i++) {
      const res = makeRes()
      await handler(makeReq({ code: `AAA-${i}`, email: `a${i}@school.example` }, ip), res)
      expect(res._status).toBe(200)
    }

    const res = makeRes()
    await handler(makeReq({ code: 'AAA-X', email: 'x@school.example' }, ip), res)
    expect(res._status).toBe(429)
    expect(attempts.some((a) => a.outcome === 'rate_limited_ip')).toBe(true)
  })

  // SECURITY FINDING AUTH-CORE-05: the bucket key is whatever the caller wrote
  // in X-Forwarded-For, so rotating it resets the budget every request. The
  // client IP should come from a hop the platform controls
  // (x-vercel-forwarded-for, or the LAST element of x-forwarded-for).
  it('CHARACTERIZATION: rotating X-Forwarded-For gives an unlimited per-IP budget', async () => {
    inviteRow = null

    const statuses: (number | undefined)[] = []
    for (let i = 0; i < 40; i++) {
      const res = makeRes()
      await handler(
        makeReq({ code: `AAA-${i}`, email: `a${i}@school.example` }, { 'x-forwarded-for': `192.0.2.${i}` }),
        res,
      )
      statuses.push(res._status)
    }

    expect(statuses).not.toContain(429)
    expect(attempts.filter((a) => a.outcome === 'invalid_code')).toHaveLength(40)
  })

  // SECURITY FINDING AUTH-CORE-05: the stored ip_hash is the sha256 of a value
  // the caller chose — so the audit trail is attacker-authored too.
  it('CHARACTERIZATION: the logged ip_hash is the hash of the caller-supplied first XFF element', async () => {
    inviteRow = null
    const res = makeRes()
    await handler(
      makeReq({ code: 'AAA-1', email: 'a@school.example' }, { 'x-forwarded-for': '1.1.1.1, 198.51.100.4' }),
      res,
    )
    expect(attempts[0].ip_hash).toBe(hashIp('1.1.1.1'))
    expect(attempts[0].ip_hash).not.toBe(hashIp('198.51.100.4'))
  })

  it.todo('AUTH-CORE-05: client IP is derived from a platform-controlled hop, not the first client-supplied XFF element')
})

describe('AUTH-CORE-11 — personal-link session minting (controls that HOLD)', () => {
  // Control that HOLDS: the account signed into comes from the invite row's
  // server-written metadata.personal_auth_user_id (api/groups/[id]/invites.ts
  // derives it from a freshly provisioned persona). A client-supplied id in
  // the request body reaches nothing.
  it('CONTROL: signs in as the invite-bound persona, never a body-supplied user id', async () => {
    inviteRow.metadata = { personal_auth_user_id: 'persona-77', personal_name: 'IME Programme Leader' }

    const res = makeRes()
    await handler(
      makeReq({
        code: 'TEACH-1',
        // Every plausible client-side spoof of the binding, all ignored.
        personal_auth_user_id: 'attacker-uid',
        metadata: { personal_auth_user_id: 'attacker-uid' },
        email: 'attacker@example.com',
      }),
      res,
    )

    expect(res._status).toBe(200)
    expect(res._json).toMatchObject({ success: true, personal: true })
    expect(getUserByIdArg).toBe('persona-77')
    expect(attempts.some((a) => a.outcome === 'personal_signin' && a.auth_user_id === 'persona-77')).toBe(true)
  })

  // Control that HOLDS: privileged code types can never take the
  // never-emailed-anyone path (POSSESSION_ELIGIBLE_CODE_TYPES).
  it('CONTROL: an ssi_admin invite code cannot mint a session through this path', async () => {
    inviteRow.code_type = 'ssi_admin'
    const res = makeRes()
    await handler(makeReq({ code: 'GOD-1', email: 'a@school.example' }), res)

    expect(res._json).toMatchObject({ success: false })
    expect(res._json.session).toBeUndefined()
    expect(attempts.some((a) => a.outcome === 'unsupported_code_type')).toBe(true)
  })

  // Control that HOLDS: an existing email is never handed a session here —
  // the account-takeover rail on the unauthenticated path.
  it('CONTROL: an already-registered email gets 409, never a session', async () => {
    createUserResult = { data: { user: null }, error: { code: 'email_exists', message: 'already been registered' } }
    const res = makeRes()
    await handler(makeReq({ code: 'TEACH-1', email: 'existing@school.example' }), res)

    expect(res._status).toBe(409)
    expect(res._json.session).toBeUndefined()
    expect(res._json.reason).toBe('already_registered')
  })

  // Control that HOLDS: link-auth (no typed email) is pupils only — a teacher
  // invite must capture a real identity rather than mint a link-<uuid> ghost.
  it('CONTROL: link-auth on a named-role code is refused (identity_required)', async () => {
    const res = makeRes()
    await handler(makeReq({ code: 'TEACH-1', linkAuth: true }), res)

    expect(res._json).toMatchObject({ success: false, reason: 'identity_required' })
    expect(res._json.session).toBeUndefined()
  })
})
