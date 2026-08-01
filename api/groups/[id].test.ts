/**
 * Tests for PATCH /api/groups/:id — region-tier slice 2 leader-rename rule
 * (region-tier-design.md §1d): a non-ssi_admin govt_admin may rename ONLY
 * their own group (name-only), server-derived ownership check. The critical
 * case is a wrong-group caller being rejected.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

process.env.SUPABASE_URL = 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'

let verifyAdminResult: any
let verifyAuthTokenResult: any
vi.mock('../_utils/auth', () => ({
  verifyAdmin: vi.fn(async () => verifyAdminResult),
  verifyAuthToken: vi.fn(async () => verifyAuthTokenResult),
}))

let groupImpact: any
let deleteGroupCascadeError: Error | null = null
const computeGroupImpact = vi.fn(async () => {
  if (!groupImpact) throw new Error('Group not found')
  return groupImpact
})
const deleteGroupCascade = vi.fn(async () => {
  if (deleteGroupCascadeError) throw deleteGroupCascadeError
})
vi.mock('../_utils/schoolGroupDeletion', () => ({
  computeGroupImpact: (...args: any[]) => computeGroupImpact(...args),
  deleteGroupCascade: (...args: any[]) => deleteGroupCascade(...args),
}))

const auditAdminDelete = vi.fn(async () => {})
vi.mock('../_utils/auditAdminDelete', () => ({
  auditAdminDelete: (...args: any[]) => auditAdminDelete(...args),
}))

let govtAdminRow: any
let updateCalls: any[] = []
let deleteCalls: any[] = []
let ungroupSchoolsError: any = null
let deleteGroupError: any = null
// Path-prefix fixture for isStrictDescendantGroup: group-2 is a real
// sub-group of group-1 (path "1.2" starts with "1"); group-3 is unrelated.
let groupPaths: Record<string, string> = { 'group-1': '1', 'group-2': '1.2', 'group-3': '9' }

function makeChainable(table: string) {
  let eqVal: unknown
  const builder: any = {
    select: () => builder,
    update: (obj: unknown) => { updateCalls.push({ table, obj }); return builder },
    delete: () => { deleteCalls.push({ table }); return builder },
    eq: (_col: string, val: unknown) => { eqVal = val; return builder },
    maybeSingle: () => {
      if (table === 'govt_admins') return Promise.resolve({ data: govtAdminRow, error: null })
      if (table === 'groups') {
        const path = groupPaths[eqVal as string]
        return Promise.resolve({ data: path ? { path } : null, error: null })
      }
      return Promise.resolve({ data: null, error: null })
    },
    single: () => Promise.resolve({ data: { id: 'group-1', name: 'Updated Name' }, error: null }),
    // DELETE handler awaits `.eq()` directly with no terminal .single() —
    // makes the builder itself thenable, resolving per-table for that path.
    then: (resolve: any) => {
      if (table === 'schools' && updateCalls.some(c => c.table === 'schools')) {
        return resolve({ data: null, error: ungroupSchoolsError })
      }
      if (table === 'groups' && deleteCalls.some(c => c.table === 'groups')) {
        return resolve({ data: null, error: deleteGroupError })
      }
      return resolve({ data: null, error: null })
    },
  }
  return builder
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: (table: string) => makeChainable(table) }),
}))

import handler from './[id]'

function makeReq(method: string, body: unknown, groupId = 'group-1', confirmName?: string): VercelRequest {
  const query: Record<string, string> = { id: groupId }
  if (confirmName !== undefined) query.confirm_name = confirmName
  return { method, body, query, headers: { authorization: 'Bearer tok' } } as any
}

function makeRes(): VercelResponse & { statusCode?: number; body?: any } {
  const res: any = {}
  res.status = vi.fn((code: number) => { res.statusCode = code; return res })
  res.json = vi.fn((body: any) => { res.body = body; return res })
  return res
}

beforeEach(() => {
  updateCalls = []
  deleteCalls = []
  ungroupSchoolsError = null
  deleteGroupError = null
  govtAdminRow = null
  groupPaths = { 'group-1': '1', 'group-2': '1.2', 'group-3': '9' }
  verifyAdminResult = { error: 'Requires SSi admin access', status: 403 }
  verifyAuthTokenResult = { valid: true, userId: 'leader-1' }
  groupImpact = {
    groupId: 'group-1',
    groupName: 'Gwynedd Ed Test',
    schoolCount: 2,
    schoolNames: ['School A', 'School B'],
    classCount: 0,
    sessionCount: 0,
    learnerCount: 0,
    teacherCount: 0,
    hasRealActivity: false,
  }
  deleteGroupCascadeError = null
  computeGroupImpact.mockClear()
  deleteGroupCascade.mockClear()
  auditAdminDelete.mockClear()
})

describe('PATCH /api/groups/:id', () => {
  it('ssi_admin can rename/re-type/re-parent any group', async () => {
    verifyAdminResult = { userId: 'admin-1' }
    const req = makeReq('PATCH', { name: 'Wales', type: 'nation', parent_id: null })
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(200)
    expect(updateCalls[0].obj).toMatchObject({ name: 'Wales', type: 'nation', parent_id: null, name_confirmed: true })
  })

  it('a govt_admin renaming THEIR OWN group succeeds (name-only)', async () => {
    govtAdminRow = { group_id: 'group-1' }
    const req = makeReq('PATCH', { name: 'Gwynedd Education Authority' }, 'group-1')
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(200)
    expect(updateCalls[0].obj).toMatchObject({ name: 'Gwynedd Education Authority', name_confirmed: true })
  })

  it('a govt_admin renaming a DESCENDANT sub-group succeeds (leader subtree authority, 2026-08-01)', async () => {
    // group-2's path ("1.2") is a strict descendant of group-1's ("1").
    govtAdminRow = { group_id: 'group-1' }
    const req = makeReq('PATCH', { name: 'Ward 1' }, 'group-2')
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(200)
    expect(updateCalls[0].obj).toMatchObject({ name: 'Ward 1', name_confirmed: true })
  })

  it('rejects a govt_admin renaming a DIFFERENT group (wrong-group caller — the critical case)', async () => {
    govtAdminRow = { group_id: 'some-other-group' }
    const req = makeReq('PATCH', { name: 'Hijacked Name' }, 'group-1')
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(403)
    expect(updateCalls.length).toBe(0)
  })

  it('rejects a govt_admin with no group at all', async () => {
    govtAdminRow = null
    const req = makeReq('PATCH', { name: 'Whatever' }, 'group-1')
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(403)
    expect(updateCalls.length).toBe(0)
  })

  it('rejects a non-admin govt_admin trying to change type or parent_id', async () => {
    govtAdminRow = { group_id: 'group-1' }
    const req = makeReq('PATCH', { name: 'Fine', type: 'nation' }, 'group-1')
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(403)
    expect(updateCalls.length).toBe(0)
  })

  it('401s an unauthenticated caller (not ssi_admin, no valid token)', async () => {
    verifyAuthTokenResult = { valid: false, error: 'Missing or invalid Authorization header' }
    const req = makeReq('PATCH', { name: 'Whatever' }, 'group-1')
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(401)
  })

  it('rejects re-parenting a group as its own parent (cycle check)', async () => {
    verifyAdminResult = { userId: 'admin-1' }
    const req = makeReq('PATCH', { parent_id: 'group-1' }, 'group-1')
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(400)
    expect(updateCalls.length).toBe(0)
  })

  it('rejects re-parenting a group under its own descendant (cycle check)', async () => {
    verifyAdminResult = { userId: 'admin-1' }
    // group-2's path ("1.2") is a strict descendant of group-1's ("1").
    const req = makeReq('PATCH', { parent_id: 'group-2' }, 'group-1')
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(400)
    expect(updateCalls.length).toBe(0)
  })

  it('allows re-parenting under an unrelated group', async () => {
    verifyAdminResult = { userId: 'admin-1' }
    const req = makeReq('PATCH', { parent_id: 'group-3' }, 'group-1')
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(200)
    expect(updateCalls[0].obj).toMatchObject({ parent_id: 'group-3' })
  })
})

describe('GET /api/groups/:id (impact preview)', () => {
  it('rejects a caller who is neither admin nor a leader of an ancestor group', async () => {
    const req = makeReq('GET', {}, 'group-1')
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(403)
  })

  it('401s an unauthenticated non-admin caller', async () => {
    verifyAuthTokenResult = { valid: false, error: 'no token' }
    const req = makeReq('GET', {}, 'group-1')
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(401)
  })

  it('returns the computed impact', async () => {
    verifyAdminResult = { userId: 'admin-1' }
    const req = makeReq('GET', {}, 'group-1')
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(200)
    expect(res.body.impact).toMatchObject({ groupName: 'Gwynedd Ed Test', schoolCount: 2 })
  })

  it('a leader of an ANCESTOR group can preview one of their own sub-groups', async () => {
    govtAdminRow = { group_id: 'group-1' }
    const req = makeReq('GET', {}, 'group-2')
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(200)
  })
})

describe('DELETE /api/groups/:id', () => {
  it('rejects a caller who is neither admin nor a leader of an ancestor group', async () => {
    const req = makeReq('DELETE', {}, 'group-1')
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(403)
    expect(deleteGroupCascade).not.toHaveBeenCalled()
  })

  it('401s an unauthenticated non-admin caller', async () => {
    verifyAuthTokenResult = { valid: false, error: 'no token' }
    const req = makeReq('DELETE', {}, 'group-1')
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(401)
    expect(deleteGroupCascade).not.toHaveBeenCalled()
  })

  it('a leader of an ANCESTOR group can delete one of their own SUB-groups', async () => {
    govtAdminRow = { group_id: 'group-1' }
    const req = makeReq('DELETE', {}, 'group-2')
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(200)
    expect(deleteGroupCascade).toHaveBeenCalledWith(expect.anything(), 'group-2')
    expect(auditAdminDelete).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ actorUserId: 'leader-1' })
    )
  })

  it('a leader CANNOT delete their OWN governed group (not a sub-group of itself)', async () => {
    govtAdminRow = { group_id: 'group-1' }
    const req = makeReq('DELETE', {}, 'group-1')
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(403)
    expect(deleteGroupCascade).not.toHaveBeenCalled()
  })

  it('a leader CANNOT delete an unrelated group outside their subtree', async () => {
    govtAdminRow = { group_id: 'group-1' }
    const req = makeReq('DELETE', {}, 'group-3')
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(403)
    expect(deleteGroupCascade).not.toHaveBeenCalled()
  })

  it('deletes the group and logs an audit row when there is no real activity', async () => {
    verifyAdminResult = { userId: 'admin-1' }
    const req = makeReq('DELETE', {}, 'group-1')
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(200)
    expect(deleteGroupCascade).toHaveBeenCalledWith(expect.anything(), 'group-1')
    expect(auditAdminDelete).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventType: 'admin_group_deleted' })
    )
    expect(res.body.deleted).toBe(true)
  })

  it('surfaces a group-delete failure', async () => {
    verifyAdminResult = { userId: 'admin-1' }
    deleteGroupCascadeError = new Error('delete failed')
    const req = makeReq('DELETE', {}, 'group-1')
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(500)
  })

  it('blocks deletion of a group with real activity unless confirm_name matches exactly', async () => {
    verifyAdminResult = { userId: 'admin-1' }
    groupImpact.hasRealActivity = true
    const req = makeReq('DELETE', {}, 'group-1')
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(409)
    expect(res.body.requires_confirm_name).toBe(true)
    expect(deleteGroupCascade).not.toHaveBeenCalled()
  })

  it('proceeds when confirm_name matches the group name exactly', async () => {
    verifyAdminResult = { userId: 'admin-1' }
    groupImpact.hasRealActivity = true
    const req = makeReq('DELETE', {}, 'group-1', 'Gwynedd Ed Test')
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(200)
    expect(deleteGroupCascade).toHaveBeenCalledWith(expect.anything(), 'group-1')
  })
})
