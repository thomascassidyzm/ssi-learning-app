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
// Tree fixture. group-2 is a real sub-group of group-1 (isStrictDescendantGroup
// walks parent_id since 2026-08-06); group-3 is an unrelated root.
interface GroupRow { id: string; name: string; parent_id: string | null; created_at: string; path: string }
const baseGroups = (): GroupRow[] => [
  { id: 'group-1', name: 'Deborah Testing', parent_id: null, created_at: '2026-08-01T09:00:00Z', path: '1' },
  { id: 'group-2', name: 'Ward 1', parent_id: 'group-1', created_at: '2026-08-02T09:00:00Z', path: '1.2' },
  { id: 'group-3', name: 'Other Org', parent_id: null, created_at: '2026-08-03T09:00:00Z', path: '9' },
]
let groupRows: GroupRow[] = baseGroups()
// Fail-open switches: the row read behind the duplicate check, and the
// sibling lookup itself.
let currentRowError: any = null
let siblingLookupError: any = null

function makeChainable(table: string) {
  const filters: Array<{ col: string; val: unknown }> = []
  const builder: any = {
    select: () => builder,
    update: (obj: unknown) => { updateCalls.push({ table, obj }); return builder },
    delete: () => { deleteCalls.push({ table }); return builder },
    eq: (col: string, val: unknown) => { filters.push({ col, val }); return builder },
    is: (col: string, val: unknown) => { filters.push({ col, val }); return builder },
    maybeSingle: () => {
      if (table === 'govt_admins') return Promise.resolve({ data: govtAdminRow, error: null })
      if (table === 'groups') {
        // The PATCH duplicate check's own-row read (id, name, parent_id).
        if (currentRowError) return Promise.resolve({ data: null, error: currentRowError })
        const id = filters.find(f => f.col === 'id')?.val
        const row = groupRows.find(g => g.id === id) || null
        return Promise.resolve({ data: row, error: null })
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
      if (table === 'groups') {
        const parentFilter = filters.find(f => f.col === 'parent_id')
        // Filtered on parent_id = findSiblingSlugCollisions' sibling lookup.
        if (parentFilter) {
          if (siblingLookupError) return resolve({ data: null, error: siblingLookupError })
          const want = parentFilter.val === null ? null : parentFilter.val
          return resolve({ data: groupRows.filter(g => g.parent_id === want), error: null })
        }
        // Unfiltered `groups` read = the forest fetch behind descendantIds.
        if (filters.length === 0) {
          return resolve({ data: groupRows.map(g => ({ id: g.id, parent_id: g.parent_id })), error: null })
        }
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
  groupRows = baseGroups()
  currentRowError = null
  siblingLookupError = null
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

/**
 * Duplicate-name WARNING on rename (2026-08-06) — the same contract POST
 * /api/groups gives at creation: 409 `duplicate_name`, nothing written, and
 * the same request re-sent with confirm_duplicate: true goes through.
 * Deborah made a second "Deborah Testing" and nothing told her; a rename can
 * produce exactly the same ambiguous path.
 */
describe('PATCH /api/groups/:id — duplicate-name warning', () => {
  beforeEach(() => {
    verifyAdminResult = { userId: 'admin-1' }
  })

  it('warns and writes NOTHING when a rename lands on a sibling\'s slug', async () => {
    // group-3 is a root org; renaming it onto root sibling group-1's name.
    const req = makeReq('PATCH', { name: 'Deborah Testing' }, 'group-3')
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(409)
    expect(res.body.code).toBe('duplicate_name')
    expect(res.body.duplicates[0]).toMatchObject({ id: 'group-1', name: 'Deborah Testing' })
    expect(updateCalls.length).toBe(0)
  })

  it('confirm_duplicate: true renames anyway, exactly as before', async () => {
    const req = makeReq('PATCH', { name: 'Deborah Testing', confirm_duplicate: true }, 'group-3')
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(200)
    expect(updateCalls[0].obj).toMatchObject({ name: 'Deborah Testing', name_confirmed: true })
    expect(updateCalls[0].obj.confirm_duplicate).toBeUndefined()
  })

  it('never warns about the row being renamed itself (case/punctuation variants of its OWN name)', async () => {
    for (const name of ['deborah-testing', 'Deborah  Testing', 'DEBORAH_TESTING']) {
      updateCalls = []
      const res = makeRes()
      await handler(makeReq('PATCH', { name }, 'group-1'), res)
      expect(res.statusCode).toBe(200)
      expect(updateCalls.length).toBe(1)
    }
  })

  it('treats every slug-equivalent spelling as the same name, and a different one as different', async () => {
    for (const name of ['Deborah Testing', 'deborah testing', 'Deborah-Testing', 'Deborah_Testing']) {
      const res = makeRes()
      await handler(makeReq('PATCH', { name }, 'group-3'), res)
      expect(res.statusCode, name).toBe(409)
    }
    const res = makeRes()
    await handler(makeReq('PATCH', { name: 'Deborah Testing 2' }, 'group-3'), res)
    expect(res.statusCode).toBe(200)
  })

  it('scopes the check to the SAME PARENT — "Year 7" under two schools is not a clash', async () => {
    groupRows = [
      { id: 'school-a', name: 'School A', parent_id: null, created_at: '2026-08-01T09:00:00Z', path: 'a' },
      { id: 'school-b', name: 'School B', parent_id: null, created_at: '2026-08-01T09:00:00Z', path: 'b' },
      { id: 'a-year7', name: 'Year 7', parent_id: 'school-a', created_at: '2026-08-01T09:00:00Z', path: 'a.year-7' },
      { id: 'b-class', name: 'Form 3', parent_id: 'school-b', created_at: '2026-08-01T09:00:00Z', path: 'b.form-3' },
    ]
    const res = makeRes()
    await handler(makeReq('PATCH', { name: 'Year 7' }, 'b-class'), res)
    expect(res.statusCode).toBe(200)
    expect(updateCalls[0].obj).toMatchObject({ name: 'Year 7' })
  })

  it('warns on a sub-group clash under the same parent, with the full row for an admin', async () => {
    groupRows.push({ id: 'group-4', name: 'Ward 2', parent_id: 'group-1', created_at: '2026-08-04T09:00:00Z', path: '1.4' })
    const res = makeRes()
    await handler(makeReq('PATCH', { name: 'Ward 1' }, 'group-4'), res)
    expect(res.statusCode).toBe(409)
    expect(res.body.error).toContain('a group called "Ward 1"')
    expect(res.body.duplicates[0]).toMatchObject({ id: 'group-2', path: '1.2' })
    expect(updateCalls.length).toBe(0)
  })

  it('redacts a ROOT collision for a non-admin caller — name and date only', async () => {
    verifyAdminResult = { error: 'Requires SSi admin access', status: 403 }
    govtAdminRow = { group_id: 'group-3' }
    const res = makeRes()
    await handler(makeReq('PATCH', { name: 'Deborah Testing' }, 'group-3'), res)
    expect(res.statusCode).toBe(409)
    expect(res.body.duplicates[0]).toEqual({ name: 'Deborah Testing', created_at: '2026-08-01T09:00:00Z' })
    expect(updateCalls.length).toBe(0)
  })

  it('fails open when the sibling lookup errors — the rename goes through, no 500', async () => {
    siblingLookupError = { message: 'lookup exploded' }
    const res = makeRes()
    await handler(makeReq('PATCH', { name: 'Deborah Testing' }, 'group-3'), res)
    expect(res.statusCode).toBe(200)
    expect(updateCalls[0].obj).toMatchObject({ name: 'Deborah Testing' })
  })

  it('fails open when the row read errors — the rename goes through, no 500', async () => {
    currentRowError = { message: 'row read exploded' }
    const res = makeRes()
    await handler(makeReq('PATCH', { name: 'Deborah Testing' }, 'group-3'), res)
    expect(res.statusCode).toBe(200)
    expect(updateCalls[0].obj).toMatchObject({ name: 'Deborah Testing' })
  })

  it('checks the EFFECTIVE parent — a pure re-parent next to a same-named sibling warns', async () => {
    // group-4 is called "Ward 1" under group-3; moving it under group-1 puts it
    // beside the existing "Ward 1" (group-2). No name in the request at all.
    groupRows.push({ id: 'group-4', name: 'Ward 1', parent_id: 'group-3', created_at: '2026-08-04T09:00:00Z', path: '9.4' })
    const res = makeRes()
    await handler(makeReq('PATCH', { parent_id: 'group-1' }, 'group-4'), res)
    expect(res.statusCode).toBe(409)
    expect(res.body.code).toBe('duplicate_name')
    expect(updateCalls.length).toBe(0)

    const res2 = makeRes()
    await handler(makeReq('PATCH', { parent_id: 'group-1', confirm_duplicate: true }, 'group-4'), res2)
    expect(res2.statusCode).toBe(200)
    expect(updateCalls[0].obj).toMatchObject({ parent_id: 'group-1' })
  })

  it('the 403s still fire FIRST — an ungoverned caller never reaches the duplicate check', async () => {
    verifyAdminResult = { error: 'Requires SSi admin access', status: 403 }
    govtAdminRow = { group_id: 'some-other-group' }
    const res = makeRes()
    await handler(makeReq('PATCH', { name: 'Deborah Testing' }, 'group-3'), res)
    expect(res.statusCode).toBe(403)
    expect(res.body.code).toBeUndefined()
    expect(updateCalls.length).toBe(0)
  })

  it('a non-admin changing type/parent is still rejected before any duplicate check', async () => {
    verifyAdminResult = { error: 'Requires SSi admin access', status: 403 }
    govtAdminRow = { group_id: 'group-3' }
    const res = makeRes()
    await handler(makeReq('PATCH', { name: 'Deborah Testing', parent_id: 'group-1' }, 'group-3'), res)
    expect(res.statusCode).toBe(403)
    expect(res.body.error).toBe('Only SSi admins can change group type or parent')
  })

  it('leaves a plain relabel (no name, no parent) alone — no lookup, no warning', async () => {
    const res = makeRes()
    await handler(makeReq('PATCH', { type: 'nation' }, 'group-3'), res)
    expect(res.statusCode).toBe(200)
    expect(updateCalls[0].obj).toMatchObject({ type: 'nation' })
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
