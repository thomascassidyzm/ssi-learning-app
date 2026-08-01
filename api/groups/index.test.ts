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
// Path-prefix fixture for isStrictDescendantGroup: 'leader-group' is the
// leader's own governed group; 'leader-sub' is a real sub-group of it
// (path 'L.1' starts with 'L'); 'other-group' is unrelated.
let groupPaths: Record<string, string> = { 'leader-group': 'L', 'leader-sub': 'L.1', 'other-group': 'X' }

function makeChainable(table: string) {
  let eqVal: unknown
  const builder: any = {
    select: () => builder,
    order: () => builder,
    not: () => builder,
    eq: (_col: string, val: unknown) => { eqVal = val; return builder },
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
    then: (resolve: any) => resolve({ data: [], error: null }),
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
  vi.resetModules()
  handler = (await import('./index')).default
})

describe('POST /api/groups', () => {
  it('requires ssi_admin auth — rejects a non-admin caller', async () => {
    verifyAdminResult = { error: 'Requires SSi admin access', status: 403 }
    const req = makeReq('POST', { name: 'Gwynedd' })
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(403)
    expect(insertCalls).toHaveLength(0)
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

  it('rejects a leader creating a root org (no parent_id)', async () => {
    govtAdminRow = { group_id: 'leader-group' }
    const req = makeReq('POST', { name: 'Sneaky Root Org' })
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(403)
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
