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
vi.mock('../_utils/auth', () => ({
  verifyAdmin: vi.fn(async () => verifyAdminResult),
}))

let insertCalls: any[] = []

function makeChainable(table: string) {
  const builder: any = {
    select: () => builder,
    order: () => builder,
    not: () => builder,
    insert: (obj: unknown) => { insertCalls.push({ table, obj }); return builder },
    single: () => Promise.resolve({ data: { id: 'group-new', ...(insertCalls[insertCalls.length - 1]?.obj || {}) }, error: null }),
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
