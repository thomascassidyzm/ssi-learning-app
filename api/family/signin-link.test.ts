/**
 * POST /api/family/signin-link — a child is never removable into unreachability.
 *
 * The bar these tests hold (job #376·F, D7): a child account has no email and
 * no way to pay; the ONLY door into it is a parent-minted link. So the link
 * mints for any child row the caller owns, REMOVED OR NOT. Removing someone
 * changes what they can reach, never what they have done — and it must never
 * make their own account unreachable to them.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

process.env.SUPABASE_URL = 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'

let authResult: any = { valid: true, userId: 'auth-owner-1' }
vi.mock('../_utils/auth', () => ({
  verifyAuthToken: vi.fn(async () => authResult),
}))

let membershipRow: any
let generateLinkCalls: any[] = []

function makeChainable(table: string) {
  const calls: any[][] = []
  const builder: any = {
    select: (c: string) => { calls.push(['select', c]); return builder },
    eq: (col: string, val: unknown) => { calls.push(['eq', col, val]); return builder },
    resolve: () => {
      if (table === 'learners') {
        const eqCall = calls.find((c) => c[0] === 'eq')!
        // resolveLearnerId(owner auth uid) vs the child learner lookup by id
        if (eqCall[1] === 'user_id') return { data: { id: 'learner-owner' }, error: null }
        return { data: { user_id: 'auth-child-1' }, error: null }
      }
      if (table === 'family_members') return { data: membershipRow, error: null }
      return { data: null, error: null }
    },
    maybeSingle() { return Promise.resolve(this.resolve()) },
    single() { return Promise.resolve(this.resolve()) },
    then(onF: any, onR: any) { return Promise.resolve(this.resolve()).then(onF, onR) },
  }
  return builder
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => makeChainable(table),
    auth: {
      admin: {
        getUserById: vi.fn(async () => ({ data: { user: { email: 'lewis@child.ssi.invalid' } }, error: null })),
        generateLink: vi.fn(async (opts: any) => {
          generateLinkCalls.push(opts)
          return { data: { properties: { action_link: 'https://signin.example/abc' } }, error: null }
        }),
      },
    },
  }),
}))

function makeReq(overrides: Partial<VercelRequest> = {}): VercelRequest {
  return { method: 'POST', query: {}, headers: { authorization: 'Bearer tok' }, body: { member_id: 'fm-1' }, ...overrides } as VercelRequest
}

function makeRes() {
  const res: any = {}
  res.status = vi.fn((code: number) => { res._status = code; return res })
  res.json = vi.fn((body: unknown) => { res._json = body; return res })
  return res as VercelResponse & { _status?: number; _json?: any }
}

const liveChild = () => ({
  id: 'fm-1',
  owner_learner_id: 'learner-owner',
  member_learner_id: 'learner-child',
  is_child_account: true,
  removed_at: null,
})

describe('POST /api/family/signin-link', () => {
  let handler: typeof import('./signin-link').default

  beforeEach(async () => {
    vi.resetModules()
    generateLinkCalls = []
    authResult = { valid: true, userId: 'auth-owner-1' }
    membershipRow = liveChild()
    handler = (await import('./signin-link')).default
  })

  it('mints a link for a live child row the caller owns', async () => {
    const res = makeRes()
    await handler(makeReq(), res)
    expect(res._status).toBe(200)
    expect(res._json.signInLink).toBe('https://signin.example/abc')
  })

  it('THE FIX: mints a link for a REMOVED child row — a removed child is never unreachable', async () => {
    membershipRow = { ...liveChild(), removed_at: '2026-09-08T10:00:00Z' }
    const res = makeRes()
    await handler(makeReq(), res)
    expect(res._status).toBe(200)
    expect(res._json.signInLink).toBe('https://signin.example/abc')
    expect(generateLinkCalls).toHaveLength(1)
  })

  it('still refuses a row belonging to somebody else, removed or not', async () => {
    membershipRow = { ...liveChild(), owner_learner_id: 'learner-someone-else', removed_at: '2026-09-08T10:00:00Z' }
    const res = makeRes()
    await handler(makeReq(), res)
    expect(res._status).toBe(404)
    expect(generateLinkCalls).toHaveLength(0)
  })

  it('still refuses an adult member row — sign-in links are child-accounts-only', async () => {
    membershipRow = { ...liveChild(), is_child_account: false }
    const res = makeRes()
    await handler(makeReq(), res)
    expect(res._status).toBe(400)
    expect(generateLinkCalls).toHaveLength(0)
  })

  it('404s when the row does not exist at all', async () => {
    membershipRow = null
    const res = makeRes()
    await handler(makeReq(), res)
    expect(res._status).toBe(404)
  })
})
