/**
 * Tests for GET /api/school/roster — the server-mediated read that fixes the
 * "school admin sees 0 staff / 0 students" bug (school_summary/user_tags/
 * class_teachers/class_student_progress are RLS-invoker views/tables whose
 * SELECT policy misses a school_admin invite-born via the newer
 * school_admin_join redemption path — a direct client read as that admin's
 * own session silently zeroed every other teacher/student). resolveVisibleScope
 * is mocked — authorization itself is that function's own responsibility/tests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-key'

vi.mock('../_utils/auth', () => ({
  verifyAuthToken: vi.fn(async () => ({ valid: true, userId: 'caller-1' })),
}))

let scope: any
let schoolIdForAdminResult: string | null = null
vi.mock('../_utils/schoolScope', () => ({
  resolveVisibleScope: vi.fn(async () => scope),
  schoolIdForAdmin: vi.fn(async () => schoolIdForAdminResult),
  chunk: (arr: any[], size = 150) => {
    const out = []
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
    return out
  },
}))

let DB: Record<string, any[]>

function makeChainable(table: string) {
  let rows: any[] = [...((DB as any)[table] ?? [])]
  let single = false
  const builder: any = {
    select: () => builder,
    eq: (col: string, val: unknown) => { rows = rows.filter((r) => r[col] === val); return builder },
    in: (col: string, vals: unknown[]) => { rows = rows.filter((r) => vals.includes(r[col])); return builder },
    is: () => builder,
    order: () => builder,
    maybeSingle: () => { single = true; return builder },
    then: (resolve: any) => Promise.resolve({ data: single ? (rows[0] ?? null) : rows, error: null }).then(resolve),
  }
  return builder
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: (table: string) => makeChainable(table) }),
}))

function makeReq(): VercelRequest {
  return { method: 'GET', query: {}, headers: { authorization: 'Bearer tok' } } as any
}

function makeRes(): VercelResponse & { statusCode?: number; body?: any } {
  const res: any = {}
  res.setHeader = vi.fn()
  res.status = vi.fn((code: number) => { res.statusCode = code; return res })
  res.json = vi.fn((body: any) => { res.body = body; return res })
  return res
}

let handler: typeof import('./roster').default

beforeEach(async () => {
  vi.resetModules()
  handler = (await import('./roster')).default
  DB = {
    school_summary: [
      { school_id: 's1', school_name: 'Sunrise', admin_user_id: null, teacher_count: 2, class_count: 3, student_count: 3, total_practice_hours: 3, has_admin: true },
    ],
    classes: [
      { id: 'c1', school_id: 's1', is_active: true },
      { id: 'c2', school_id: 's1', is_active: true },
      { id: 'c3', school_id: 's1', is_active: true },
    ],
    user_tags: [
      { user_id: 'ut1', added_at: '2025-01-01', tag_value: 'SCHOOL:s1', tag_type: 'school', role_in_context: 'teacher', removed_at: null },
      { user_id: 'ut2', added_at: '2025-02-01', tag_value: 'SCHOOL:s1', tag_type: 'school', role_in_context: 'teacher', removed_at: null },
    ],
    class_teachers: [
      { class_id: 'c1', teacher_user_id: 'ut1' },
      { class_id: 'c2', teacher_user_id: 'ut1' },
      { class_id: 'c3', teacher_user_id: 'ut2' },
    ],
    class_student_progress: [
      { class_id: 'c1', student_user_id: 'su1', learner_id: 'sl1', student_name: 'Alice', class_name: 'Welsh', course_code: 'cym', seeds_completed: 10, legos_mastered: 2, total_practice_seconds: 3600, last_active_at: null, joined_class_at: '2025-01-01' },
      { class_id: 'c1', student_user_id: 'su2', learner_id: 'sl2', student_name: 'Bob', class_name: 'Welsh', course_code: 'cym', seeds_completed: 5, legos_mastered: 1, total_practice_seconds: 7200, last_active_at: null, joined_class_at: '2025-01-02' },
      { class_id: 'c3', student_user_id: 'su3', learner_id: 'sl3', student_name: 'Cai', class_name: 'Spanish', course_code: 'spa', seeds_completed: 1, legos_mastered: 0, total_practice_seconds: 1800, last_active_at: null, joined_class_at: '2025-01-03' },
    ],
    learners: [
      { id: 'l1', user_id: 'ut1', display_name: 'Zara Teacher' },
      { id: 'l2', user_id: 'ut2', display_name: 'Alice Teacher' },
    ],
    sessions: [
      { learner_id: 'l1', duration_seconds: 241 },
      { learner_id: 'l1', duration_seconds: 6 },
    ],
  }
  scope = { learnerId: 'l1', role: 'school_admin', classIds: ['c1', 'c2', 'c3'], learnerIds: [], studentsByClass: {}, schoolIds: ['s1'], groupId: null }
  schoolIdForAdminResult = null
})

describe('GET /api/school/roster', () => {
  it('returns the school totals + full teacher/student lists for a school_admin', async () => {
    const req = makeReq()
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(200)
    expect(res.body.school.school_id).toBe('s1')
    expect(res.body.teachers).toHaveLength(2)
    expect(res.body.students).toHaveLength(3)
  })

  it('attributes class/student/hour counts per teacher via the class_teachers relationship', async () => {
    const req = makeReq()
    const res = makeRes()
    await handler(req, res)
    const zara = res.body.teachers.find((t: any) => t.display_name === 'Zara Teacher')
    expect(zara.class_count).toBe(2)
    expect(zara.student_count).toBe(2)
    // (3600 + 7200) / 3600 = 3.0 hours
    expect(zara.total_practice_hours).toBe(3)
  })

  it('reports each teacher\'s OWN practice from their learner\'s sessions (the Chepstow trial-school zero)', async () => {
    const req = makeReq()
    const res = makeRes()
    await handler(req, res)
    const zara = res.body.teachers.find((t: any) => t.display_name === 'Zara Teacher')
    const alice = res.body.teachers.find((t: any) => t.display_name === 'Alice Teacher')
    // (241 + 6) / 60 rounds to 4 minutes — students' class hours must not absorb it
    expect(zara.own_practice_minutes).toBe(4)
    expect(alice.own_practice_minutes).toBe(0)
  })

  it('sorts teachers and students alphabetically', async () => {
    const req = makeReq()
    const res = makeRes()
    await handler(req, res)
    expect(res.body.teachers.map((t: any) => t.display_name)).toEqual(['Alice Teacher', 'Zara Teacher'])
    expect(res.body.students.map((s: any) => s.display_name)).toEqual(['Alice', 'Bob', 'Cai'])
  })

  it('resolves a teacher caller\'s own school via schoolIdForAdmin (resolveVisibleScope leaves teacher schoolIds empty)', async () => {
    scope = { ...scope, role: 'teacher', schoolIds: [] }
    schoolIdForAdminResult = 's1'
    const req = makeReq()
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(200)
    expect(res.body.school.school_id).toBe('s1')
  })

  it('returns an empty roster (not a 500) when the caller has no resolvable school', async () => {
    scope = { ...scope, role: 'teacher', schoolIds: [] }
    schoolIdForAdminResult = null
    const req = makeReq()
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ school: null, teachers: [], students: [] })
  })

  it('403s a govt_admin caller (own-school endpoint, not the group rollup)', async () => {
    scope = { ...scope, role: 'govt_admin', schoolIds: ['s1', 's2'] }
    const req = makeReq()
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(403)
  })

  it('401s an unauthenticated caller', async () => {
    const { verifyAuthToken } = await import('../_utils/auth')
    ;(verifyAuthToken as any).mockResolvedValueOnce({ valid: false, error: 'no token' })
    const req = makeReq()
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(401)
  })

  it('405s a non-GET request', async () => {
    const req = { ...makeReq(), method: 'POST' } as any
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(405)
  })
})
