/**
 * Tests for POST /api/teacher/create-class-learner (owner ruling
 * 2026-07-16: class as first-class learner). Mirrors the authorization
 * shape of create-class-join-code.ts: the class's own teacher, an
 * ssi_admin/god, or the school_admin of the class's school.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-key'

let authResult: { valid: boolean; userId?: string; error?: string }
vi.mock('../_utils/auth', () => ({
  verifyAuthToken: vi.fn(async () => authResult),
}))

let ensureResult: any
const ensureSpy = vi.fn(async () => ensureResult)
vi.mock('../_utils/classLearnerEntity', () => ({
  ensureClassLearnerEntity: (...args: any[]) => ensureSpy(...args),
}))

const trialCourseSpy = vi.fn(async () => false)
vi.mock('../_utils/schoolPlatformTrial', () => ({
  ensureSchoolTrialCourse: (...args: any[]) => trialCourseSpy(...(args as [])),
}))

let DB: {
  classes: Array<{ id: string; teacher_user_id: string; school_id: string | null; course_code?: string | null }>
  learners: Array<{ user_id: string; platform_role: string | null; educational_role: string | null }>
  schools: Array<{ id: string; admin_user_id: string | null }>
  user_tags: Array<{
    id: string
    user_id: string
    tag_type: string
    tag_value: string
    role_in_context: string
    removed_at: string | null
  }>
}

function makeChainable(table: string) {
  let rows: any[] = [...((DB as any)[table] ?? [])]
  const builder: any = {
    select: () => builder,
    eq: (col: string, val: unknown) => { rows = rows.filter((r) => r[col] === val); return builder },
    is: (col: string) => { rows = rows.filter((r) => r[col] == null); return builder },
    single: async () => (rows[0] ? { data: rows[0], error: null } : { data: null, error: { message: 'not found' } }),
    maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
  }
  return builder
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: (table: string) => makeChainable(table) }),
}))

function makeReq(body: any, extraHeaders?: Record<string, string>): VercelRequest {
  return { method: 'POST', body, headers: { authorization: 'Bearer tok', ...extraHeaders } } as any
}

function makeRes(): VercelResponse & { statusCode?: number; body?: any } {
  const res: any = {}
  res.status = vi.fn((code: number) => { res.statusCode = code; return res })
  res.json = vi.fn((body: any) => { res.body = body; return res })
  return res
}

let handler: typeof import('./create-class-learner').default

beforeEach(async () => {
  vi.resetModules()
  ensureSpy.mockClear()
  trialCourseSpy.mockClear()
  handler = (await import('./create-class-learner')).default
  authResult = { valid: true, userId: 'teacher-1' }
  ensureResult = { learnerId: 'class-learner-1' }
  DB = {
    classes: [{ id: 'class-1', teacher_user_id: 'teacher-1', school_id: null, course_code: 'cym_s_for_eng' }],
    learners: [],
    schools: [],
    user_tags: [],
  }
})

describe('POST /api/teacher/create-class-learner', () => {
  it('mints the class learner entity when the caller is the class teacher', async () => {
    const req = makeReq({ class_id: 'class-1' })
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ class_learner_id: 'class-learner-1' })
    expect(ensureSpy).toHaveBeenCalledWith(expect.anything(), 'class-1')
  })

  it('rejects a caller who is neither the teacher, an admin, nor the school admin', async () => {
    authResult = { valid: true, userId: 'stranger' }
    const req = makeReq({ class_id: 'class-1' })
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(403)
    expect(ensureSpy).not.toHaveBeenCalled()
  })

  it('allows a CO-TEACHER holding an active class/teacher tag (A-74)', async () => {
    authResult = { valid: true, userId: 'co-teacher-1' }
    DB.user_tags = [{
      id: 'tag-1',
      user_id: 'co-teacher-1',
      tag_type: 'class',
      tag_value: 'CLASS:class-1',
      role_in_context: 'teacher',
      removed_at: null,
    }]
    const req = makeReq({ class_id: 'class-1' })
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(200)
  })

  it('refuses a co-teacher whose tag has been soft-removed', async () => {
    authResult = { valid: true, userId: 'co-teacher-1' }
    DB.user_tags = [{
      id: 'tag-1',
      user_id: 'co-teacher-1',
      tag_type: 'class',
      tag_value: 'CLASS:class-1',
      role_in_context: 'teacher',
      removed_at: '2026-02-01T00:00:00.000Z',
    }]
    const req = makeReq({ class_id: 'class-1' })
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(403)
  })

  it('allows the school_admin of the class\'s school', async () => {
    DB.classes[0] = { id: 'class-1', teacher_user_id: 'other-teacher', school_id: 'school-1' }
    DB.schools = [{ id: 'school-1', admin_user_id: 'admin-1' }]
    authResult = { valid: true, userId: 'admin-1' }
    const req = makeReq({ class_id: 'class-1' })
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(200)
  })

  // B1 (founder report 2026-08-07): an invite-born trial school never recorded
  // the language it was trialling, so its home badge read a bare "Trial". The
  // first class carrying a course is the honest moment to record it.
  it('records the school\'s trial course from the new class\'s course_code', async () => {
    DB.classes[0] = { id: 'class-1', teacher_user_id: 'teacher-1', school_id: 'school-1', course_code: 'cym_s_for_eng' }
    const req = makeReq({ class_id: 'class-1' })
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(200)
    expect(trialCourseSpy).toHaveBeenCalledWith(expect.anything(), 'school-1', 'cym_s_for_eng')
  })

  it('still mints the learner entity when the trial-course write fails open', async () => {
    trialCourseSpy.mockRejectedValueOnce(new Error('trial bookkeeping exploded'))
    const req = makeReq({ class_id: 'class-1' })
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(200)
    expect(ensureSpy).toHaveBeenCalled()
  })

  it('does not attempt a trial-course write for an unauthorized caller', async () => {
    authResult = { valid: true, userId: 'stranger' }
    const req = makeReq({ class_id: 'class-1' })
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(403)
    expect(trialCourseSpy).not.toHaveBeenCalled()
  })

  it('404s when the class does not exist', async () => {
    const req = makeReq({ class_id: 'nope' })
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(404)
  })

  it('401s with no auth token', async () => {
    authResult = { valid: false, error: 'no token' }
    const req = makeReq({ class_id: 'class-1' })
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(401)
  })

  it('surfaces a 500 when ensureClassLearnerEntity fails', async () => {
    ensureResult = { error: 'insert failed' }
    const req = makeReq({ class_id: 'class-1' })
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(500)
  })

  it('rejects an admin write attempted while viewing-as, even though the admin bypass would otherwise allow it', async () => {
    DB.classes[0] = { id: 'class-1', teacher_user_id: 'other-teacher', school_id: null }
    DB.learners = [{ user_id: 'admin-1', platform_role: 'ssi_admin', educational_role: null }]
    authResult = { valid: true, userId: 'admin-1' }
    const req = makeReq({ class_id: 'class-1' }, { 'x-ssi-view-as': '1' })
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(403)
    expect(ensureSpy).not.toHaveBeenCalled()
  })
})
