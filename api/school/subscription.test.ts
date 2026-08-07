/**
 * Tests for GET /api/school/subscription's `school.teacher_count` — the honest
 * joined-staff count the Subscribe page seeds its seat stepper from.
 *
 * The live bug it fixes (Chepstow mirror school, 2026-08-07): the endpoint
 * returned no teacher count at all, so /schools/upgrade opened its stepper at a
 * hard-coded 1 seat for a school with three staff. The count must be right
 * TODAY — i.e. it must include the founding admin (`schools.admin_user_id`),
 * who on six live schools holds no SCHOOL: user_tag — and must not
 * double-count them once that separate backfill lane lands a tag for them.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-key'

let authUserId: string
vi.mock('../_utils/auth', () => ({
  verifyAuthToken: vi.fn(async () => ({ valid: true, userId: authUserId })),
}))

interface Row { [k: string]: unknown }
let DB: Record<string, Row[]>

function makeChainable(table: string) {
  let rows: Row[] = [...(DB[table] ?? [])]
  const builder: any = {
    select() { return builder },
    eq(col: string, val: unknown) { rows = rows.filter((r) => r[col] === val); return builder },
    is(col: string, val: unknown) { rows = rows.filter((r) => (r[col] ?? null) === val); return builder },
    in(col: string, vals: unknown[]) { rows = rows.filter((r) => vals.includes(r[col])); return builder },
    order() { return builder },
    limit(n: number) { rows = rows.slice(0, n); return builder },
    async maybeSingle() { return { data: rows[0] ?? null, error: null } },
    // The array-returning reads (user_tags / classes / class_teachers) are
    // awaited directly, so the builder itself must be thenable.
    then(resolve: (v: { data: Row[]; error: null }) => unknown) {
      return Promise.resolve({ data: rows, error: null }).then(resolve)
    },
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
  res.setHeader = vi.fn(() => res)
  res.end = vi.fn(() => res)
  res.status = vi.fn((code: number) => { res.statusCode = code; return res })
  res.json = vi.fn((body: any) => { res.body = body; return res })
  return res
}

let handler: typeof import('./subscription').default

const SCHOOL = 'school-1'
const ADMIN = 'founding-admin-uid'

function schoolRow(over: Row = {}): Row {
  return {
    id: SCHOOL,
    admin_user_id: ADMIN,
    platform_status: 'trial',
    platform_expires_at: '2099-01-01T00:00:00Z',
    trial_course_code: null,
    trial_kind: null,
    teacher_seats: 1,
    ...over,
  }
}

function teacherTag(userId: string, role = 'teacher'): Row {
  return { user_id: userId, tag_type: 'school', tag_value: `SCHOOL:${SCHOOL}`, role_in_context: role, removed_at: null }
}

beforeEach(async () => {
  vi.resetModules()
  handler = (await import('./subscription')).default
  authUserId = ADMIN
  DB = {
    learners: [{ id: 'learner-admin', user_id: ADMIN, platform_role: null, educational_role: 'school_admin' }],
    schools: [schoolRow()],
    user_tags: [],
    classes: [],
    class_teachers: [],
    teachers: [],
  }
})

async function call() {
  const res = makeRes()
  await handler(makeReq(), res)
  return res
}

describe('GET /api/school/subscription — teacher_count', () => {
  it('counts the founding admin PLUS the tagged teachers (the live Chepstow shape: 2 tags + admin = 3)', async () => {
    DB.user_tags = [teacherTag('teacher-a'), teacherTag('teacher-b')]
    const res = await call()
    expect(res.statusCode).toBe(200)
    expect(res.body.school.id).toBe(SCHOOL)
    // teacher_seats is still the BILLED number — 1 — and must not be conflated
    // with the actual staff count.
    expect(res.body.school.teacher_seats).toBe(1)
    expect(res.body.school.teacher_count).toBe(3)
  })

  it('does NOT double-count the founding admin once the user_tags backfill gives them a tag', async () => {
    DB.user_tags = [teacherTag('teacher-a'), teacherTag('teacher-b'), teacherTag(ADMIN, 'admin')]
    const res = await call()
    expect(res.body.school.teacher_count).toBe(3)
  })

  it('counts a class-only co-teacher who holds no SCHOOL: tag', async () => {
    DB.user_tags = [teacherTag('teacher-a')]
    DB.classes = [{ id: 'class-1', school_id: SCHOOL, is_active: true, teacher_user_id: null }]
    DB.class_teachers = [{ class_id: 'class-1', teacher_user_id: 'supply-teacher' }]
    const res = await call()
    expect(res.body.school.teacher_count).toBe(3) // admin + tagged + supply
  })

  it('ignores removed staff and other schools’ tags', async () => {
    DB.user_tags = [
      teacherTag('teacher-a'),
      { ...teacherTag('teacher-gone'), removed_at: '2026-01-01T00:00:00Z' },
      { user_id: 'other-school-teacher', tag_type: 'school', tag_value: 'SCHOOL:school-2', role_in_context: 'teacher', removed_at: null },
      { user_id: 'a-student', tag_type: 'school', tag_value: `SCHOOL:${SCHOOL}`, role_in_context: 'student', removed_at: null },
    ]
    const res = await call()
    expect(res.body.school.teacher_count).toBe(2) // admin + teacher-a
  })

  it('a lone founding admin with no tags at all counts as 1', async () => {
    const res = await call()
    expect(res.body.school.teacher_count).toBe(1)
  })
})
