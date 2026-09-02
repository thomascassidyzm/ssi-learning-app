/**
 * Tests for POST /api/auth/access-code-redeem — the teacher's return route.
 *
 * Two things must be true of every refusal here, and both are asserted rather
 * than assumed: no session comes back, and the message does not tell the caller
 * WHICH refusal it was. The second matters because an endpoint that
 * distinguishes "unknown" from "already used" is an enumeration oracle for a
 * credential that mints sessions.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-key'
process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'anon-key'

let overLimit: boolean
let loggedAttempts: any[]
vi.mock('../_utils/codeAttemptThrottle', async (importOriginal) => {
  const actual = (await importOriginal()) as any
  return {
    ...actual,
    isIpOverLimit: vi.fn(async () => overLimit),
    logAttempt: vi.fn(async (_c: any, _l: string, fields: any) => { loggedAttempts.push(fields) }),
  }
})

let claimResult: any
let claimFilters: any[][]
let getUserByIdResult: any
let generateLinkResult: any
let verifyOtpResult: any
let verifyOtpArg: any

function makeQueryBuilder(table: string) {
  const calls: any[] = []
  const builder: any = {}
  for (const m of ['update', 'eq', 'is', 'gt', 'select']) {
    builder[m] = (...args: any[]) => {
      calls.push([m, ...args])
      return builder
    }
  }
  builder.maybeSingle = () => {
    if (table === 'staff_access_codes') {
      claimFilters.push(calls)
      return Promise.resolve(claimResult)
    }
    return Promise.resolve({ data: null, error: null })
  }
  return builder
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: (_url: string, key: string) => ({
    from: (table: string) => makeQueryBuilder(table),
    auth: {
      // The anon client is the one that mints; the service client is the one
      // that claims. They are told apart by their key, exactly as in the code.
      verifyOtp: (arg: any) => {
        verifyOtpArg = { ...arg, key }
        return Promise.resolve(verifyOtpResult)
      },
      admin: {
        getUserById: () => Promise.resolve(getUserByIdResult),
        generateLink: () => Promise.resolve(generateLinkResult),
      },
    },
  }),
}))

let handler: typeof import('./access-code-redeem').default

function makeReq(method: string, body?: any): VercelRequest {
  return { method, headers: { host: 'staging.saysomethingin.app' }, body } as any
}

function makeRes(): VercelResponse & { statusCode?: number; body?: any } {
  const res: any = {}
  res.status = vi.fn((code: number) => { res.statusCode = code; return res })
  res.json = vi.fn((body: any) => { res.body = body; return res })
  return res
}

const GOOD_CODE = 'ABCD-2345'

beforeEach(async () => {
  overLimit = false
  loggedAttempts = []
  claimResult = { data: { id: 'code-1', target_user_id: 'target-1', school_id: 'school-1' }, error: null }
  claimFilters = []
  getUserByIdResult = { data: { user: { id: 'target-1', email: 'teacher@hwbcymru.net' } }, error: null }
  generateLinkResult = { data: { properties: { hashed_token: 'hashed-abc' } }, error: null }
  verifyOtpResult = {
    data: {
      session: { access_token: 'at', refresh_token: 'rt' },
      user: { id: 'target-1', user_metadata: {} },
    },
    error: null,
  }
  verifyOtpArg = undefined
  handler = (await import('./access-code-redeem')).default
})

describe('POST /api/auth/access-code-redeem', () => {
  it('rejects a non-POST method', async () => {
    const res = makeRes()
    await handler(makeReq('GET'), res)
    expect(res.statusCode).toBe(405)
  })

  it('mints a DURABLE session and asks for a credential — the whole point', async () => {
    const res = makeRes()
    await handler(makeReq('POST', { code: GOOD_CODE }), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.session).toEqual({ access_token: 'at', refresh_token: 'rt' })
    // "If the link is one-use and just lets them in once, you've solved
    // nothing" — the client must be told to put the credential screen up.
    expect(res.body.needs_credential).toBe(true)
    expect(loggedAttempts.some((a) => a.outcome === 'access_code_minted')).toBe(true)
  })

  it('does not ask again when the account already has a password', async () => {
    verifyOtpResult.data.user.user_metadata = { has_password: true }
    const res = makeRes()
    await handler(makeReq('POST', { code: GOOD_CODE }), res)
    expect(res.body.needs_credential).toBe(false)
  })

  it('mints via token_hash, never an origin-bearing action_link', async () => {
    const res = makeRes()
    await handler(makeReq('POST', { code: GOOD_CODE }), res)
    expect(res.statusCode).toBe(200)
    // GoTrue rejects `email` alongside `token_hash`, and an action_link would
    // drag a redirect_to origin in with it.
    expect(verifyOtpArg).toMatchObject({ token_hash: 'hashed-abc', type: 'magiclink' })
    expect(verifyOtpArg.email).toBeUndefined()
    expect(verifyOtpArg.key).toBe('anon-key')
  })

  it('claims the row atomically: unredeemed AND unexpired, in the UPDATE itself', async () => {
    const res = makeRes()
    await handler(makeReq('POST', { code: GOOD_CODE }), res)
    expect(res.statusCode).toBe(200)
    // A read-then-write here is the classic double-redeem race, on an endpoint
    // that mints sessions.
    const flat = JSON.stringify(claimFilters[0])
    expect(flat).toContain('update')
    expect(flat).toContain('redeemed_at')
    expect(flat).toContain('expires_at')
    expect(flat).toContain('code_hash')
  })

  it('never sends the code itself to the database — only its sha256', async () => {
    const res = makeRes()
    await handler(makeReq('POST', { code: GOOD_CODE }), res)
    expect(res.statusCode).toBe(200)
    const flat = JSON.stringify(claimFilters[0])
    expect(flat).not.toContain('ABCD2345')
    expect(flat).not.toContain('ABCD-2345')
  })

  it('404s with no session when the code is unknown, used or expired', async () => {
    claimResult = { data: null, error: null }
    const res = makeRes()
    await handler(makeReq('POST', { code: GOOD_CODE }), res)
    expect(res.statusCode).toBe(404)
    expect(res.body.session).toBeUndefined()
    expect(res.body.success).toBe(false)
  })

  it('gives the SAME message for unknown, used and expired — no oracle', async () => {
    // All three land on the same claim miss by construction, so the assertion
    // that matters is that the message names none of them and points at the
    // person who can actually help.
    claimResult = { data: null, error: null }
    const res = makeRes()
    await handler(makeReq('POST', { code: GOOD_CODE }), res)
    const msg = String(res.body.error).toLowerCase()
    expect(msg).not.toContain('unknown')
    expect(msg).not.toContain('does not exist')
    expect(msg).toContain('ask whoever gave it to you')
  })

  it('a second redemption of the same code fails — single use', async () => {
    const first = makeRes()
    await handler(makeReq('POST', { code: GOOD_CODE }), first)
    expect(first.statusCode).toBe(200)
    // The claim UPDATE has now set redeemed_at, so the second attempt matches
    // no row.
    claimResult = { data: null, error: null }
    const second = makeRes()
    await handler(makeReq('POST', { code: GOOD_CODE }), second)
    expect(second.statusCode).toBe(404)
    expect(second.body.session).toBeUndefined()
  })

  it('400s on a malformed code, and says what a code looks like', async () => {
    for (const bad of ['nope', '', 'ABCD-234O', undefined, 12345678]) {
      const res = makeRes()
      await handler(makeReq('POST', { code: bad }), res)
      expect(res.statusCode).toBe(400)
      expect(res.body.session).toBeUndefined()
    }
  })

  it('429s before it looks anything up, when the IP is over its limit', async () => {
    overLimit = true
    const res = makeRes()
    await handler(makeReq('POST', { code: GOOD_CODE }), res)
    expect(res.statusCode).toBe(429)
    expect(claimFilters).toHaveLength(0)
    expect(loggedAttempts.some((a) => a.outcome === 'rate_limited_ip')).toBe(true)
  })

  it('503s and mints nothing when the claim query errors — doubt refuses', async () => {
    claimResult = { data: null, error: { message: 'connection reset' } }
    const res = makeRes()
    await handler(makeReq('POST', { code: GOOD_CODE }), res)
    expect(res.statusCode).toBe(503)
    expect(res.body.session).toBeUndefined()
  })

  it('500s with no session when the target account has no address on file', async () => {
    getUserByIdResult = { data: { user: { id: 'target-1', email: null } }, error: null }
    const res = makeRes()
    await handler(makeReq('POST', { code: GOOD_CODE }), res)
    expect(res.statusCode).toBe(500)
    expect(res.body.session).toBeUndefined()
  })

  it('500s with no session when generateLink fails', async () => {
    generateLinkResult = { data: null, error: { message: 'boom' } }
    const res = makeRes()
    await handler(makeReq('POST', { code: GOOD_CODE }), res)
    expect(res.statusCode).toBe(500)
    expect(res.body.session).toBeUndefined()
  })

  it('500s with no session when the session mint itself fails', async () => {
    verifyOtpResult = { data: null, error: { message: 'expired' } }
    const res = makeRes()
    await handler(makeReq('POST', { code: GOOD_CODE }), res)
    expect(res.statusCode).toBe(500)
    expect(res.body.session).toBeUndefined()
    expect(loggedAttempts.some((a) => a.outcome === 'mint_failed')).toBe(true)
  })

  it('logs every attempt, refusals included', async () => {
    claimResult = { data: null, error: null }
    const res = makeRes()
    await handler(makeReq('POST', { code: GOOD_CODE }), res)
    expect(res.statusCode).toBe(404)
    expect(loggedAttempts.some((a) => a.outcome === 'access_code_rejected')).toBe(true)
    // Hashed, never raw — the same convention as its siblings.
    expect(loggedAttempts[0].ipHash).toMatch(/^[0-9a-f]{16}$/)
  })
})
