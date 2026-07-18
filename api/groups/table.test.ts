/**
 * Tests for GET /api/groups/table (THE-MODEL.md §6 Structure table lens):
 * scoping, search/label/demo/status filters, pagination.
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

let TABLES: Record<string, any[]>

function resetTables(): void {
  TABLES = {
    groups: [
      { id: 'region-1', name: 'Wales', type: 'nation', parent_id: null, path: 'wales', is_demo: false, is_test: false, created_at: 't' },
      { id: 'group-a', name: 'Gwynedd', type: 'organisation', parent_id: 'region-1', path: 'wales/gwynedd', is_demo: false, is_test: false, created_at: 't' },
      { id: 'group-b', name: 'Ysgol Y Traeth', type: 'school', parent_id: 'group-a', path: 'wales/gwynedd/ysgol-y-traeth', is_demo: false, is_test: false, created_at: 't' },
      { id: 'group-c', name: 'Demo Academy', type: 'school', parent_id: 'group-a', path: 'wales/gwynedd/demo-academy', is_demo: true, is_test: false, created_at: 't' },
      { id: 'region-2', name: 'England', type: 'nation', parent_id: null, path: 'england', is_demo: false, is_test: false, created_at: 't' },
    ],
    schools: [
      { id: 'school-1', node_group_id: 'group-b', platform_status: 'active', trial_course_code: null, trial_kind: null, platform_expires_at: null, teacher_seats: 3 },
      { id: 'school-2', node_group_id: 'group-c', platform_status: 'trial', trial_course_code: null, trial_kind: null, platform_expires_at: null, teacher_seats: 1 },
    ],
    classes: [],
    user_tags: [],
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

let handler: typeof import('./table').default

beforeEach(async () => {
  resetTables()
  verifyAdminResult = { userId: 'admin-1' }
  verifyAuthTokenResult = { valid: false, error: 'no token' }
  vi.resetModules()
  handler = (await import('./table')).default
})

describe('GET /api/groups/table', () => {
  it('ssi_admin sees every group, flat', async () => {
    const res = makeRes()
    await handler(makeReq(), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.total).toBe(5)
    expect(res.body.rows.map((r: any) => r.id).sort()).toEqual(
      ['group-a', 'group-b', 'group-c', 'region-1', 'region-2'].sort()
    )
  })

  it('a govt_admin sees only their own subtree', async () => {
    verifyAdminResult = { error: 'Requires SSi admin access', status: 403 }
    verifyAuthTokenResult = { valid: true, userId: 'leader-1' }
    const res = makeRes()
    await handler(makeReq(), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.rows.map((r: any) => r.id).sort()).toEqual(['group-a', 'group-b', 'group-c'])
  })

  it('401s an unauthenticated caller', async () => {
    verifyAdminResult = { error: 'Requires SSi admin access', status: 403 }
    verifyAuthTokenResult = { valid: false, error: 'no token' }
    const res = makeRes()
    await handler(makeReq(), res)
    expect(res.statusCode).toBe(401)
  })

  it('filters by search (name substring, case-insensitive)', async () => {
    const res = makeRes()
    await handler(makeReq({ search: 'gwynedd' }), res)
    expect(res.body.rows.map((r: any) => r.id)).toEqual(['group-a'])
  })

  it('filters by label', async () => {
    const res = makeRes()
    await handler(makeReq({ label: 'school' }), res)
    expect(res.body.rows.map((r: any) => r.id).sort()).toEqual(['group-b', 'group-c'])
  })

  it('filters by demo', async () => {
    const res = makeRes()
    await handler(makeReq({ demo: 'true' }), res)
    expect(res.body.rows.map((r: any) => r.id)).toEqual(['group-c'])
  })

  it('filters by commercial status (school-shaped nodes only)', async () => {
    const res = makeRes()
    await handler(makeReq({ status: 'trial' }), res)
    expect(res.body.rows.map((r: any) => r.id)).toEqual(['group-c'])
  })

  it('status=paid is a bucket — has a commercial attachment and is not on trial', async () => {
    const res = makeRes()
    await handler(makeReq({ status: 'paid' }), res)
    expect(res.body.rows.map((r: any) => r.id)).toEqual(['group-b'])
  })

  it('filters by bucket=school — structural (commercial attachment), not the label', async () => {
    const res = makeRes()
    await handler(makeReq({ bucket: 'school' }), res)
    expect(res.body.rows.map((r: any) => r.id).sort()).toEqual(['group-b', 'group-c'])
  })

  it('filters by bucket=group — no commercial attachment, even if labelled "school"', async () => {
    const res = makeRes()
    await handler(makeReq({ bucket: 'group' }), res)
    expect(res.body.rows.map((r: any) => r.id).sort()).toEqual(['group-a', 'region-1', 'region-2'])
  })

  it('paginates', async () => {
    const res = makeRes()
    await handler(makeReq({ page: '1' }), res)
    expect(res.body.pageSize).toBe(25)
    expect(res.body.page).toBe(1)
    expect(res.body.rows.length).toBe(5) // under one page
  })
})
