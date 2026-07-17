/**
 * Tests for GET/POST /api/school/delete-class — self-serve capability delete
 * for the reported gap ("a teacher can't delete a class they set up
 * wrongly"). Ownership uses the SAME resolveVisibleScope primitive as
 * rename-class.ts (a fails-first regression: a caller outside the class's
 * scope must be rejected server-side, not just UI-hidden), and the
 * real-activity confirm-name escalation mirrors the admin school/group
 * delete endpoints.
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

let classImpact: any
let deleteCascadeError: Error | null = null
const computeClassImpact = vi.fn(async () => {
  if (!classImpact) throw new Error('Class not found')
  return classImpact
})
const deleteClassCascade = vi.fn(async () => {
  if (deleteCascadeError) throw deleteCascadeError
})
vi.mock('../_utils/schoolGroupDeletion', () => ({
  computeClassImpact: (...args: any[]) => computeClassImpact(...args),
  deleteClassCascade: (...args: any[]) => deleteClassCascade(...args),
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({}),
}))

function makeReq(opts: { method: 'GET' | 'POST'; query?: any; body?: any }): VercelRequest {
  return { method: opts.method, query: opts.query || {}, body: opts.body || {}, headers: { authorization: 'Bearer tok' } } as any
}

function makeRes(): VercelResponse & { statusCode?: number; body?: any } {
  const res: any = {}
  res.status = vi.fn((code: number) => { res.statusCode = code; return res })
  res.json = vi.fn((body: any) => { res.body = body; return res })
  return res
}

let handler: typeof import('./delete-class').default

beforeEach(async () => {
  vi.resetModules()
  handler = (await import('./delete-class')).default
  computeClassImpact.mockClear()
  deleteClassCascade.mockClear()
  deleteCascadeError = null
  classImpact = { classId: 'class-1', className: 'Beginners Welsh', classCount: 1, sessionCount: 0, learnerCount: 4, teacherCount: 1, hasRealActivity: false }
})

describe('DELETE class via /api/school/delete-class', () => {
  it('REJECTS a caller whose scope does not include the target class — 403, no delete happens', async () => {
    authUserId = 'random-authenticated-user'
    scope = { learnerId: 'l-other', role: 'teacher', classIds: ['some-other-class'], learnerIds: [], studentsByClass: {}, schoolIds: [], groupId: null }
    const res = makeRes()
    await handler(makeReq({ method: 'POST', body: { class_id: 'class-1' } }), res)
    expect(res.statusCode).toBe(403)
    expect(deleteClassCascade).not.toHaveBeenCalled()
  })

  it('the owning teacher (class in their taught scope) can delete their own class', async () => {
    authUserId = 'teacher-x'
    scope = { learnerId: 'l1', role: 'teacher', classIds: ['class-1'], learnerIds: [], studentsByClass: {}, schoolIds: [], groupId: null }
    const res = makeRes()
    await handler(makeReq({ method: 'POST', body: { class_id: 'class-1' } }), res)
    expect(res.statusCode).toBe(200)
    expect(deleteClassCascade).toHaveBeenCalledWith(expect.anything(), 'class-1')
  })

  it('a school_admin whose scope includes the class (via their school) can delete it', async () => {
    authUserId = 'admin-a'
    scope = { learnerId: 'l2', role: 'school_admin', classIds: ['class-1'], learnerIds: [], studentsByClass: {}, schoolIds: ['school-1'], groupId: null }
    const res = makeRes()
    await handler(makeReq({ method: 'POST', body: { class_id: 'class-1' } }), res)
    expect(res.statusCode).toBe(200)
    expect(deleteClassCascade).toHaveBeenCalled()
  })

  it('a govt_admin whose subtree includes the class can delete it', async () => {
    authUserId = 'govt-a'
    scope = { learnerId: 'l3', role: 'govt_admin', classIds: ['class-1'], learnerIds: [], studentsByClass: {}, schoolIds: ['school-1'], groupId: 'group-1' }
    const res = makeRes()
    await handler(makeReq({ method: 'POST', body: { class_id: 'class-1' } }), res)
    expect(res.statusCode).toBe(200)
    expect(deleteClassCascade).toHaveBeenCalled()
  })

  it('409s a class with real activity when confirm_name is missing — no delete happens', async () => {
    authUserId = 'teacher-x'
    scope = { learnerId: 'l1', role: 'teacher', classIds: ['class-1'], learnerIds: [], studentsByClass: {}, schoolIds: [], groupId: null }
    classImpact = { ...classImpact, hasRealActivity: true, sessionCount: 12 }
    const res = makeRes()
    await handler(makeReq({ method: 'POST', body: { class_id: 'class-1' } }), res)
    expect(res.statusCode).toBe(409)
    expect(res.body.requires_confirm_name).toBe(true)
    expect(deleteClassCascade).not.toHaveBeenCalled()
  })

  it('409s a class with real activity when confirm_name does not match', async () => {
    authUserId = 'teacher-x'
    scope = { learnerId: 'l1', role: 'teacher', classIds: ['class-1'], learnerIds: [], studentsByClass: {}, schoolIds: [], groupId: null }
    classImpact = { ...classImpact, hasRealActivity: true }
    const res = makeRes()
    await handler(makeReq({ method: 'POST', body: { class_id: 'class-1', confirm_name: 'Wrong Name' } }), res)
    expect(res.statusCode).toBe(409)
    expect(deleteClassCascade).not.toHaveBeenCalled()
  })

  it('succeeds for a real-activity class when confirm_name matches exactly', async () => {
    authUserId = 'teacher-x'
    scope = { learnerId: 'l1', role: 'teacher', classIds: ['class-1'], learnerIds: [], studentsByClass: {}, schoolIds: [], groupId: null }
    classImpact = { ...classImpact, hasRealActivity: true }
    const res = makeRes()
    await handler(makeReq({ method: 'POST', body: { class_id: 'class-1', confirm_name: 'Beginners Welsh' } }), res)
    expect(res.statusCode).toBe(200)
    expect(deleteClassCascade).toHaveBeenCalled()
  })

  it('GET returns the impact preview without deleting', async () => {
    authUserId = 'teacher-x'
    scope = { learnerId: 'l1', role: 'teacher', classIds: ['class-1'], learnerIds: [], studentsByClass: {}, schoolIds: [], groupId: null }
    const res = makeRes()
    await handler(makeReq({ method: 'GET', query: { class_id: 'class-1' } }), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.impact.className).toBe('Beginners Welsh')
    expect(deleteClassCascade).not.toHaveBeenCalled()
  })

  it('400s a missing class_id', async () => {
    authUserId = 'teacher-x'
    scope = { learnerId: 'l1', role: 'teacher', classIds: [], learnerIds: [], studentsByClass: {}, schoolIds: [], groupId: null }
    const res = makeRes()
    await handler(makeReq({ method: 'POST', body: {} }), res)
    expect(res.statusCode).toBe(400)
  })

  it('401s an unauthenticated caller', async () => {
    authUserId = undefined as any
    const authMock = await import('../_utils/auth')
    ;(authMock.verifyAuthToken as any).mockResolvedValueOnce({ valid: false, error: 'no token' })
    const res = makeRes()
    await handler(makeReq({ method: 'POST', body: { class_id: 'class-1' } }), res)
    expect(res.statusCode).toBe(401)
  })
})
