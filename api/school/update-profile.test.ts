/**
 * Tests for POST /api/school/update-profile — SECURITY: only a school_admin
 * (schools.admin_user_id, or a user_tags SCHOOL: tag with role_in_context
 * 'admin') may rename the school. A plain teacher's SCHOOL: tag
 * (role_in_context 'teacher') must be rejected (403) and audit-logged, never
 * silently accepted (2026-07-16 teacher-loop audit finding).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-key'

let authUserId: string
vi.mock('../_utils/auth', () => ({
  verifyAuthToken: vi.fn(async () => ({ valid: true, userId: authUserId })),
}))

// The rename has a second home: the school's own node, which is what the
// dashboard heading reads. The sync itself is unit-tested in
// _utils/schoolNodeName.test.ts — here we pin that this endpoint calls it.
const syncNodeSpy = vi.fn(async () => 'node-1')
vi.mock('../_utils/schoolNodeName', () => ({
  syncNodeNameForSchool: (...args: any[]) => syncNodeSpy(...(args as [])),
}))

const auditSpy = vi.fn(async () => {})
vi.mock('../_utils/auditSchoolWriteRejection', () => ({
  auditSchoolWriteRejection: auditSpy,
}))

let DB: {
  schools: Array<{ id: string; admin_user_id: string | null; school_name: string; region_code: string | null; name_confirmed: boolean | null }>
  user_tags: Array<{ user_id: string; tag_type: string; tag_value: string; role_in_context: string | null; removed_at: string | null }>
}

function makeChainable(table: string) {
  let rows: any[] = [...((DB as any)[table] ?? [])]
  let updatePatch: any = null
  const builder: any = {
    select() { return builder },
    eq(col: string, val: unknown) { rows = rows.filter((r) => r[col] === val); return builder },
    is(col: string, val: unknown) { rows = rows.filter((r) => (r[col] ?? null) === val); return builder },
    limit() { return builder },
    order() { return builder },
    update(patch: any) { updatePatch = patch; return builder },
    insert(row: any) { (DB as any)[table]?.push?.(row); return Promise.resolve({ data: row, error: null }) },
    async maybeSingle() {
      return { data: rows[0] ?? null, error: null }
    },
    async single() {
      if (updatePatch) {
        rows.forEach((r) => Object.assign(r, updatePatch))
        return rows[0] ? { data: rows[0], error: null } : { data: null, error: { message: 'not found' } }
      }
      return rows[0] ? { data: rows[0], error: null } : { data: null, error: { message: 'not found' } }
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

let handler: typeof import('./update-profile').default

beforeEach(async () => {
  vi.resetModules()
  auditSpy.mockClear()
  syncNodeSpy.mockClear()
  handler = (await import('./update-profile')).default
  DB = {
    schools: [{ id: 'school-1', admin_user_id: 'admin-a', school_name: 'Old Name', region_code: null, name_confirmed: null }],
    user_tags: [],
  }
})

describe('POST /api/school/update-profile', () => {
  it('allows the schools.admin_user_id owner to rename the school', async () => {
    authUserId = 'admin-a'
    const res = makeRes()
    await handler(makeReq({ school_name: 'New Name' }), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.school.school_name).toBe('New Name')
  })

  it('allows a user_tags admin (role_in_context=admin) to rename the school', async () => {
    authUserId = 'admin-b'
    DB.user_tags.push({ user_id: 'admin-b', tag_type: 'school', tag_value: 'SCHOOL:school-1', role_in_context: 'admin', removed_at: null })
    const res = makeRes()
    await handler(makeReq({ school_name: 'New Name' }), res)
    expect(res.statusCode).toBe(200)
  })

  it('REJECTS a plain teacher (role_in_context=teacher) with 403 and audit-logs the attempt', async () => {
    authUserId = 'teacher-c'
    DB.user_tags.push({ user_id: 'teacher-c', tag_type: 'school', tag_value: 'SCHOOL:school-1', role_in_context: 'teacher', removed_at: null })
    const res = makeRes()
    await handler(makeReq({ school_name: 'Hacked Name' }), res)
    expect(res.statusCode).toBe(403)
    expect(DB.schools[0].school_name).toBe('Old Name') // never written
    expect(auditSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ authUserId: 'teacher-c', schoolId: 'school-1', roleInContext: 'teacher', endpoint: 'school/update-profile' }),
    )
  })

  it('404s an account with no school tag at all (no audit log)', async () => {
    authUserId = 'nobody'
    const res = makeRes()
    await handler(makeReq({ school_name: 'New Name' }), res)
    expect(res.statusCode).toBe(404)
    expect(auditSpy).not.toHaveBeenCalled()
  })

  it('renames the school\'s node too, so the dashboard heading follows', async () => {
    authUserId = 'admin-a'
    await handler(makeReq({ school_name: 'Chepstow School' }), makeRes())
    expect(syncNodeSpy).toHaveBeenCalledWith(expect.anything(), 'school-1', 'Chepstow School')
  })

  it('does not touch any node when the rename was rejected', async () => {
    authUserId = 'teacher-c'
    DB.user_tags.push({ user_id: 'teacher-c', tag_type: 'school', tag_value: 'SCHOOL:school-1', role_in_context: 'teacher', removed_at: null })
    await handler(makeReq({ school_name: 'Hacked Name' }), makeRes())
    expect(syncNodeSpy).not.toHaveBeenCalled()
  })

  it('400s a missing school_name', async () => {
    authUserId = 'admin-a'
    const res = makeRes()
    await handler(makeReq({}), res)
    expect(res.statusCode).toBe(400)
  })
})
