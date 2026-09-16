/**
 * Tests for POST /api/email/verify — covers the possession-onboarding
 * addition: verifying the account's OWN primary email flips a durable
 * user_metadata.email_confirmed_manually flag (SettingsScreen.vue's
 * "unverified" badge for possession-onboarded accounts reads this).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

process.env.SUPABASE_URL = 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'

vi.mock('../_utils/auth', () => ({
  getAuthUserId: vi.fn(async () => 'user-1'),
}))

let verifyOtpResult: any
let learnerRow: any
let crossAccountLearner: any
let authUser: any
let updateUserByIdCalls: any[]
let learnersUpdateCalls: any[]
// Stub-absorption fixtures: the colliding learner's own row (as read back by
// isAbsorbableStub), the auth user behind it, its activity row count, and
// every delete the handler issues.
let stubLearnerRow: any
let stubAuthUser: any
let stubActivityCount: number
let deleteCalls: any[]
let deletedAuthUsers: string[]

function makeLearnersBuilder(table: string) {
  const calls: any[] = []
  const builder: any = {
    select: (...args: any[]) => {
      calls.push(['select', ...args])
      return builder
    },
    delete: () => {
      calls.push(['delete'])
      deleteCalls.push({ table, calls })
      return builder
    },
    // Awaiting a head-count probe (.select('id', {count, head}).eq(...)) lands
    // here: a stub has zero activity rows, a real account has some.
    then: (resolve: any) => {
      const head = calls.some((c) => c[0] === 'select' && c[2]?.head)
      if (head) return resolve({ count: table === 'learners' ? 0 : stubActivityCount, error: null })
      if (calls.some((c) => c[0] === 'delete')) return resolve({ error: null })
      return resolve({ data: null, error: null })
    },
    update: (obj: any) => {
      calls.push(['update', obj])
      learnersUpdateCalls.push(obj)
      return builder
    },
    contains: (...args: any[]) => {
      calls.push(['contains', ...args])
      return builder
    },
    eq: (...args: any[]) => {
      calls.push(['eq', ...args])
      return builder
    },
    // AUTH-CORE-04's OTP budget counts rows in possession_mint_attempts with
    // a .gte('created_at', …) terminator; the window is empty in these tests so
    // every case below exercises the same path it always did.
    gte: (...args: any[]) => {
      calls.push(['gte', ...args])
      return Promise.resolve({ count: 0, error: null })
    },
    // The attempt audit row (best-effort insert).
    insert: (obj: any) => {
      calls.push(['insert', obj])
      return Promise.resolve({ error: null })
    },
    limit: (...args: any[]) => {
      calls.push(['limit', ...args])
      return builder
    },
    single: () => {
      const isContains = calls.some((c) => c[0] === 'contains')
      if (isContains) return Promise.resolve({ data: crossAccountLearner, error: null })
      return Promise.resolve({ data: learnerRow, error: null })
    },
    // AUTH-CORE-06 moved the cross-account collision probe from .single() to
    // .limit(1).maybeSingle(); it resolves to the same fixture.
    maybeSingle: () => {
      const isContains = calls.some((c) => c[0] === 'contains')
      if (isContains) return Promise.resolve({ data: crossAccountLearner, error: null })
      const readsStub = calls.some((c) => c[0] === 'select' && c[1] === 'verified_emails')
      if (readsStub) return Promise.resolve({ data: stubLearnerRow, error: null })
      return Promise.resolve({ data: learnerRow, error: null })
    },
  }
  return builder
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => makeLearnersBuilder(table),
    auth: {
      verifyOtp: () => Promise.resolve(verifyOtpResult),
      admin: {
        getUserById: (id: string) =>
          Promise.resolve({ data: { user: id === 'user-1' ? authUser : stubAuthUser } }),
        deleteUser: (id: string) => {
          deletedAuthUsers.push(id)
          return Promise.resolve({ data: {}, error: null })
        },
        updateUserById: (id: string, patch: any) => {
          updateUserByIdCalls.push({ id, patch })
          return Promise.resolve({ data: {}, error: null })
        },
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

describe('POST /api/email/verify', () => {
  let handler: typeof import('./verify').default

  beforeEach(async () => {
    vi.resetModules()
    updateUserByIdCalls = []
    learnersUpdateCalls = []
    verifyOtpResult = { error: null }
    learnerRow = { id: 'learner-1', verified_emails: [] }
    crossAccountLearner = null
    stubLearnerRow = null
    stubAuthUser = null
    stubActivityCount = 0
    deleteCalls = []
    deletedAuthUsers = []
    authUser = { id: 'user-1', email: 'teacher@school.example', user_metadata: { onboarded_via: 'possession' } }
    handler = (await import('./verify')).default
  })

  it('flips email_confirmed_manually when verifying the account primary email', async () => {
    const res = makeRes()
    await handler(makeReq({ email: 'teacher@school.example', token: '123456' }), res)

    expect(res._status).toBe(200)
    expect(res._json.success).toBe(true)
    expect(updateUserByIdCalls).toHaveLength(1)
    expect(updateUserByIdCalls[0].patch.user_metadata).toEqual({
      onboarded_via: 'possession',
      email_confirmed_manually: true,
    })
    // Mirrors onto the queryable learners.needs_verification column
    // (admin Users page / onboarding-email team's signal).
    expect(learnersUpdateCalls).toContainEqual({ needs_verification: false })
  })

  it('does not touch user_metadata when verifying a different (secondary) email', async () => {
    const res = makeRes()
    await handler(makeReq({ email: 'personal@example.com', token: '123456' }), res)

    expect(res._status).toBe(200)
    expect(updateUserByIdCalls).toHaveLength(0)
  })

  it('returns 400 on an invalid OTP', async () => {
    verifyOtpResult = { error: { message: 'Token has expired or is invalid' } }
    const res = makeRes()
    await handler(makeReq({ email: 'teacher@school.example', token: '000000' }), res)
    expect(res._status).toBe(400)
    expect(updateUserByIdCalls).toHaveLength(0)
  })

  it('returns 409 when the email is already linked to a different account', async () => {
    crossAccountLearner = { id: 'learner-2', user_id: 'someone-else' }
    // A real second account: same address, but it has played.
    stubLearnerRow = { verified_emails: ['personal@example.com'] }
    stubAuthUser = { id: 'someone-else', email: 'personal@example.com' }
    stubActivityCount = 8
    const res = makeRes()
    await handler(makeReq({ email: 'personal@example.com', token: '123456' }), res)
    expect(res._status).toBe(409)
    expect(res._json.code).toBe('email_on_other_account')
    expect(deleteCalls).toHaveLength(0)
    expect(deletedAuthUsers).toHaveLength(0)
    expect(updateUserByIdCalls).toHaveLength(0)
  })

  // Tom, 2026-09-14, production: linking a never-seen plus-address was refused
  // as "already linked to another account". send-code's generateLink had
  // created an auth user for it and the on_auth_user_created trigger a learners
  // row holding that one address — the "other account" was our own empty stub.
  it('absorbs the stub the sign-in code path minted, and links the email', async () => {
    crossAccountLearner = { id: 'stub-learner', user_id: 'stub-user' }
    stubLearnerRow = { verified_emails: ['fresh@example.com'] }
    stubAuthUser = { id: 'stub-user', email: 'fresh@example.com' }
    stubActivityCount = 0
    const res = makeRes()
    await handler(makeReq({ email: 'fresh@example.com', token: '123456' }), res)
    expect(res._status).toBe(200)
    expect(deleteCalls.map((d) => d.table)).toEqual(['learners'])
    expect(deleteCalls[0].calls).toContainEqual(['eq', 'id', 'stub-learner'])
    expect(deletedAuthUsers).toEqual(['stub-user'])
    expect(learnersUpdateCalls[0]).toEqual({ verified_emails: ['fresh@example.com'] })
  })

  it('does not absorb a learner that holds more than the one address', async () => {
    crossAccountLearner = { id: 'learner-2', user_id: 'someone-else' }
    stubLearnerRow = { verified_emails: ['fresh@example.com', 'other@example.com'] }
    stubAuthUser = { id: 'someone-else', email: 'fresh@example.com' }
    stubActivityCount = 0
    const res = makeRes()
    await handler(makeReq({ email: 'fresh@example.com', token: '123456' }), res)
    expect(res._status).toBe(409)
    expect(deleteCalls).toHaveLength(0)
  })
})
