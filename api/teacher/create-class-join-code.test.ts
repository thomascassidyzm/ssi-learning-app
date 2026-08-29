/**
 * Tests for POST /api/teacher/create-class-join-code. Authorization mirrors
 * create-class-learner.ts: an active teacher of the class — the class_teachers
 * relationship OR the demoted lead pointer — an ssi_admin/god, or the
 * school_admin of the class's school. The co-teacher disjunct is A-74.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-key'

let authResult: { valid: boolean; userId?: string; error?: string }
vi.mock('../_utils/auth', () => ({
  verifyAuthToken: vi.fn(async () => authResult),
}))

let DB: Record<string, any[]>
let insertFailure: string | null = null
const inserts: Array<{ table: string; row: any }> = []

function makeChainable(table: string) {
  let rows: any[] = [...(DB[table] ?? [])]
  const builder: any = {
    select: () => builder,
    insert: async (row: any) => {
      if (insertFailure) return { data: null, error: { message: insertFailure } }
      inserts.push({ table, row })
      DB[table] = [...(DB[table] ?? []), row]
      return { data: null, error: null }
    },
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

function coTeacherTag(userId: string, removedAt: string | null = null) {
  return {
    id: 'tag-1',
    user_id: userId,
    tag_type: 'class',
    tag_value: 'CLASS:class-1',
    role_in_context: 'teacher',
    removed_at: removedAt,
  }
}

let handler: typeof import('./create-class-join-code').default

beforeEach(async () => {
  vi.resetModules()
  inserts.length = 0
  insertFailure = null
  handler = (await import('./create-class-join-code')).default
  authResult = { valid: true, userId: 'teacher-1' }
  DB = {
    classes: [{ id: 'class-1', teacher_user_id: 'teacher-1', school_id: null, student_join_code: 'ABC-123' }],
    learners: [],
    schools: [],
    user_tags: [],
    invite_codes: [],
  }
})

describe('POST /api/teacher/create-class-join-code', () => {
  it('creates the invite_codes row for the class lead', async () => {
    const res = makeRes()
    await handler(makeReq({ class_id: 'class-1' }), res)
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ created: true, code: 'ABC-123' })
    expect(inserts[0].row).toMatchObject({
      code: 'ABC-123',
      code_type: 'student',
      grants_class_id: 'class-1',
      is_active: true,
    })
  })

  it('allows a CO-TEACHER holding an active class/teacher tag (A-74)', async () => {
    authResult = { valid: true, userId: 'co-teacher-1' }
    DB.user_tags = [coTeacherTag('co-teacher-1')]
    const res = makeRes()
    await handler(makeReq({ class_id: 'class-1' }), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.created).toBe(true)
  })

  it('refuses a co-teacher whose tag has been soft-removed', async () => {
    authResult = { valid: true, userId: 'co-teacher-1' }
    DB.user_tags = [coTeacherTag('co-teacher-1', '2026-02-01T00:00:00.000Z')]
    const res = makeRes()
    await handler(makeReq({ class_id: 'class-1' }), res)
    expect(res.statusCode).toBe(403)
    expect(inserts).toHaveLength(0)
  })

  it('refuses a stranger', async () => {
    authResult = { valid: true, userId: 'stranger' }
    const res = makeRes()
    await handler(makeReq({ class_id: 'class-1' }), res)
    expect(res.statusCode).toBe(403)
    expect(inserts).toHaveLength(0)
  })

  it('allows an ssi_admin', async () => {
    authResult = { valid: true, userId: 'admin-1' }
    DB.learners = [{ user_id: 'admin-1', platform_role: 'ssi_admin', educational_role: null }]
    const res = makeRes()
    await handler(makeReq({ class_id: 'class-1' }), res)
    expect(res.statusCode).toBe(200)
  })

  it("allows the school_admin of the class's school", async () => {
    DB.classes[0].school_id = 'school-1'
    DB.classes[0].teacher_user_id = 'other-teacher'
    DB.schools = [{ id: 'school-1', admin_user_id: 'admin-1' }]
    authResult = { valid: true, userId: 'admin-1' }
    const res = makeRes()
    await handler(makeReq({ class_id: 'class-1' }), res)
    expect(res.statusCode).toBe(200)
  })

  // TENANCY-08: an admin under the TAG spelling (every admin after the founder)
  // is the same principal as the founding pointer, and must get the same verb.
  it("allows a tag-spelled school admin of the class's school (TENANCY-08)", async () => {
    DB.classes[0].school_id = 'school-1'
    DB.classes[0].teacher_user_id = 'other-teacher'
    DB.schools = [{ id: 'school-1', admin_user_id: 'founder-1' }]
    DB.user_tags = [{
      id: 'tag-admin-1',
      user_id: 'admin-2',
      tag_type: 'school',
      tag_value: 'SCHOOL:school-1',
      role_in_context: 'admin',
      removed_at: null,
    }]
    authResult = { valid: true, userId: 'admin-2' }
    const res = makeRes()
    await handler(makeReq({ class_id: 'class-1' }), res)
    expect(res.statusCode).toBe(200)
  })

  it('still refuses a tag-spelled admin of a DIFFERENT school', async () => {
    DB.classes[0].school_id = 'school-1'
    DB.classes[0].teacher_user_id = 'other-teacher'
    DB.schools = [{ id: 'school-1', admin_user_id: 'founder-1' }]
    DB.user_tags = [{
      id: 'tag-admin-2',
      user_id: 'admin-3',
      tag_type: 'school',
      tag_value: 'SCHOOL:school-2',
      role_in_context: 'admin',
      removed_at: null,
    }]
    authResult = { valid: true, userId: 'admin-3' }
    const res = makeRes()
    await handler(makeReq({ class_id: 'class-1' }), res)
    expect(res.statusCode).toBe(403)
    expect(inserts).toHaveLength(0)
  })

  it('is idempotent when the code row already exists', async () => {
    DB.invite_codes = [{ code: 'ABC-123' }]
    const res = makeRes()
    await handler(makeReq({ class_id: 'class-1' }), res)
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ created: false, code: 'ABC-123' })
    expect(inserts).toHaveLength(0)
  })

  it('404s when the class does not exist', async () => {
    const res = makeRes()
    await handler(makeReq({ class_id: 'nope' }), res)
    expect(res.statusCode).toBe(404)
  })

  it('400s when the class has no student_join_code', async () => {
    DB.classes[0].student_join_code = null
    const res = makeRes()
    await handler(makeReq({ class_id: 'class-1' }), res)
    expect(res.statusCode).toBe(400)
  })

  it('400s without class_id', async () => {
    const res = makeRes()
    await handler(makeReq({}), res)
    expect(res.statusCode).toBe(400)
  })

  it('401s without a valid token', async () => {
    authResult = { valid: false, error: 'no token' }
    const res = makeRes()
    await handler(makeReq({ class_id: 'class-1' }), res)
    expect(res.statusCode).toBe(401)
  })

  it('rejects an admin write attempted while viewing-as', async () => {
    authResult = { valid: true, userId: 'admin-1' }
    DB.learners = [{ user_id: 'admin-1', platform_role: 'ssi_admin', educational_role: null }]
    DB.classes[0].teacher_user_id = 'other-teacher'
    const res = makeRes()
    await handler(makeReq({ class_id: 'class-1' }, { 'x-ssi-view-as': '1' }), res)
    expect(res.statusCode).toBe(403)
    expect(inserts).toHaveLength(0)
  })

  it('500s (never a false success) when the insert fails', async () => {
    insertFailure = 'boom'
    const res = makeRes()
    await handler(makeReq({ class_id: 'class-1' }), res)
    expect(res.statusCode).toBe(500)
  })

  it('405s on a non-POST method', async () => {
    const res = makeRes()
    await handler({ method: 'GET', body: {}, headers: {} } as any, res)
    expect(res.statusCode).toBe(405)
  })
})
