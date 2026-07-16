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

function makeLearnersBuilder() {
  const calls: any[] = []
  const builder: any = {
    select: (...args: any[]) => {
      calls.push(['select', ...args])
      return builder
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
    single: () => {
      const isContains = calls.some((c) => c[0] === 'contains')
      if (isContains) return Promise.resolve({ data: crossAccountLearner, error: null })
      return Promise.resolve({ data: learnerRow, error: null })
    },
  }
  return builder
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => makeLearnersBuilder(),
    auth: {
      verifyOtp: () => Promise.resolve(verifyOtpResult),
      admin: {
        getUserById: () => Promise.resolve({ data: { user: authUser } }),
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
    // Mirrors onto the queryable learners.needs_email_verification column
    // (admin Users page / onboarding-email team's signal).
    expect(learnersUpdateCalls).toContainEqual({ needs_email_verification: false })
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
    const res = makeRes()
    await handler(makeReq({ email: 'personal@example.com', token: '123456' }), res)
    expect(res._status).toBe(409)
    expect(updateUserByIdCalls).toHaveLength(0)
  })
})
