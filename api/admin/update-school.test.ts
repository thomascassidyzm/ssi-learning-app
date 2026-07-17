/**
 * Tests for PATCH /api/admin/update-school — server-mediated schools.group_id
 * write, repointed off the direct client update that 403'd once the
 * 2026-07-04 grant-hygiene window revoked authenticated writes on the org
 * tables (see CLAUDE.md RLS section).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-key'

let verifyAdminResult: any
vi.mock('../_utils/auth', () => ({
  verifyAdmin: vi.fn(async () => verifyAdminResult),
}))

let schoolImpact: any
let deleteSchoolCascadeError: Error | null = null
const computeSchoolImpact = vi.fn(async () => {
  if (!schoolImpact) throw new Error('School not found')
  return schoolImpact
})
const deleteSchoolCascade = vi.fn(async () => {
  if (deleteSchoolCascadeError) throw deleteSchoolCascadeError
})
vi.mock('../_utils/schoolGroupDeletion', () => ({
  computeSchoolImpact: (...args: any[]) => computeSchoolImpact(...args),
  deleteSchoolCascade: (...args: any[]) => deleteSchoolCascade(...args),
}))

const auditAdminDelete = vi.fn(async () => {})
vi.mock('../_utils/auditAdminDelete', () => ({
  auditAdminDelete: (...args: any[]) => auditAdminDelete(...args),
}))

let groupRow: any
let updateCalls: any[] = []
let deleteCalls: any[] = []
let deleteError: any = null

function makeChainable(table: string) {
  const builder: any = {
    select: () => builder,
    update: (obj: unknown) => { updateCalls.push({ table, obj }); return builder },
    delete: () => { deleteCalls.push({ table }); return builder },
    eq: () => {
      // .delete().eq(...) resolves the promise chain directly (no .single()).
      if (deleteCalls.length && deleteCalls[deleteCalls.length - 1].table === table) {
        return Promise.resolve({ error: deleteError })
      }
      return builder
    },
    maybeSingle: () => {
      if (table === 'groups') return Promise.resolve({ data: groupRow, error: null })
      return Promise.resolve({ data: null, error: null })
    },
    single: () => {
      if (table === 'schools') {
        const call = updateCalls[updateCalls.length - 1]
        return Promise.resolve({
          data: { id: 'school-1', school_name: 'Ysgol Test', group_id: call?.obj?.group_id ?? null },
          error: null,
        })
      }
      return Promise.resolve({ data: null, error: null })
    },
  }
  return builder
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: (table: string) => makeChainable(table) }),
}))

let handler: typeof import('./update-school').default

function makeReq(body: unknown): VercelRequest {
  return { method: 'PATCH', body, headers: { authorization: 'Bearer tok' } } as any
}

function makeDeleteReq(schoolId: string, confirmName?: string): VercelRequest {
  const query: Record<string, string> = { school_id: schoolId }
  if (confirmName !== undefined) query.confirm_name = confirmName
  return { method: 'DELETE', query, body: {}, headers: { authorization: 'Bearer tok' } } as any
}

function makeRes(): VercelResponse & { statusCode?: number; body?: any } {
  const res: any = {}
  res.status = vi.fn((code: number) => { res.statusCode = code; return res })
  res.json = vi.fn((body: any) => { res.body = body; return res })
  return res
}

beforeEach(async () => {
  updateCalls = []
  deleteCalls = []
  deleteError = null
  groupRow = { id: 'group-1' }
  verifyAdminResult = { userId: 'admin-1' }
  schoolImpact = {
    schoolId: 'school-1',
    schoolName: 'Ysgol Test',
    classCount: 0,
    sessionCount: 0,
    learnerCount: 0,
    teacherCount: 0,
    hasRealActivity: false,
  }
  deleteSchoolCascadeError = null
  computeSchoolImpact.mockClear()
  deleteSchoolCascade.mockClear()
  auditAdminDelete.mockClear()
  handler = (await import('./update-school')).default
})

describe('PATCH /api/admin/update-school', () => {
  it('rejects a non-admin caller', async () => {
    verifyAdminResult = { error: 'Requires SSi admin access', status: 403 }
    const req = makeReq({ school_id: 'school-1', group_id: 'group-1' })
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(403)
    expect(updateCalls.length).toBe(0)
  })

  it('requires school_id', async () => {
    const req = makeReq({ group_id: 'group-1' })
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(400)
    expect(updateCalls.length).toBe(0)
  })

  it('sets the school group_id when the group exists', async () => {
    const req = makeReq({ school_id: 'school-1', group_id: 'group-1' })
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(200)
    expect(updateCalls[0]).toMatchObject({ table: 'schools', obj: { group_id: 'group-1' } })
    expect(res.body.school.group_id).toBe('group-1')
  })

  it('clears the school group_id when group_id is null', async () => {
    const req = makeReq({ school_id: 'school-1', group_id: null })
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(200)
    expect(updateCalls[0]).toMatchObject({ table: 'schools', obj: { group_id: null } })
    expect(res.body.school.group_id).toBe(null)
  })

  it('rejects a nonexistent group', async () => {
    groupRow = null
    const req = makeReq({ school_id: 'school-1', group_id: 'ghost-group' })
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(400)
    expect(updateCalls.length).toBe(0)
  })
})

describe('GET /api/admin/update-school (impact preview)', () => {
  it('rejects a non-admin caller', async () => {
    verifyAdminResult = { error: 'Requires SSi admin access', status: 403 }
    const req = { method: 'GET', query: { school_id: 'school-1' }, headers: { authorization: 'Bearer tok' } } as any
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(403)
  })

  it('returns the computed impact', async () => {
    const req = { method: 'GET', query: { school_id: 'school-1' }, headers: { authorization: 'Bearer tok' } } as any
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(200)
    expect(res.body.impact).toMatchObject({ schoolName: 'Ysgol Test' })
  })
})

describe('DELETE /api/admin/update-school', () => {
  it('rejects a non-admin caller', async () => {
    verifyAdminResult = { error: 'Requires SSi admin access', status: 403 }
    const req = makeDeleteReq('school-1')
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(403)
    expect(deleteSchoolCascade).not.toHaveBeenCalled()
  })

  it('requires school_id', async () => {
    const req = makeDeleteReq('')
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(400)
    expect(deleteSchoolCascade).not.toHaveBeenCalled()
  })

  it('deletes the school and logs an audit row when there is no real activity', async () => {
    const req = makeDeleteReq('school-1')
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(200)
    expect(deleteSchoolCascade).toHaveBeenCalledWith(expect.anything(), 'school-1')
    expect(auditAdminDelete).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventType: 'admin_school_deleted' })
    )
    expect(res.body.success).toBe(true)
  })

  it('surfaces a delete error', async () => {
    deleteSchoolCascadeError = new Error('delete failed')
    const req = makeDeleteReq('school-1')
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(500)
  })

  it('blocks deletion of a school with real activity unless confirm_name matches exactly', async () => {
    schoolImpact.hasRealActivity = true
    const req = makeDeleteReq('school-1')
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(409)
    expect(res.body.requires_confirm_name).toBe(true)
    expect(deleteSchoolCascade).not.toHaveBeenCalled()
  })

  it('proceeds when confirm_name matches the school name exactly', async () => {
    schoolImpact.hasRealActivity = true
    const req = makeDeleteReq('school-1', 'Ysgol Test')
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(200)
    expect(deleteSchoolCascade).toHaveBeenCalledWith(expect.anything(), 'school-1')
  })

  it('rejects a near-miss confirm_name (case/whitespace)', async () => {
    schoolImpact.hasRealActivity = true
    const req = makeDeleteReq('school-1', 'ysgol test')
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(409)
    expect(deleteSchoolCascade).not.toHaveBeenCalled()
  })
})
