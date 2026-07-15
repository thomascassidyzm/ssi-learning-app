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

function makeDeleteReq(schoolId: string): VercelRequest {
  return { method: 'DELETE', query: { school_id: schoolId }, body: {}, headers: { authorization: 'Bearer tok' } } as any
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

describe('DELETE /api/admin/update-school', () => {
  it('rejects a non-admin caller', async () => {
    verifyAdminResult = { error: 'Requires SSi admin access', status: 403 }
    const req = makeDeleteReq('school-1')
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(403)
    expect(deleteCalls.length).toBe(0)
  })

  it('requires school_id', async () => {
    const req = makeDeleteReq('')
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(400)
    expect(deleteCalls.length).toBe(0)
  })

  it('deletes the school', async () => {
    const req = makeDeleteReq('school-1')
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(200)
    expect(deleteCalls[0]).toMatchObject({ table: 'schools' })
    expect(res.body.success).toBe(true)
  })

  it('surfaces a delete error', async () => {
    deleteError = { message: 'delete failed' }
    const req = makeDeleteReq('school-1')
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(500)
  })
})
