/**
 * Tests for GET/POST /api/groups.
 *
 * POST is currently the target of an in-flight change adding is_demo
 * passthrough (org-hierarchy feature: ORGANISATION = root of the groups
 * tree, groups.is_demo already live on the column, groups are pure
 * containers). As of writing, api/groups/index.ts's POST handler does NOT
 * read is_demo off the body — only name/type/parent_id. These tests assert
 * REALITY, not the target: if is_demo passthrough has not landed yet, the
 * is_demo-specific assertions below will fail, documenting the gap for
 * whoever lands that change.
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

let insertCalls: any[] = []
let govtAdminRow: any
// Tree fixture for isStrictDescendantGroup (parent_id walk since 2026-08-06):
// 'leader-group' is the leader's own governed group; 'leader-sub' is a real
// sub-group of it; 'other-group' is unrelated.
let groupPaths: Record<string, string> = { 'leader-group': 'L', 'leader-sub': 'L.1', 'other-group': 'X' }
// Rows the duplicate-name lookup (findSiblingSlugCollisions) reads back. Empty
// by default so every pre-existing test keeps the exact behaviour it asserted.
let existingGroups: any[] = []
const GROUP_PARENTS: Record<string, string | null> = { 'leader-group': null, 'leader-sub': 'leader-group', 'other-group': null }
const forestRows = () => Object.entries(GROUP_PARENTS).map(([id, parent_id]) => ({ id, parent_id }))

function makeChainable(table: string) {
  let eqVal: unknown
  let selectCols = ''
  const builder: any = {
    select: (cols?: string) => { selectCols = cols || ''; return builder },
    order: () => builder,
    not: () => builder,
    eq: (_col: string, val: unknown) => { eqVal = val; return builder },
    is: () => builder,
    insert: (obj: unknown) => { insertCalls.push({ table, obj }); return builder },
    single: () => Promise.resolve({ data: { id: 'group-new', ...(insertCalls[insertCalls.length - 1]?.obj || {}) }, error: null }),
    maybeSingle: () => {
      if (table === 'govt_admins') return Promise.resolve({ data: govtAdminRow, error: null })
      if (table === 'groups') {
        const path = groupPaths[eqVal as string]
        return Promise.resolve({ data: path ? { path } : null, error: null })
      }
      return Promise.resolve({ data: null, error: null })
    },
    then: (resolve: any) => {
      // Two different list reads hit `groups`: the parent_id forest walk
      // (selects id, parent_id) and the duplicate-name lookup (selects the
      // name/created_at/path it needs to warn). Tell them apart by columns.
      if (table === 'groups' && selectCols.includes('name')) return resolve({ data: existingGroups, error: null })
      return resolve({ data: table === 'groups' && eqVal === undefined ? forestRows() : [], error: null })
    },
  }
  return builder
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: (table: string) => makeChainable(table) }),
}))

function makeReq(method: string, body?: unknown): VercelRequest {
  return { method, body, query: {}, headers: { authorization: 'Bearer tok' } } as any
}

function makeRes(): VercelResponse & { statusCode?: number; body?: any } {
  const res: any = {}
  res.status = vi.fn((code: number) => { res.statusCode = code; return res })
  res.json = vi.fn((body: any) => { res.body = body; return res })
  return res
}

let handler: typeof import('./index').default

beforeEach(async () => {
  insertCalls = []
  verifyAdminResult = { userId: 'admin-1' }
  verifyAuthTokenResult = { valid: true, userId: 'leader-1' }
  govtAdminRow = null
  groupPaths = { 'leader-group': 'L', 'leader-sub': 'L.1', 'other-group': 'X' }
  existingGroups = []
  vi.resetModules()
  handler = (await import('./index')).default
})

describe('POST /api/groups', () => {
  it('SELF-SERVE ROOT (founder ruling 2026-08-02): an authenticated non-admin creates a root org AND becomes its group leader in the same request', async () => {
    verifyAdminResult = { error: 'Requires SSi admin access', status: 403 }
    govtAdminRow = null
    const req = makeReq('POST', { name: 'Cardiff Council' })
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(201)
    const groupInsert = insertCalls.find((c) => c.table === 'groups')
    const leaderInsert = insertCalls.find((c) => c.table === 'govt_admins')
    expect(groupInsert.obj).toMatchObject({ name: 'Cardiff Council', type: 'organisation' })
    expect(leaderInsert.obj).toMatchObject({ user_id: 'leader-1', group_id: 'group-new', created_by: 'leader-1' })
  })

  // ─── Founder ruling 2026-08-06: the creator of a group/org automatically
  // becomes its first MANAGER. govt_admins alone is authz — no lens reads it,
  // so creators used to govern a group that named no manager anywhere. ───
  it('CREATOR IS FIRST MANAGER: a self-serve root org also gets the creator a leader MEMBERSHIP tag', async () => {
    verifyAdminResult = { error: 'Requires SSi admin access', status: 403 }
    govtAdminRow = null
    const res = makeRes()
    await handler(makeReq('POST', { name: 'Cardiff Council' }), res)
    expect(res.statusCode).toBe(201)
    const tagInsert = insertCalls.find((c) => c.table === 'user_tags')
    expect(tagInsert.obj).toMatchObject({
      user_id: 'leader-1',
      tag_type: 'group',
      tag_value: 'GROUP:group-new',
      role_in_context: 'admin',
    })
  })

  it('CREATOR IS FIRST MANAGER: a leader creating a SUB-group becomes its manager too', async () => {
    verifyAdminResult = { error: 'Requires SSi admin access', status: 403 }
    govtAdminRow = { group_id: 'leader-group' }
    const res = makeRes()
    await handler(makeReq('POST', { name: 'MFL Department', parent_id: 'leader-group' }), res)
    expect(res.statusCode).toBe(201)
    const tagInsert = insertCalls.find((c) => c.table === 'user_tags')
    expect(tagInsert.obj).toMatchObject({
      user_id: 'leader-1',
      tag_type: 'group',
      tag_value: 'GROUP:group-new',
      role_in_context: 'admin',
    })
  })

  it('an ssi_admin creating a group does NOT become its manager — admins assign leadership by invite', async () => {
    verifyAdminResult = { userId: 'admin-1' }
    const res = makeRes()
    await handler(makeReq('POST', { name: 'Some Programme', parent_id: 'leader-group' }), res)
    expect(res.statusCode).toBe(201)
    expect(insertCalls.find((c) => c.table === 'user_tags')).toBeUndefined()
  })

  it('requires ssi_admin auth — 401s an unauthenticated caller', async () => {
    verifyAdminResult = { error: 'Missing or invalid Authorization header', status: 401 }
    // A genuinely unauthenticated caller fails BOTH the admin and the
    // fallback leader auth check (same header, same reason) — wire the
    // mock to match, since the two are independently mocked here.
    verifyAuthTokenResult = { valid: false, error: 'Missing or invalid Authorization header' }
    const req = makeReq('POST', { name: 'Gwynedd' })
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(401)
    expect(insertCalls).toHaveLength(0)
  })

  it('is_demo: true in the body results in an insert row including is_demo: true (documents target behavior — will fail until passthrough lands)', async () => {
    const req = makeReq('POST', { name: 'Demo Region', is_demo: true })
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(201)
    expect(insertCalls).toHaveLength(1)
    expect(insertCalls[0].obj).toMatchObject({ is_demo: true })
  })

  it('omitting is_demo does not set it to true (asserts whatever the actual default is)', async () => {
    const req = makeReq('POST', { name: 'Real Region' })
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(201)
    expect(insertCalls).toHaveLength(1)
    expect(insertCalls[0].obj.is_demo).not.toBe(true)
  })
})

describe('POST /api/groups — group-leader sub-group authority (2026-08-01)', () => {
  beforeEach(() => {
    // Non-admin caller for this block.
    verifyAdminResult = { error: 'Requires SSi admin access', status: 403 }
  })

  it('a leader may add a sub-group directly under their own governed group', async () => {
    govtAdminRow = { group_id: 'leader-group' }
    const req = makeReq('POST', { name: 'District A', parent_id: 'leader-group' })
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(201)
    expect(insertCalls[0].obj).toMatchObject({ parent_id: 'leader-group' })
  })

  it('a leader may add a sub-group under one of their own DESCENDANT sub-groups', async () => {
    govtAdminRow = { group_id: 'leader-group' }
    const req = makeReq('POST', { name: 'District A / Ward 1', parent_id: 'leader-sub' })
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(201)
    expect(insertCalls[0].obj).toMatchObject({ parent_id: 'leader-sub' })
  })

  it('rejects an EXISTING leader creating a second root org — one org per leader, 409, never a silent leadership re-point', async () => {
    govtAdminRow = { group_id: 'leader-group' }
    const req = makeReq('POST', { name: 'Second Root Org' })
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(409)
    expect(insertCalls).toHaveLength(0)
  })

  it('rejects a leader creating a group under a SIDEWAYS/foreign parent_id (the critical case)', async () => {
    govtAdminRow = { group_id: 'leader-group' }
    const req = makeReq('POST', { name: 'Hijacked', parent_id: 'other-group' })
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(403)
    expect(insertCalls).toHaveLength(0)
  })

  it('rejects a caller with no govt_admins row at all', async () => {
    govtAdminRow = null
    const req = makeReq('POST', { name: 'X', parent_id: 'leader-group' })
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(403)
    expect(insertCalls).toHaveLength(0)
  })

  it('401s an unauthenticated caller', async () => {
    verifyAuthTokenResult = { valid: false, error: 'no token' }
    const req = makeReq('POST', { name: 'X', parent_id: 'leader-group' })
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(401)
    expect(insertCalls).toHaveLength(0)
  })

  it('ignores is_demo:true from a leader — never stamped for a non-admin caller', async () => {
    govtAdminRow = { group_id: 'leader-group' }
    const req = makeReq('POST', { name: 'District A', parent_id: 'leader-group', is_demo: true })
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(201)
    expect(insertCalls[0].obj.is_demo).not.toBe(true)
  })

  it('a leader-created sub-group never gets a trial-clock stamp (it bills through the org)', async () => {
    govtAdminRow = { group_id: 'leader-group' }
    const req = makeReq('POST', { name: 'District A', parent_id: 'leader-group' })
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(201)
    expect(insertCalls[0].obj.platform_status).toBeUndefined()
  })
})

describe('POST /api/groups — duplicate-name WARNING (Deborah, 2026-08-06)', () => {
  const deborah = { id: 'org-1', name: 'Deborah Testing', created_at: '2026-08-05T10:00:00Z', path: 'deborah-testing' }

  beforeEach(() => {
    // Non-admin self-serve root creator, no existing leadership.
    verifyAdminResult = { error: 'Requires SSi admin access', status: 403 }
    govtAdminRow = null
    existingGroups = [deborah]
  })

  it('409s a colliding root org with code duplicate_name and creates NOTHING', async () => {
    const req = makeReq('POST', { name: 'Deborah Testing' })
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(409)
    expect(res.body.code).toBe('duplicate_name')
    expect(insertCalls).toHaveLength(0)
  })

  it.each(['Deborah Testing', 'deborah testing', 'Deborah-Testing'])('the slug variant %s collides', async (name) => {
    const req = makeReq('POST', { name })
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(409)
  })

  it('"Deborah Testing 2" is a different org and creates normally', async () => {
    const req = makeReq('POST', { name: 'Deborah Testing 2' })
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(201)
    expect(insertCalls.find((c) => c.table === 'groups')).toBeTruthy()
  })

  it('confirm_duplicate: true creates it AND still makes the creator its leader', async () => {
    const req = makeReq('POST', { name: 'Deborah Testing', confirm_duplicate: true })
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(201)
    expect(insertCalls.find((c) => c.table === 'groups').obj).toMatchObject({ name: 'Deborah Testing', type: 'organisation' })
    expect(insertCalls.find((c) => c.table === 'govt_admins').obj).toMatchObject({ user_id: 'leader-1', group_id: 'group-new' })
  })

  it('confirm_duplicate on a NON-colliding name changes nothing — it is not a way to switch the check off', async () => {
    const req = makeReq('POST', { name: 'Cardiff Council', confirm_duplicate: true })
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(201)
    expect(insertCalls.find((c) => c.table === 'groups').obj).toMatchObject({ name: 'Cardiff Council' })
  })

  it('redacts the other tenant: a non-admin root creator gets the name and date only, never the id or path', async () => {
    const req = makeReq('POST', { name: 'Deborah Testing' })
    const res = makeRes()
    await handler(req, res)
    expect(res.body.duplicates).toEqual([{ name: 'Deborah Testing', created_at: '2026-08-05T10:00:00Z' }])
  })

  it('an ssi_admin sees the full row', async () => {
    verifyAdminResult = { userId: 'admin-1' }
    const req = makeReq('POST', { name: 'Deborah Testing' })
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(409)
    expect(res.body.duplicates[0]).toMatchObject({ id: 'org-1', path: 'deborah-testing' })
  })

  it('the one-org-per-leader 409 still fires first and stays DISTINGUISHABLE — no duplicate_name code on it', async () => {
    govtAdminRow = { group_id: 'leader-group' }
    const req = makeReq('POST', { name: 'Deborah Testing' })
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(409)
    expect(res.body.code).toBeUndefined()
    expect(res.body.error).toContain('one organisation per leader')
    expect(insertCalls).toHaveLength(0)
  })

  it('a sub-group collision under the caller\'s own parent warns, with full detail', async () => {
    govtAdminRow = { group_id: 'leader-group' }
    existingGroups = [{ id: 'y7', name: 'Year 7', created_at: '2026-07-01T10:00:00Z', path: 'L/year-7' }]
    const req = makeReq('POST', { name: 'Year 7', parent_id: 'leader-group' })
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(409)
    expect(res.body.code).toBe('duplicate_name')
    expect(res.body.error).toContain('a group called "Year 7"')
    expect(res.body.duplicates[0]).toMatchObject({ id: 'y7' })
    expect(insertCalls).toHaveLength(0)
  })
})
