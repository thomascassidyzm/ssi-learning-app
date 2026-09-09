/**
 * The gate on DELETE /api/admin/update-school, with the REAL predicate — no
 * resolver mock.
 *
 * update-school.test.ts mocks the caller-resolution wholesale (`vi.fn(async
 * () => ownSchoolId)`), so it can prove the self-serve path WORKS and is
 * structurally blind to WHOM it works for. That blindness is how the defect
 * shipped: the gate resolved the caller's school with a MEMBERSHIP resolver
 * whose user_tags query filters tag_type and removed_at only — never
 * role_in_context — so a plain teacher's SCHOOL: tag shadowed the genuine
 * `admin_user_id` test and any teacher could irreversibly delete their own
 * school.
 *
 * So this file mocks the DATABASE instead of the predicate: a small fake
 * serving real-shaped `schools` and `user_tags` rows, and the real
 * `isSchoolAdminOf` running over them. Against the pre-fix handler the first
 * test returns 200 and calls deleteSchoolCascade.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-key'

const SCHOOL = 'school-1'

let callerUid: string
vi.mock('../_utils/auth', () => ({
  // Never an ssi_admin here — every case in this file is the self-serve branch.
  verifyAdmin: vi.fn(async () => ({ error: 'Requires SSi admin access', status: 403 })),
  verifyAuthToken: vi.fn(async () => ({ valid: true, userId: callerUid })),
}))

const deleteSchoolCascade = vi.fn(async () => {})
vi.mock('../_utils/schoolGroupDeletion', () => ({
  computeSchoolImpact: vi.fn(async () => ({
    schoolId: SCHOOL,
    schoolName: 'Ysgol Test',
    classCount: 3,
    sessionCount: 40,
    learnerCount: 60,
    teacherCount: 4,
    hasRealActivity: false,
  })),
  deleteSchoolCascade: (...args: any[]) => deleteSchoolCascade(...args),
}))
vi.mock('../_utils/auditAdminDelete', () => ({ auditAdminDelete: vi.fn(async () => {}) }))

/** Live-shaped rows the fake serves. Mutated per test. */
let schools: Array<{ id: string; admin_user_id: string | null }>
let userTags: Array<{
  user_id: string
  tag_type: string
  tag_value: string
  role_in_context: string | null
  removed_at: string | null
}>

/** A PostgREST-ish builder: collects .eq()/.is() filters, applies them at the end. */
function makeChainable(table: string) {
  const filters: Array<(row: any) => boolean> = []
  const rows = () => {
    const source: any[] = table === 'schools' ? schools : table === 'user_tags' ? userTags : []
    return source.filter((r) => filters.every((f) => f(r)))
  }
  const builder: any = {
    select: () => builder,
    eq: (col: string, val: unknown) => { filters.push((r) => r[col] === val); return builder },
    is: (col: string, val: unknown) => { filters.push((r) => r[col] === val); return builder },
    in: (col: string, vals: unknown[]) => { filters.push((r) => vals.includes(r[col])); return builder },
    order: () => builder,
    limit: () => builder,
    maybeSingle: () => Promise.resolve({ data: rows()[0] ?? null, error: null }),
    single: () => Promise.resolve({ data: rows()[0] ?? null, error: null }),
    then: (resolve: any) => resolve({ data: rows(), error: null }),
  }
  return builder
}
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: (table: string) => makeChainable(table) }),
}))

let handler: typeof import('./update-school').default

function makeDeleteReq(schoolId: string): VercelRequest {
  return { method: 'DELETE', query: { school_id: schoolId }, body: {}, headers: { authorization: 'Bearer tok' } } as any
}
function makeRes(): VercelResponse & { statusCode?: number; body?: any } {
  const res: any = {}
  res.status = vi.fn((code: number) => { res.statusCode = code; return res })
  res.json = vi.fn((body: any) => { res.body = body; return res })
  return res
}

const tag = (user_id: string, role: string | null, removed_at: string | null = null) => ({
  user_id, tag_type: 'school', tag_value: `SCHOOL:${SCHOOL}`, role_in_context: role, removed_at,
})

beforeEach(async () => {
  deleteSchoolCascade.mockClear()
  schools = [{ id: SCHOOL, admin_user_id: 'founder-uid' }]
  userTags = []
  handler = (await import('./update-school')).default
})

describe('DELETE /api/admin/update-school — authority, not membership', () => {
  it('REFUSES a teacher-role tag holder, and deletes nothing', async () => {
    // The live shape: 100 active teacher SCHOOL: tags on production, written by
    // the ordinary join paths (code/redeem, named-seat, admin/create-staff).
    callerUid = 'teacher-uid'
    userTags = [tag('teacher-uid', 'teacher')]

    const res = makeRes()
    await handler(makeDeleteReq(SCHOOL), res)

    expect(res.statusCode).toBe(403)
    expect(deleteSchoolCascade).not.toHaveBeenCalled()
  })

  it('REFUSES a student-role tag holder', async () => {
    callerUid = 'pupil-uid'
    userTags = [tag('pupil-uid', 'student')]

    const res = makeRes()
    await handler(makeDeleteReq(SCHOOL), res)

    expect(res.statusCode).toBe(403)
    expect(deleteSchoolCascade).not.toHaveBeenCalled()
  })

  it('REFUSES a REMOVED admin — the tag no longer grants what it once did', async () => {
    callerUid = 'ex-admin-uid'
    userTags = [tag('ex-admin-uid', 'admin', '2026-09-01T00:00:00Z')]

    const res = makeRes()
    await handler(makeDeleteReq(SCHOOL), res)

    expect(res.statusCode).toBe(403)
    expect(deleteSchoolCascade).not.toHaveBeenCalled()
  })

  it('ADMITS the founding admin — schools.admin_user_id, no tag at all', async () => {
    callerUid = 'founder-uid'

    const res = makeRes()
    await handler(makeDeleteReq(SCHOOL), res)

    expect(res.statusCode).toBe(200)
    expect(deleteSchoolCascade).toHaveBeenCalledWith(expect.anything(), SCHOOL)
  })

  it('ADMITS a co-admin holding an active admin tag but NOT the pointer', async () => {
    // All six live non-owner admins are exactly this: educational_role
    // school_admin, role_in_context 'admin', a school someone else founded.
    // A naive admin_user_id-only rule would lock every one of them out.
    callerUid = 'co-admin-uid'
    userTags = [tag('co-admin-uid', 'admin')]

    const res = makeRes()
    await handler(makeDeleteReq(SCHOOL), res)

    expect(res.statusCode).toBe(200)
    expect(deleteSchoolCascade).toHaveBeenCalledWith(expect.anything(), SCHOOL)
  })

  it('REFUSES an admin of ANOTHER school — authority is per school, not "which school am I in"', async () => {
    callerUid = 'other-admin-uid'
    schools = [{ id: SCHOOL, admin_user_id: 'founder-uid' }, { id: 'school-2', admin_user_id: 'other-admin-uid' }]
    userTags = [{ user_id: 'other-admin-uid', tag_type: 'school', tag_value: 'SCHOOL:school-2', role_in_context: 'admin', removed_at: null }]

    const res = makeRes()
    await handler(makeDeleteReq(SCHOOL), res)

    expect(res.statusCode).toBe(403)
    expect(deleteSchoolCascade).not.toHaveBeenCalled()
  })
})
