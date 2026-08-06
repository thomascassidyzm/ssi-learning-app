/**
 * Tests for GET / PATCH /api/teacher/me.
 *
 * A-74: GET's class list must UNION the CO-TAUGHT classes (the class_teachers
 * relationship in user_tags). classes.teacher_user_id is only the demoted lead
 * pointer, so a list built from it alone leaves a co-teacher's own dashboard
 * silently empty — the exact failure this endpoint must never produce.
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
let failReads: Record<string, string>
let nextId = 0

function makeChainable(table: string) {
  const filters: Array<(r: any) => boolean> = []
  let op: 'select' | 'update' = 'select'
  let payload: any = null

  const rows = () => (DB[table] ?? []).filter((r: any) => filters.every((f) => f(r)))

  const builder: any = {
    select: () => builder,
    update: (v: any) => { op = 'update'; payload = v; return builder },
    eq: (col: string, val: unknown) => { filters.push((r) => r[col] === val); return builder },
    in: (col: string, vals: unknown[]) => { filters.push((r) => vals.includes(r[col])); return builder },
    is: (col: string) => { filters.push((r) => r[col] == null); return builder },
    order: () => builder,
    single: async () => {
      const hit = rows()
      if (op === 'update') {
        for (const r of hit) Object.assign(r, payload)
        return hit[0] ? { data: hit[0], error: null } : { data: null, error: { message: 'not found' } }
      }
      return hit[0] ? { data: hit[0], error: null } : { data: null, error: { message: 'not found' } }
    },
    maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
    then: (resolve: any) => {
      const fail = failReads[table]
      const result = fail ? { data: null, error: { message: fail } } : { data: rows(), error: null }
      return Promise.resolve(result).then(resolve)
    },
  }
  return builder
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: (table: string) => makeChainable(table) }),
}))

function makeReq(method: 'GET' | 'PATCH', body: any = {}): VercelRequest {
  return { method, body, headers: { authorization: 'Bearer tok' }, query: {} } as any
}

function makeRes(): VercelResponse & { statusCode?: number; body?: any } {
  const res: any = {}
  res.status = vi.fn((code: number) => { res.statusCode = code; return res })
  res.json = vi.fn((body: any) => { res.body = body; return res })
  return res
}

function cls(over: Partial<Record<string, any>> = {}) {
  return {
    id: `class-${++nextId}`,
    class_name: 'A class',
    course_code: 'cym_for_eng',
    student_join_code: 'ABC-123',
    current_seed: 1,
    teacher_user_id: 'teacher-1',
    school_id: null,
    is_active: true,
    created_at: '2026-01-01T00:00:00.000Z',
    ...over,
  }
}

function classTag(userId: string, classId: string, removedAt: string | null = null) {
  return {
    id: `tag-${++nextId}`,
    user_id: userId,
    tag_type: 'class',
    tag_value: `CLASS:${classId}`,
    role_in_context: 'teacher',
    removed_at: removedAt,
  }
}

let handler: typeof import('./me').default

beforeEach(async () => {
  vi.resetModules()
  nextId = 0
  failReads = {}
  handler = (await import('./me')).default
  authResult = { valid: true, userId: 'teacher-1' }
  DB = {
    learners: [{ id: 'learner-1', user_id: 'teacher-1' }],
    teachers: [{ id: 'teacher-row-1', learner_id: 'learner-1', display_name: 'Deborah' }],
    classes: [],
    user_tags: [],
  }
})

describe('GET /api/teacher/me', () => {
  it('returns the teacher and the classes they lead', async () => {
    DB.classes = [cls({ id: 'mine-1' })]
    const res = makeRes()
    await handler(makeReq('GET'), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.teacher.display_name).toBe('Deborah')
    expect(res.body.classes.map((c: any) => c.id)).toEqual(['mine-1'])
  })

  it('UNIONS the co-taught classes (A-74)', async () => {
    DB.classes = [cls({ id: 'mine-1' }), cls({ id: 'theirs-1', teacher_user_id: 'someone-else' })]
    DB.user_tags = [classTag('teacher-1', 'theirs-1')]
    const res = makeRes()
    await handler(makeReq('GET'), res)
    expect(res.body.classes.map((c: any) => c.id).sort()).toEqual(['mine-1', 'theirs-1'])
  })

  it('is not empty for a pure co-teacher who leads nothing', async () => {
    DB.classes = [cls({ id: 'theirs-1', teacher_user_id: 'someone-else' })]
    DB.user_tags = [classTag('teacher-1', 'theirs-1')]
    const res = makeRes()
    await handler(makeReq('GET'), res)
    expect(res.body.classes.map((c: any) => c.id)).toEqual(['theirs-1'])
  })

  it('does not duplicate a class both led and tagged', async () => {
    DB.classes = [cls({ id: 'mine-1' })]
    DB.user_tags = [classTag('teacher-1', 'mine-1')]
    const res = makeRes()
    await handler(makeReq('GET'), res)
    expect(res.body.classes.map((c: any) => c.id)).toEqual(['mine-1'])
  })

  it('ignores a soft-removed co-teacher tag', async () => {
    DB.classes = [cls({ id: 'theirs-1', teacher_user_id: 'someone-else' })]
    DB.user_tags = [classTag('teacher-1', 'theirs-1', '2026-02-01T00:00:00.000Z')]
    const res = makeRes()
    await handler(makeReq('GET'), res)
    expect(res.body.classes).toEqual([])
  })

  it('keeps SCHOOL classes off the personal surface even when co-taught', async () => {
    DB.classes = [cls({ id: 'school-class', teacher_user_id: 'other', school_id: 'school-1' })]
    DB.user_tags = [classTag('teacher-1', 'school-class')]
    const res = makeRes()
    await handler(makeReq('GET'), res)
    expect(res.body.classes).toEqual([])
  })

  it('500s rather than silently dropping co-taught classes on a read error', async () => {
    failReads.user_tags = 'boom'
    const res = makeRes()
    await handler(makeReq('GET'), res)
    expect(res.statusCode).toBe(500)
  })

  it('404s for a non-teacher', async () => {
    DB.teachers = []
    const res = makeRes()
    await handler(makeReq('GET'), res)
    expect(res.statusCode).toBe(404)
  })

  it('401s without a valid token', async () => {
    authResult = { valid: false, error: 'no token' }
    const res = makeRes()
    await handler(makeReq('GET'), res)
    expect(res.statusCode).toBe(401)
  })
})

describe('PATCH /api/teacher/me', () => {
  it('updates an editable field', async () => {
    const res = makeRes()
    await handler(makeReq('PATCH', { display_name: 'Deb' }), res)
    expect(res.statusCode).toBe(200)
    expect(DB.teachers[0].display_name).toBe('Deb')
  })

  it('ignores non-editable fields and 400s when nothing editable is sent', async () => {
    const res = makeRes()
    await handler(makeReq('PATCH', { learner_id: 'hijack' }), res)
    expect(res.statusCode).toBe(400)
    expect(DB.teachers[0].learner_id).toBe('learner-1')
  })

  it('400s on an empty display_name', async () => {
    const res = makeRes()
    await handler(makeReq('PATCH', { display_name: '  ' }), res)
    expect(res.statusCode).toBe(400)
  })

  it('400s when teaching_languages is not an array', async () => {
    const res = makeRes()
    await handler(makeReq('PATCH', { teaching_languages: 'cym' }), res)
    expect(res.statusCode).toBe(400)
  })

  it('405s on an unsupported method', async () => {
    const res = makeRes()
    await handler({ method: 'DELETE', body: {}, headers: {} } as any, res)
    expect(res.statusCode).toBe(405)
  })
})
