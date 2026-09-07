/**
 * Tests for POST /api/school/practice-by-course — the endpoint that replaced
 * four browser callers of `admin_practice_minutes_by_course` so that function
 * could lose its `authenticated` grant.
 *
 * The case that matters is the one the old direct RPC got wrong: a signed-in
 * caller naming a learner UUID that is not theirs to read. It must be a LOUD
 * 403, never a 200 with an empty list (the silent-empty failure this repo's
 * RLS doctrine names) and never a partial answer with the id quietly dropped.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-key'

let adminResult: any
vi.mock('../_utils/auth', () => ({
  verifyAuthToken: vi.fn(async () => ({ valid: true, userId: 'caller-1' })),
  verifyAdmin: vi.fn(async () => adminResult),
}))

let scope: any
vi.mock('../_utils/schoolScope', () => ({
  resolveVisibleScope: vi.fn(async () => scope),
}))

let rpcCalls: any[]
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    rpc: (name: string, args: any) => {
      rpcCalls.push({ name, args })
      return Promise.resolve({ data: [{ course_code: 'cym_n_for_eng', practice_minutes: 42, is_estimated: false }], error: null })
    },
  }),
}))

function makeReq(body: unknown): VercelRequest {
  return { method: 'POST', body, query: {}, headers: { authorization: 'Bearer tok' } } as any
}

function makeRes(): VercelResponse & { statusCode?: number; body?: any } {
  const res: any = {}
  res.setHeader = vi.fn()
  res.status = vi.fn((code: number) => { res.statusCode = code; return res })
  res.json = vi.fn((body: any) => { res.body = body; return res })
  return res
}

let handler: typeof import('./practice-by-course').default

beforeEach(async () => {
  vi.resetModules()
  handler = (await import('./practice-by-course')).default
  rpcCalls = []
  adminResult = { error: 'Requires SSi admin access', status: 403 }
  scope = {
    learnerId: 'me', role: 'teacher', classIds: ['c1'], learnerIds: ['mine-1', 'mine-2'],
    studentsByClass: { c1: ['mine-1', 'mine-2'] }, schoolIds: [], groupId: null,
  }
})

describe('POST /api/school/practice-by-course', () => {
  it('returns practice for learners inside the caller\'s scope', async () => {
    const res = makeRes()
    await handler(makeReq({ learner_ids: ['mine-1', 'mine-2'] }), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.practice).toEqual([{ course_code: 'cym_n_for_eng', practice_minutes: 42, is_estimated: false }])
    expect(rpcCalls[0].args).toEqual({ p_learner_ids: ['mine-1', 'mine-2'] })
  })

  it('lets a caller read their OWN learner id with no class scope at all', async () => {
    scope = { learnerId: 'me', role: null, classIds: [], learnerIds: [], studentsByClass: {}, schoolIds: [], groupId: null }
    const res = makeRes()
    await handler(makeReq({ learner_ids: ['me'] }), res)
    expect(res.statusCode).toBe(200)
  })

  it('REFUSES LOUDLY when any named learner is outside the scope — 403, no rows, no silent drop', async () => {
    const res = makeRes()
    await handler(makeReq({ learner_ids: ['mine-1', 'a-stranger'] }), res)
    expect(res.statusCode).toBe(403)
    expect(res.body.error).toBe('out_of_scope')
    expect(res.body.message).toContain('1 of 2')
    expect(res.body.practice).toBeUndefined()
    expect(rpcCalls).toHaveLength(0)
  })

  it('403s a non-admin asking for the platform-wide aggregate by omitting learner_ids', async () => {
    const res = makeRes()
    await handler(makeReq({}), res)
    expect(res.statusCode).toBe(403)
    expect(rpcCalls).toHaveLength(0)
  })

  it('admin passthrough: an ssi_admin may name any learner, and omitting ids means platform-wide', async () => {
    adminResult = { userId: 'caller-1' }
    const res1 = makeRes()
    await handler(makeReq({ learner_ids: ['a-stranger'] }), res1)
    expect(res1.statusCode).toBe(200)

    const res2 = makeRes()
    await handler(makeReq({}), res2)
    expect(res2.statusCode).toBe(200)
    expect(rpcCalls[1].args).toEqual({ p_learner_ids: null })
  })

  it('400s an empty learner_ids array rather than guessing what it meant', async () => {
    const res = makeRes()
    await handler(makeReq({ learner_ids: [] }), res)
    expect(res.statusCode).toBe(400)
    expect(rpcCalls).toHaveLength(0)
  })

  it('405s a GET — ids travel in a JSON body, not a URL', async () => {
    const res = makeRes()
    const req = { method: 'GET', query: {}, headers: { authorization: 'Bearer tok' } } as any
    await handler(req, res)
    expect(res.statusCode).toBe(405)
  })
})
