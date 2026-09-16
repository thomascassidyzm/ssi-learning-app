import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

process.env.SUPABASE_URL = 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'

let verifyAdminResult: any
let verifyAuthTokenResult: any
vi.mock('../../_utils/auth', () => ({
  verifyAdmin: vi.fn(async () => verifyAdminResult),
  verifyAuthToken: vi.fn(async () => verifyAuthTokenResult),
}))
let visibleScopeResult: any
vi.mock('../../_utils/schoolScope', () => ({ resolveVisibleScope: vi.fn(async () => visibleScopeResult) }))

let classRow: any
let updates: any[]
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => {
      const q: any = {
        select: () => q,
        eq: () => q,
        maybeSingle: async () => ({ data: table === 'classes' ? classRow : null }),
        update: (patch: any) => { updates.push(patch); return { eq: async () => ({ error: null }) } },
      }
      return q
    },
  }),
}))

const { default: handler } = await import('./tags')

function call(method: string, body: any, headers: Record<string, string> = {}) {
  const res: any = { statusCode: 0, body: null, headers: {} as Record<string, string> }
  res.status = (c: number) => { res.statusCode = c; return res }
  res.json = (b: any) => { res.body = b; return res }
  res.setHeader = (k: string, v: string) => { res.headers[k] = v }
  res.end = () => res
  const req = { method, query: { id: 'c1' }, body, headers: { origin: 'https://saysomethingin.app', ...headers } } as unknown as VercelRequest
  return handler(req, res as VercelResponse).then(() => res)
}

beforeEach(() => {
  verifyAdminResult = { error: 'not admin', status: 403, userId: 'teacher-uid' }
  verifyAuthTokenResult = { valid: true, userId: 'teacher-uid' }
  visibleScopeResult = { classIds: ['c1'], schoolIds: [], groupId: null }
  classRow = { id: 'c1', class_name: 'Grade 6A', course_code: 'eng_for_hin', tags: {} }
  updates = []
})

describe('PATCH /api/classes/:id/tags', () => {
  it('confirms a year in place and answers the fresh view, confirmed', async () => {
    const res = await call('PATCH', { year: '6' })
    expect(res.statusCode).toBe(200)
    expect(updates).toEqual([{ tags: { year: '6' } }])
    expect(res.body.tags.year).toEqual({ value: '6', confirmed: true, derived: '6' })
    expect(res.body.tags.department.confirmed).toBe(false)
  })
  it('null clears a tag back to a guess; an untouched key is left alone', async () => {
    classRow.tags = { year: '7', department: 'English' }
    const res = await call('PATCH', { year: null })
    expect(updates).toEqual([{ tags: { department: 'English' } }])
    expect(res.body.tags.year).toEqual({ value: '6', confirmed: false, derived: '6' })
  })
  it('a class outside the caller’s scope is 403; nothing is written', async () => {
    visibleScopeResult = { classIds: ['other'], schoolIds: [], groupId: null }
    const res = await call('PATCH', { year: '6' })
    expect(res.statusCode).toBe(403)
    expect(updates).toEqual([])
  })
  it('View As is read-only here too', async () => {
    const res = await call('PATCH', { year: '6' }, { 'x-ssi-view-as': '1' })
    expect(res.statusCode).toBe(403)
    expect(updates).toEqual([])
  })
  it('an empty body is a 400, not a silent no-op', async () => {
    const res = await call('PATCH', {})
    expect(res.statusCode).toBe(400)
  })
})
