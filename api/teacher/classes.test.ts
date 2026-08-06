/**
 * Tests for GET / POST /api/teacher/classes.
 *
 * A-74 (co-teaching) adds two behaviours here:
 *   - GET unions the CO-TAUGHT classes (the class_teachers relationship in
 *     user_tags) into the personal list. classes.teacher_user_id is only the
 *     demoted lead pointer, so without the union a co-teacher's own dashboard
 *     is silently empty.
 *   - POST DUAL-WRITES the CLASS:<id>/teacher tag alongside the lead pointer.
 *     Pointer-only creation is how 47 of 62 live classes ended up needing a
 *     backfill; a tag-write failure must surface, never be swallowed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-key'

let authResult: { valid: boolean; userId?: string; error?: string }
vi.mock('../_utils/auth', () => ({
  verifyAuthToken: vi.fn(async () => authResult),
}))

vi.mock('../_utils/classLearnerEntity', () => ({
  ensureClassLearnerEntity: vi.fn(async () => ({ learnerId: 'class-learner-1' })),
}))

let DB: Record<string, any[]>
/** Per-table write failure injection, keyed 'table:op'. */
let failWrites: Record<string, string>
let nextId = 0

function makeChainable(table: string) {
  const filters: Array<(r: any) => boolean> = []
  let op: 'select' | 'update' | 'insert' = 'select'
  let payload: any = null
  let wantCount = false
  let headOnly = false
  let returning: any[] | null = null

  const rows = () => (DB[table] ?? []).filter((r: any) => filters.every((f) => f(r)))

  const runWrite = () => {
    const fail = failWrites[`${table}:${op}`]
    if (fail) return { data: null, error: { message: fail } }
    if (op === 'insert') {
      const list = Array.isArray(payload) ? payload : [payload]
      const made = list.map((r) => ({ id: `${table}-${++nextId}`, removed_at: null, ...r }))
      DB[table] = [...(DB[table] ?? []), ...made]
      returning = made
      return { data: made, error: null }
    }
    const hit = rows()
    for (const r of hit) Object.assign(r, payload)
    returning = hit
    return { data: hit, error: null }
  }

  const builder: any = {
    select: (_cols?: string, opts?: any) => {
      if (opts?.count) wantCount = true
      if (opts?.head) headOnly = true
      return builder
    },
    insert: (v: any) => { op = 'insert'; payload = v; return builder },
    update: (v: any) => { op = 'update'; payload = v; return builder },
    eq: (col: string, val: unknown) => { filters.push((r) => r[col] === val); return builder },
    in: (col: string, vals: unknown[]) => { filters.push((r) => vals.includes(r[col])); return builder },
    is: (col: string) => { filters.push((r) => r[col] == null); return builder },
    order: () => builder,
    limit: () => builder,
    single: async () => {
      if (op !== 'select') {
        const w = runWrite()
        if (w.error) return { data: null, error: w.error }
        return { data: returning![0] ?? null, error: null }
      }
      const r = rows()[0]
      return r ? { data: r, error: null } : { data: null, error: { message: 'not found' } }
    },
    maybeSingle: async () => {
      if (op !== 'select') return runWrite()
      return { data: rows()[0] ?? null, error: null }
    },
    then: (resolve: any) => {
      let result: any
      if (op !== 'select') {
        result = runWrite()
      } else {
        const readFail = failWrites[`${table}:read`]
        if (readFail) result = { data: null, count: null, error: { message: readFail } }
        else if (wantCount) result = { data: headOnly ? null : rows(), count: rows().length, error: null }
        else result = { data: rows(), error: null }
      }
      return Promise.resolve(result).then(resolve)
    },
  }
  return builder
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: (table: string) => makeChainable(table) }),
}))

