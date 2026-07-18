/**
 * Tests for GET /api/groups/tree (THE-MODEL.md §6 Structure tree lens):
 * scoping (ssi_admin sees the whole forest; a govt_admin is confined to
 * their own subtree) + rollup correctness (teachers/classes/learners,
 * commercial attachment via schools.node_group_id).
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

// ─── Fixture tables + a generic filter-applying mock query builder ───
let TABLES: Record<string, any[]>

function resetTables(): void {
  TABLES = {
    groups: [
      { id: 'region-1', name: 'Wales', type: 'nation', parent_id: null, path: 'wales', is_demo: false, is_test: false, created_at: 't' },
      { id: 'group-a', name: 'Gwynedd', type: 'organisation', parent_id: 'region-1', path: 'wales/gwynedd', is_demo: false, is_test: false, created_at: 't' },
      { id: 'group-b', name: 'Ysgol Y Traeth', type: 'school', parent_id: 'group-a', path: 'wales/gwynedd/ysgol-y-traeth', is_demo: false, is_test: false, created_at: 't' },
      { id: 'region-2', name: 'England', type: 'nation', parent_id: null, path: 'england', is_demo: false, is_test: false, created_at: 't' },
    ],
    schools: [
      { id: 'school-1', node_group_id: 'group-b', platform_status: 'active', trial_course_code: null, trial_kind: null, platform_expires_at: null, teacher_seats: 3 },
    ],
    classes: [
      { id: 'class-1', group_id: 'group-b', school_id: null, is_active: true },
    ],
    user_tags: [
      { tag_type: 'group', tag_value: 'GROUP:group-b', role_in_context: 'teacher', user_id: 'teacher-1', removed_at: null },
      { tag_type: 'class', tag_value: 'CLASS:class-1', role_in_context: 'student', user_id: 'student-1', removed_at: null },
    ],
    govt_admins: [
      { user_id: 'leader-1', group_id: 'group-a' },
    ],
  }
}

function applyFilters(rows: any[], calls: { method: string; args: any[] }[]): any[] {
  let result = rows
  for (const c of calls) {
    if (c.method === 'eq') result = result.filter((r) => r[c.args[0]] === c.args[1])
    else if (c.method === 'in') result = result.filter((r) => (c.args[1] as any[]).includes(r[c.args[0]]))
    else if (c.method === 'is') result = result.filter((r) => r[c.args[0]] === c.args[1])
    else if (c.method === 'like') {
      const pattern = c.args[1] as string
      const prefix = pattern.endsWith('%') ? pattern.slice(0, -1) : pattern
      result = result.filter((r) => typeof r[c.args[0]] === 'string' && r[c.args[0]].startsWith(prefix))
    }
  }
  return result
}

function makeChainable(table: string) {
  const calls: { method: string; args: any[] }[] = []
  const builder: any = {}
  const chain = (method: string) => (...args: any[]) => { calls.push({ method, args }); return builder }
  builder.select = chain('select')
  builder.eq = chain('eq')
  builder.in = chain('in')
  builder.is = chain('is')
  builder.like = chain('like')
  builder.order = chain('order')
  builder.maybeSingle = () => {
    const rows = applyFilters(TABLES[table] || [], calls)
    return Promise.resolve({ data: rows[0] || null, error: null })
  }
  builder.then = (resolve: any) => {
    const rows = applyFilters(TABLES[table] || [], calls)
    return resolve({ data: rows, error: null })
  }
  return builder
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: (table: string) => makeChainable(table) }),
}))

function makeReq(query: Record<string, string> = {}): VercelRequest {
  return { method: 'GET', query, headers: { authorization: 'Bearer tok' } } as any
}

function makeRes(): VercelResponse & { statusCode?: number; body?: any } {
  const res: any = {}
  res.status = vi.fn((code: number) => { res.statusCode = code; return res })
  res.json = vi.fn((body: any) => { res.body = body; return res })
  return res
}

let handler: typeof import('./tree').default

beforeEach(async () => {
  resetTables()
  verifyAdminResult = { error: 'Requires SSi admin access', status: 403 }
  verifyAuthTokenResult = { valid: false, error: 'no token' }
  vi.resetModules()
  handler = (await import('./tree')).default
})

function findNode(roots: any[], id: string): any {
  for (const r of roots) {
    if (r.id === id) return r
    const found = findNode(r.children, id)
    if (found) return found
  }
  return null
}

describe('GET /api/groups/tree', () => {
  it('401s an unauthenticated caller', async () => {
    const res = makeRes()
    await handler(makeReq(), res)
    expect(res.statusCode).toBe(401)
  })

  it('403s an authenticated caller who governs no group', async () => {
    verifyAuthTokenResult = { valid: true, userId: 'nobody' }
    const res = makeRes()
    await handler(makeReq(), res)
    expect(res.statusCode).toBe(403)
  })

  it('ssi_admin with no root sees the whole forest (every root-level group)', async () => {
    verifyAdminResult = { userId: 'admin-1' }
    const res = makeRes()
    await handler(makeReq(), res)
    expect(res.statusCode).toBe(200)
    const ids = res.body.roots.map((r: any) => r.id)
    expect(ids).toEqual(expect.arrayContaining(['region-1', 'region-2']))
  })

  it('ssi_admin can request an arbitrary root, nested to descendants', async () => {
    verifyAdminResult = { userId: 'admin-1' }
    const res = makeRes()
    await handler(makeReq({ root: 'group-a' }), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.roots).toHaveLength(1)
    expect(res.body.roots[0].id).toBe('group-a')
    expect(res.body.roots[0].children.map((c: any) => c.id)).toEqual(['group-b'])
  })

  it('respects the depth cap — depth=1 excludes grandchildren', async () => {
    verifyAdminResult = { userId: 'admin-1' }
    const res = makeRes()
    await handler(makeReq({ root: 'region-1', depth: '1' }), res)
    expect(res.statusCode).toBe(200)
    const groupA = findNode(res.body.roots, 'group-a')
    expect(groupA).toBeTruthy()
    expect(groupA.children).toHaveLength(0) // group-b is depth 2 from region-1
  })

  it('attaches per-node rollups and commercial info for a school-shaped node', async () => {
    verifyAdminResult = { userId: 'admin-1' }
    const res = makeRes()
    await handler(makeReq({ root: 'group-a' }), res)
    const groupB = findNode(res.body.roots, 'group-b')
    expect(groupB.rollup).toMatchObject({ teacherCount: 1, classCount: 1, learnerCount: 1 })
    expect(groupB.commercial).toMatchObject({ schoolId: 'school-1', platformStatus: 'active' })
  })

  it('rolls child counts UP into an ancestor — parent tells the group-dashboard story', async () => {
    // group-a itself has zero direct teachers/classes/learners; group-b (its
    // child school) has 1 of each. The founder-ruled fix: group-a's rollup is
    // the SUBTREE total, not its (empty) direct affiliations.
    verifyAdminResult = { userId: 'admin-1' }
    const res = makeRes()
    await handler(makeReq({ root: 'region-1' }), res)
    const groupA = findNode(res.body.roots, 'group-a')
    expect(groupA.rollup).toMatchObject({ teacherCount: 1, classCount: 1, learnerCount: 1 })
    // childGroupCount stays DIRECT — group-a has one direct child (group-b).
    expect(groupA.rollup.childGroupCount).toBe(1)
    // A parent node carries no commercial identity of its own.
    expect(groupA.commercial).toBeNull()
  })

  it('subtree rollup counts a shared user ONCE (distinct, not a naive sum)', async () => {
    // Same teacher tagged at region-1 (group) AND its descendant group-b: the
    // ancestor rollup must not double-count.
    TABLES.user_tags.push(
      { tag_type: 'group', tag_value: 'GROUP:region-1', role_in_context: 'teacher', user_id: 'teacher-1', removed_at: null },
    )
    verifyAdminResult = { userId: 'admin-1' }
    const res = makeRes()
    await handler(makeReq({ root: 'region-1' }), res)
    const region = res.body.roots.find((r: any) => r.id === 'region-1')
    expect(region.rollup.teacherCount).toBe(1)
  })

  it('govt_admin with no root defaults to their own governed group', async () => {
    verifyAuthTokenResult = { valid: true, userId: 'leader-1' }
    const res = makeRes()
    await handler(makeReq(), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.roots).toHaveLength(1)
    expect(res.body.roots[0].id).toBe('group-a')
  })

  it('govt_admin can drill into their own descendant', async () => {
    verifyAuthTokenResult = { valid: true, userId: 'leader-1' }
    const res = makeRes()
    await handler(makeReq({ root: 'group-b' }), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.roots[0].id).toBe('group-b')
  })

  it('govt_admin is rejected requesting a root outside their subtree', async () => {
    verifyAuthTokenResult = { valid: true, userId: 'leader-1' }
    const res = makeRes()
    await handler(makeReq({ root: 'region-2' }), res)
    expect(res.statusCode).toBe(403)
  })

  it('govt_admin is rejected requesting an ancestor of their own group', async () => {
    verifyAuthTokenResult = { valid: true, userId: 'leader-1' }
    const res = makeRes()
    await handler(makeReq({ root: 'region-1' }), res)
    expect(res.statusCode).toBe(403)
  })
})
