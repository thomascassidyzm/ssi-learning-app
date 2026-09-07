/**
 * Tests for POST /api/auth/buyer-account — the account a buyer gets WITHOUT
 * an email round-trip, so that verifying an address never stands in front of
 * paying (Tom, 2026-09-07).
 *
 * The two that matter:
 *   - the happy path really does mint a session with nothing emailed, and
 *     leaves the account marked as never having proved its mailbox;
 *   - an address that already has an account is NEVER minted a session, which
 *     is the account-takeover rail this endpoint lives or dies on.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

process.env.SUPABASE_URL = 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'
process.env.VITE_SUPABASE_ANON_KEY = 'anon-key'
process.env.SUPABASE_ANON_KEY = 'anon-key'

let mxResolution: 'has-mx' | 'no-mx' = 'has-mx'
vi.mock('dns', () => ({
  promises: {
    resolveMx: vi.fn(async () => {
      if (mxResolution === 'no-mx') {
        const err: any = new Error('queryMx ENOTFOUND')
        err.code = 'ENOTFOUND'
        throw err
      }
      return [{ exchange: 'mx.example.com', priority: 10 }]
    }),
  },
}))

let createUserResult: any
let createUserArg: any
let generateLinkResult: any
let verifyOtpResult: any
let deleteUserCalls: string[]
let learnerInserts: any[]
let learnerDeletes: string[]
let attempts: any[]
let ipCount: number

function attemptsBuilder() {
  const builder: any = {
    select: () => builder,
    eq: () => builder,
    neq: () => builder,
    gte: () => Promise.resolve({ count: ipCount, data: null, error: null }),
    insert: (obj: any) => {
      attempts.push(obj)
      return Promise.resolve({ error: null })
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
        if (table === 'possession_mint_attempts') return attemptsBuilder()
        if (table === 'learners') {
          return {
            insert: (row: any) => {
              learnerInserts.push(row)
              return Promise.resolve({ error: null })
            },
            delete: () => ({
              eq: (_col: string, val: string) => {
                learnerDeletes.push(val)
                return Promise.resolve({ error: null })
              },
            }),
          }
        }
        return {}
      },
      auth: {
        admin: {
          createUser: (arg: any) => {
            createUserArg = arg
            return Promise.resolve(createUserResult)
          },
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

// Dynamic import inside beforeEach: the handler reads its env at module
// scope, and a static import is hoisted ABOVE the process.env assignments
// above (the same reason possession-redeem.test.ts imports this way).
let handler: (req: VercelRequest, res: VercelResponse) => Promise<void>

function makeRes() {
  const res: any = { statusCode: 0, body: null, headers: {} as Record<string, string> }
  res.status = (code: number) => {
    res.statusCode = code
    return res
  }
  res.json = (payload: any) => {
    res.body = payload
    return res
  }
  res.setHeader = (k: string, v: string) => {
    res.headers[k] = v
    return res
  }
  res.end = () => res
  return res as VercelResponse & { statusCode: number; body: any }
}

function makeReq(body: any): VercelRequest {
  return {
    method: 'POST',
    headers: { 'x-forwarded-for': '203.0.113.7' },
    body,
  } as unknown as VercelRequest
}

describe('POST /api/auth/buyer-account', () => {
  beforeEach(async () => {
    handler = (await import('./buyer-account')).default
    mxResolution = 'has-mx'
    ipCount = 0
    attempts = []
    learnerInserts = []
    learnerDeletes = []
    deleteUserCalls = []
    createUserArg = undefined
    createUserResult = { data: { user: { id: 'user-new' } }, error: null }
    generateLinkResult = { data: { properties: { hashed_token: 'hashed-abc' } }, error: null }
    verifyOtpResult = {
      data: { session: { access_token: 'at-1', refresh_token: 'rt-1' } },
      error: null,
    }
  })

  it('mints an account and a session with nothing emailed', async () => {
    const res = makeRes()
    await handler(makeReq({ email: 'Buyer@Example.com' }), res)

    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({
      success: true,
      session: { access_token: 'at-1', refresh_token: 'rt-1' },
    })
    // Nothing is sent, and nothing downstream is told this address is proven.
    expect(createUserArg.email_confirm).toBe(false)
    expect(createUserArg.email).toBe('buyer@example.com')
    expect(createUserArg.user_metadata.onboarded_via).toBe('possession')
    // The learner row exists BEFORE Paddle, because the webhook resolves the
    // payer by supabase_user_id → learners.user_id.
    expect(learnerInserts).toHaveLength(1)
    expect(learnerInserts[0]).toMatchObject({ user_id: 'user-new', needs_verification: true })
  })

  it('sets the password when one is given, and never demands one', async () => {
    await handler(makeReq({ email: 'buyer@example.com', password: 'hunter22' }), makeRes())
    expect(createUserArg.password).toBe('hunter22')

    createUserArg = undefined
    await handler(makeReq({ email: 'other@example.com' }), makeRes())
    expect(createUserArg.password).toBeUndefined()
  })

  it('REFUSES to mint a session for an address that already has an account', async () => {
    createUserResult = { data: null, error: { code: 'email_exists', message: 'already registered' } }
    const res = makeRes()
    await handler(makeReq({ email: 'victim@example.com' }), res)

    expect(res.statusCode).toBe(409)
    expect(res.body.reason).toBe('already_registered')
    expect(res.body.session).toBeUndefined()
  })

  it('rolls BOTH rows back when the session mint fails', async () => {
    verifyOtpResult = { data: null, error: { message: 'nope' } }
    const res = makeRes()
    await handler(makeReq({ email: 'buyer@example.com' }), res)

    expect(res.statusCode).toBe(500)
    // learners.user_id has no FK to auth.users, so deleting the auth user
    // alone would strand a row every future sign-in would silently adopt.
    expect(deleteUserCalls).toEqual(['user-new'])
    expect(learnerDeletes).toEqual(['user-new'])
  })

  it('rejects a malformed address and a disposable one before any admin call', async () => {
    const bad = makeRes()
    await handler(makeReq({ email: 'not-an-email' }), bad)
    expect(bad.statusCode).toBe(400)

    const disposable = makeRes()
    await handler(makeReq({ email: 'x@mailinator.com' }), disposable)
    expect(disposable.statusCode).toBe(400)

    expect(createUserArg).toBeUndefined()
  })

  it('throttles by IP through the shared mint limiter', async () => {
    ipCount = 100 // MINT_PER_IP_LIMIT
    const res = makeRes()
    await handler(makeReq({ email: 'buyer@example.com' }), res)
    expect(res.statusCode).toBe(429)
    expect(createUserArg).toBeUndefined()
  })
})
