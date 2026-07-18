/**
 * Tests for POST /api/groups/:id/demo-mint (THE-MODEL §1.6/§1.7 — demo-mint
 * at the node: create a demo group + mint the leader invite in one gesture).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-key'

let verifyAdminResult: any
let verifyAuthTokenResult: any
vi.mock('../../_utils/auth', () => ({
  verifyAdmin: vi.fn(async () => verifyAdminResult),
  verifyAuthToken: vi.fn(async () => verifyAuthTokenResult),
}))

let groupPaths: Record<string, string> = { 'node-1': '1', 'node-1a': '1.2', 'node-2': '9' }
let govtAdminRow: any

let ensureDemoLeafClassResult: any
let ensureDemoLeafClassError: string | null
const ensureDemoLeafClassMock = vi.fn(async () => {
  if (ensureDemoLeafClassError) return { error: ensureDemoLeafClassError }
  return ensureDemoLeafClassResult
})
let resolvedCourseCode: string | null
const resolveDemoOrgCourseCodeMock = vi.fn(async () => resolvedCourseCode)
vi.mock('../../_utils/demoLeaf', () => ({
  ensureDemoLeafClass: (...args: any[]) => ensureDemoLeafClassMock(...args),
  resolveDemoOrgCourseCode: (...args: any[]) => resolveDemoOrgCourseCodeMock(...args),
}))

vi.mock('../../_utils/codeGen', () => ({
  generateCode: vi.fn(() => 'ABC-123'),
}))

const isStrictDescendantGroupMock = vi.fn(async (_svc: any, ancestorId: string, targetId: string) => {
  const ancestorPath = groupPaths[ancestorId]
  const targetPath = groupPaths[targetId]
  if (!ancestorPath || !targetPath) return false
  return targetPath !== ancestorPath && targetPath.startsWith(ancestorPath)
})
vi.mock('../../_utils/schoolScope', () => ({
  isStrictDescendantGroup: (...args: any[]) => isStrictDescendantGroupMock(...args),
}))

let insertedGroups: any[]
let insertedInvites: any[]
let insertedDemoOrgs: any[]
let insertedEvents: any[]
let deletedFrom: { table: string; id: unknown }[]
let existingInviteCodes: string[]
let hiddenSchoolId: string | null

function makeQueryBuilder(table: string) {
  const builder: any = {}
  const methods = ['select', 'gte', 'lte', 'in', 'contains', 'order']
  for (const m of methods) builder[m] = vi.fn(() => builder)
  let eqCol = ''
  let eqVal: unknown
  builder.eq = vi.fn((col: string, val: unknown) => { eqCol = col; eqVal = val; return builder })

  builder.maybeSingle = vi.fn(async () => {
    if (table === 'govt_admins') return { data: govtAdminRow, error: null }
    if (table === 'groups' && eqCol === 'id') {
      const path = groupPaths[eqVal as string]
      return { data: path ? { id: eqVal, path } : null, error: null }
    }
    if (table === 'invite_codes' && eqCol === 'code') {
      return { data: existingInviteCodes.includes(eqVal as string) ? { id: 'dup' } : null, error: null }
    }
    if (table === 'schools' && eqCol === 'group_id') {
      return { data: hiddenSchoolId ? { id: hiddenSchoolId } : null, error: null }
    }
    return { data: null, error: null }
  })

  builder.insert = vi.fn((rows: any) => {
    const row = Array.isArray(rows) ? rows[0] : rows
    if (table === 'groups') insertedGroups.push(row)
    if (table === 'invite_codes') insertedInvites.push(row)
    if (table === 'demo_orgs') insertedDemoOrgs.push(row)
    if (table === 'player_events') insertedEvents.push(row)
    return builder
  })

  builder.single = vi.fn(async () => {
    if (table === 'groups') return { data: { id: 'new-group-1' }, error: null }
    if (table === 'invite_codes') return { data: { id: 'invite-1', code: 'ABC-123' }, error: null }
    if (table === 'demo_orgs') return { data: { id: 'demo-org-1' }, error: null }
    return { data: null, error: null }
  })

  builder.delete = vi.fn(() => {
    return { eq: vi.fn((_col: string, val: unknown) => { deletedFrom.push({ table, id: val }); return Promise.resolve({ data: null, error: null }) }) }
  })

  builder.then = (resolve: any) => resolve({ data: null, error: null })
  return builder
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: (table: string) => makeQueryBuilder(table) }),
}))

import handler from './demo-mint'

function makeReq(body: unknown, groupId = 'node-1'): VercelRequest {
  return { method: 'POST', body, query: { id: groupId }, headers: { authorization: 'Bearer tok' } } as any
}

function makeRes(): VercelResponse & { statusCode?: number; body?: any } {
  const res: any = {}
  res.status = vi.fn((code: number) => { res.statusCode = code; return res })
  res.json = vi.fn((body: any) => { res.body = body; return res })
  return res
}

beforeEach(() => {
  groupPaths = { 'node-1': '1', 'node-1a': '1.2', 'node-2': '9' }
  govtAdminRow = null
  verifyAdminResult = { userId: 'admin-1' }
  verifyAuthTokenResult = { valid: true, userId: 'leader-1' }
  ensureDemoLeafClassResult = { classId: 'class-1', studentJoinCode: 'STU-999', created: true }
  ensureDemoLeafClassError = null
  resolvedCourseCode = 'spa_for_eng_v2'
  insertedGroups = []
  insertedInvites = []
  insertedDemoOrgs = []
  insertedEvents = []
  deletedFrom = []
  existingInviteCodes = []
  hiddenSchoolId = 'school-1'
})

describe('POST /api/groups/:id/demo-mint', () => {
  it('mints a bare node in one gesture: group + invite + demo_orgs record', async () => {
    const req = makeReq({ name: 'Test Org' })
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(201)
    expect(insertedGroups[0]).toMatchObject({ name: 'Test Org', parent_id: 'node-1', is_demo: true })
    expect(insertedInvites[0]).toMatchObject({ code_type: 'govt_admin', grants_group_id: 'new-group-1' })
    expect(insertedDemoOrgs[0]).toMatchObject({ group_id: 'new-group-1', org_shape: 'group' })
    expect(res.body.invite_code).toBe('ABC-123')
    expect(res.body.group_id).toBe('new-group-1')
    expect(ensureDemoLeafClassMock).not.toHaveBeenCalled()
    // Links-first (THE-MODEL §1.10): the URL is the artifact.
    expect(res.body.links).toEqual([
      expect.objectContaining({ role: 'leader', url: expect.stringMatching(/\/group\/ABC-123$/), code: 'ABC-123' }),
    ])
  })

  it('shape=school provisions the hidden leaf via the demo-schools generator machinery', async () => {
    const req = makeReq({ name: 'Demo School', shape: 'school' })
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(201)
    expect(ensureDemoLeafClassMock).toHaveBeenCalledWith(expect.anything(), 'new-group-1', 'admin-1', 'spa_for_eng_v2')
    expect(insertedDemoOrgs[0]).toMatchObject({ org_shape: 'single_school', school_id: 'school-1' })
    expect(res.body.student_join_code).toBe('STU-999')
    expect(res.body.links).toEqual([
      expect.objectContaining({ role: 'leader', url: expect.stringMatching(/\/group\/ABC-123$/) }),
      expect.objectContaining({ role: 'student', url: expect.stringMatching(/\/with\/STU-999$/), code: 'STU-999' }),
    ])
  })

  it('400s shape=school when no course_code can be resolved', async () => {
    resolvedCourseCode = null
    const req = makeReq({ name: 'Demo School', shape: 'school' })
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(400)
    expect(insertedInvites.length).toBe(0)
    // no half-minted org: the group insert is rolled back
    expect(deletedFrom).toContainEqual({ table: 'groups', id: 'new-group-1' })
  })

  it('rolls back the group when hidden-leaf provisioning fails', async () => {
    ensureDemoLeafClassError = 'boom'
    const req = makeReq({ name: 'Demo School', shape: 'school' })
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(500)
    expect(deletedFrom).toContainEqual({ table: 'groups', id: 'new-group-1' })
  })

  it('requires name', async () => {
    const req = makeReq({})
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(400)
    expect(insertedGroups.length).toBe(0)
  })

  it('rejects a caller who is neither admin nor leader of the node/an ancestor', async () => {
    verifyAdminResult = { error: 'Requires SSi admin access', status: 403 }
    const req = makeReq({ name: 'Test Org' })
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(403)
    expect(insertedGroups.length).toBe(0)
  })

  it('a leader governing the node itself may mint at it', async () => {
    verifyAdminResult = { error: 'Requires SSi admin access', status: 403 }
    govtAdminRow = { group_id: 'node-1' }
    const req = makeReq({ name: 'Test Org' }, 'node-1')
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(201)
  })

  it('a leader governing an ANCESTOR may mint deeper in their own subtree', async () => {
    verifyAdminResult = { error: 'Requires SSi admin access', status: 403 }
    govtAdminRow = { group_id: 'node-1' }
    const req = makeReq({ name: 'Test Org' }, 'node-1a')
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(201)
  })

  it('a leader of an unrelated node is rejected', async () => {
    verifyAdminResult = { error: 'Requires SSi admin access', status: 403 }
    govtAdminRow = { group_id: 'node-2' }
    const req = makeReq({ name: 'Test Org' }, 'node-1')
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(403)
    expect(insertedGroups.length).toBe(0)
  })

  it('401s an unauthenticated caller', async () => {
    verifyAdminResult = { error: 'Requires SSi admin access', status: 403 }
    verifyAuthTokenResult = { valid: false, error: 'no token' }
    const req = makeReq({ name: 'Test Org' })
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(401)
  })

  it('rejects non-POST methods', async () => {
    const req = { method: 'GET', query: { id: 'node-1' }, headers: {} } as any
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(405)
  })
})