function makeReq(method: 'GET' | 'POST', body: any = {}): VercelRequest {
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
    class_learner_id: null,
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

let handler: typeof import('./classes').default

beforeEach(async () => {
  vi.resetModules()
  nextId = 0
  failWrites = {}
  handler = (await import('./classes')).default
  authResult = { valid: true, userId: 'teacher-1' }
  DB = {
    learners: [{ id: 'learner-1', user_id: 'teacher-1' }],
    teachers: [{ id: 'teacher-row-1', learner_id: 'learner-1', platform_status: null, platform_expires_at: null }],
    classes: [],
    user_tags: [],
    subscriptions: [],
  }
})

describe('GET /api/teacher/classes', () => {
  it('lists the classes the teacher LEADS', async () => {
    DB.classes = [cls({ id: 'mine-1' })]
    const res = makeRes()
    await handler(makeReq('GET'), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.classes.map((c: any) => c.id)).toEqual(['mine-1'])
  })

  it('UNIONS the co-taught classes (A-74) — the whole point of the fix', async () => {
    DB.classes = [
      cls({ id: 'mine-1' }),
      cls({ id: 'theirs-1', teacher_user_id: 'someone-else' }),
    ]
    DB.user_tags = [classTag('teacher-1', 'theirs-1')]
    const res = makeRes()
    await handler(makeReq('GET'), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.classes.map((c: any) => c.id).sort()).toEqual(['mine-1', 'theirs-1'])
  })

  it('returns the co-taught class even when the teacher leads nothing', async () => {
    DB.classes = [cls({ id: 'theirs-1', teacher_user_id: 'someone-else' })]
    DB.user_tags = [classTag('teacher-1', 'theirs-1')]
    const res = makeRes()
    await handler(makeReq('GET'), res)
    expect(res.body.classes.map((c: any) => c.id)).toEqual(['theirs-1'])
  })

  it('does not duplicate a class the teacher both leads and is tagged on', async () => {
    DB.classes = [cls({ id: 'mine-1' })]
    DB.user_tags = [classTag('teacher-1', 'mine-1')]
    const res = makeRes()
    await handler(makeReq('GET'), res)
    expect(res.body.classes.map((c: any) => c.id)).toEqual(['mine-1'])
  })

  it('ignores a soft-REMOVED co-teacher tag', async () => {
    DB.classes = [cls({ id: 'theirs-1', teacher_user_id: 'someone-else' })]
    DB.user_tags = [classTag('teacher-1', 'theirs-1', '2026-02-01T00:00:00.000Z')]
    const res = makeRes()
    await handler(makeReq('GET'), res)
    expect(res.body.classes).toEqual([])
  })

  it('keeps SCHOOL classes out of the personal surface even when co-taught', async () => {
    DB.classes = [cls({ id: 'school-class', teacher_user_id: 'someone-else', school_id: 'school-1' })]
    DB.user_tags = [classTag('teacher-1', 'school-class')]
    const res = makeRes()
    await handler(makeReq('GET'), res)
    expect(res.body.classes).toEqual([])
  })

  it('excludes an inactive co-taught class', async () => {
    DB.classes = [cls({ id: 'theirs-1', teacher_user_id: 'someone-else', is_active: false })]
    DB.user_tags = [classTag('teacher-1', 'theirs-1')]
    const res = makeRes()
    await handler(makeReq('GET'), res)
    expect(res.body.classes).toEqual([])
  })

  it('500s rather than silently dropping co-taught classes when the tag read fails', async () => {
    failWrites['user_tags:read'] = 'boom'
    DB.classes = [cls({ id: 'mine-1' })]
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

describe('POST /api/teacher/classes', () => {
  const body = { class_name: 'New class', course_code: 'cym_for_eng' }

  it('creates the class AND dual-writes the teacher tag (A-74)', async () => {
    const res = makeRes()
    await handler(makeReq('POST', body), res)
    expect(res.statusCode).toBe(201)
    const created = res.body.class
    expect(created.teacher_user_id).toBe('teacher-1')
    expect(DB.user_tags).toHaveLength(1)
    expect(DB.user_tags[0]).toMatchObject({
      user_id: 'teacher-1',
      tag_type: 'class',
      tag_value: `CLASS:${created.id}`,
      role_in_context: 'teacher',
      removed_at: null,
    })
  })

  it('500s (no false success) when the teacher-tag write fails', async () => {
    failWrites['user_tags:insert'] = 'boom'
    const res = makeRes()
    await handler(makeReq('POST', body), res)
    expect(res.statusCode).toBe(500)
    expect(String(res.body.error)).toMatch(/teacher record failed/i)
  })

  it('reactivates a soft-removed tag rather than inserting a duplicate', async () => {
    // The class id is deterministic in this mock: classes-1 for the first insert.
    DB.user_tags = [
      {
        id: 'old-tag',
        user_id: 'teacher-1',
        tag_type: 'class',
        tag_value: 'CLASS:classes-1',
        role_in_context: 'teacher',
        removed_at: '2026-02-01T00:00:00.000Z',
      },
    ]
    const res = makeRes()
    await handler(makeReq('POST', body), res)
    expect(res.statusCode).toBe(201)
    expect(res.body.class.id).toBe('classes-1')
    expect(DB.user_tags).toHaveLength(1)
    expect(DB.user_tags[0].removed_at).toBeNull()
  })

  it('400s without class_name', async () => {
    const res = makeRes()
    await handler(makeReq('POST', { course_code: 'cym_for_eng' }), res)
    expect(res.statusCode).toBe(400)
  })

  it('400s without course_code', async () => {
    const res = makeRes()
    await handler(makeReq('POST', { class_name: 'x' }), res)
    expect(res.statusCode).toBe(400)
  })

  it('409s at the 10-class cap', async () => {
    DB.classes = Array.from({ length: 10 }, (_, i) => cls({ id: `mine-${i}` }))
    const res = makeRes()
    await handler(makeReq('POST', body), res)
    expect(res.statusCode).toBe(409)
  })

  it('CO-TAUGHT classes do not inflate the cap (S5) — only the ones you lead', async () => {
    DB.classes = [
      ...Array.from({ length: 9 }, (_, i) => cls({ id: `mine-${i}` })),
      ...Array.from({ length: 5 }, (_, i) => cls({ id: `theirs-${i}`, teacher_user_id: 'someone-else' })),
    ]
    DB.user_tags = Array.from({ length: 5 }, (_, i) => classTag('teacher-1', `theirs-${i}`))
    const res = makeRes()
    await handler(makeReq('POST', body), res)
    expect(res.statusCode).toBe(201)
  })

  it('403s when the tutor platform trial has expired', async () => {
    DB.teachers = [{ id: 'teacher-row-1', learner_id: 'learner-1', platform_status: 'expired', platform_expires_at: null }]
    const res = makeRes()
    await handler(makeReq('POST', body), res)
    expect(res.statusCode).toBe(403)
    expect(DB.user_tags).toHaveLength(0)
  })

  it('405s on an unsupported method', async () => {
    const res = makeRes()
    await handler({ method: 'DELETE', body: {}, headers: {} } as any, res)
    expect(res.statusCode).toBe(405)
  })
})
