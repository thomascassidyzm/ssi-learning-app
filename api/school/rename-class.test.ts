/**
 * Tests for POST /api/school/rename-class — server-mediated replacement for
 * ClassDetail.vue's direct client `classes.update({ class_name })`, which had
 * NO ownership check (classes is RLS-off by design, grants authenticated
 * UPDATE — the cross-tenant write hole, twin of the read leak closed by
 * useAdminGate). Covers: a non-owner is rejected server-side (not just
 * UI-hidden), and the genuine owning teacher/school_admin still succeeds.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-key'

let authUserId: string
vi.mock('../_utils/auth', () => ({
  verifyAuthToken: vi.fn(async () => ({ valid: true, userId: authUserId })),
}))

let scope: any
vi.mock('../_utils/schoolScope', () => ({
  resolveVisibleScope: vi.fn(async () => scope),
}))

let DB: { classes: Array<{ id: string; class_name: string }> }

function makeChainable(table: string) {
  const builder: any = {
    select() { return builder },
    update(patch: any) {
      return {
        eq: (col: string, val: unknown) => {
          const match = ((DB as any)[table] as any[]).find((r) => r[col] === val)
          if (match) Object.assign(match, patch)
          return {
            select: () => ({
              single: async () => (match ? { data: { id: match.id, class_name: match.class_name }, error: null } : { data: null, error: { message: 'not found' } }),
            }),
          }
        },
      }
    },
  }
  return builder
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: (table: string) => makeChainable(table) }),
}))

function makeReq(body: any): VercelRequest {
  return { method: 'POST', body, headers: { authorization: 'Bearer tok' } } as any
}

function makeRes(): VercelResponse & { statusCode?: number; body?: any } {
  const res: any = {}
  res.status = vi.fn((code: number) => { res.statusCode = code; return res })
  res.json = vi.fn((body: any) => { res.body = body; return res })
  return res
}

let handler: typeof import('./rename-class').default

beforeEach(async () => {
  vi.resetModules()
  handler = (await import('./rename-class')).default
  DB = { classes: [{ id: 'other-schools-class', class_name: 'Beginners Welsh' }] }
})

describe('POST /api/school/rename-class', () => {
  it('REJECTS a caller whose scope does not include the target class — 403, no write happens', async () => {
    authUserId = 'random-authenticated-user'
    // Any signed-in caller not scoped to this class — mirrors the pre-fix bug
    // where ANY authenticated request renamed ANY tenant's class.
    scope = { learnerId: 'l-other', role: 'teacher', classIds: ['some-other-class'], learnerIds: [], studentsByClass: {}, schoolIds: [], groupId: null }
    const res = makeRes()
    await handler(makeReq({ class_id: 'other-schools-class', class_name: 'Pwned' }), res)
    expect(res.statusCode).toBe(403)
    expect(DB.classes[0].class_name).toBe('Beginners Welsh')
  })

  it('the owning teacher (class in their taught scope) can rename their own class', async () => {
    authUserId = 'teacher-x'
    scope = { learnerId: 'l1', role: 'teacher', classIds: ['other-schools-class'], learnerIds: [], studentsByClass: {}, schoolIds: [], groupId: null }
    const res = makeRes()
    await handler(makeReq({ class_id: 'other-schools-class', class_name: 'Advanced Welsh' }), res)
    expect(res.statusCode).toBe(200)
    expect(DB.classes[0].class_name).toBe('Advanced Welsh')
    expect(res.body.class.class_name).toBe('Advanced Welsh')
  })

  it('a school_admin whose scope includes the class (via their school) can rename it', async () => {
    authUserId = 'admin-a'
    scope = { learnerId: 'l2', role: 'school_admin', classIds: ['other-schools-class'], learnerIds: [], studentsByClass: {}, schoolIds: ['school-1'], groupId: null }
    const res = makeRes()
    await handler(makeReq({ class_id: 'other-schools-class', class_name: 'Renamed by admin' }), res)
    expect(res.statusCode).toBe(200)
    expect(DB.classes[0].class_name).toBe('Renamed by admin')
  })

  it('400s a missing class_id', async () => {
    authUserId = 'teacher-x'
    scope = { learnerId: 'l1', role: 'teacher', classIds: [], learnerIds: [], studentsByClass: {}, schoolIds: [], groupId: null }
    const res = makeRes()
    await handler(makeReq({ class_name: 'New name' }), res)
    expect(res.statusCode).toBe(400)
  })

  it('400s a blank class_name', async () => {
    authUserId = 'teacher-x'
    scope = { learnerId: 'l1', role: 'teacher', classIds: ['other-schools-class'], learnerIds: [], studentsByClass: {}, schoolIds: [], groupId: null }
    const res = makeRes()
    await handler(makeReq({ class_id: 'other-schools-class', class_name: '   ' }), res)
    expect(res.statusCode).toBe(400)
  })
})
