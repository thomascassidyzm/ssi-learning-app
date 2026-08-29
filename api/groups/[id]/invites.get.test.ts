/**
 * Tests for GET /api/groups/:id/invites — THE-MODEL.md §1.10: the node
 * panel's "ways in" list. Links-first: every active code minted at this
 * exact node, returned as a ready-to-share URL, newest first.
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

let govtAdminRow: any
let groupPaths: Record<string, string> = { '11111111-1111-4111-8111-111111111111': '1', '22222222-2222-4222-8222-222222222222': '1.2', '33333333-3333-4333-8333-333333333333': '9' }
let inviteRows: any[] = []

function applyFilters(rows: any[], calls: { method: string; args: any[] }[]): any[] {
  let result = rows
  for (const c of calls) {
    if (c.method === 'eq') result = result.filter((r) => r[c.args[0]] === c.args[1])
  }
  return result
}

function makeChainable(table: string) {
  const calls: { method: string; args: any[] }[] = []
  let eqVal: unknown
  const builder: any = {}
  builder.select = () => builder
  builder.eq = (col: string, val: unknown) => { calls.push({ method: 'eq', args: [col, val] }); eqVal = val; return builder }
  builder.order = () => builder
  builder.maybeSingle = () => {
    if (table === 'govt_admins') return Promise.resolve({ data: govtAdminRow, error: null })
    if (table === 'groups') {
      const path = groupPaths[eqVal as string]
      return Promise.resolve({ data: path ? { path } : null, error: null })
    }
    return Promise.resolve({ data: null, error: null })
  }
  builder.then = (resolve: any) => {
    if (table === 'invite_codes') return resolve({ data: applyFilters(inviteRows, calls), error: null })
    return resolve({ data: [], error: null })
  }
  return builder
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: (table: string) => makeChainable(table) }),
}))

let handler: typeof import('./invites').default

// COORD-03: the :id must be uuid-shaped or the handler 400s before any query.
// AUTH-CORE-08/INPUT-10: the host must be an allow-listed app origin, or
// getAppOrigin() falls back to production rather than echoing it.
function makeReq(groupId = '11111111-1111-4111-8111-111111111111'): VercelRequest {
  return { method: 'GET', query: { id: groupId }, headers: { authorization: 'Bearer tok', host: 'staging.saysomethingin.app' } } as any
}

function makeRes(): VercelResponse & { statusCode?: number; body?: any } {
  const res: any = {}
  res.status = vi.fn((code: number) => { res.statusCode = code; return res })
  res.json = vi.fn((body: any) => { res.body = body; return res })
  return res
}

beforeEach(async () => {
  groupPaths = { '11111111-1111-4111-8111-111111111111': '1', '22222222-2222-4222-8222-222222222222': '1.2', '33333333-3333-4333-8333-333333333333': '9' }
  govtAdminRow = null
  verifyAdminResult = { userId: 'admin-1' }
  verifyAuthTokenResult = { valid: true, userId: 'leader-1' }
  inviteRows = [
    { code: 'ABC123', code_type: 'teacher', is_active: true, grants_group_id: '11111111-1111-4111-8111-111111111111', max_uses: null, use_count: 2, expires_at: null, created_at: '2026-07-18T00:00:00Z' },
    { code: 'DEF456', code_type: 'govt_admin', is_active: true, grants_group_id: '11111111-1111-4111-8111-111111111111', max_uses: 1, use_count: 0, expires_at: null, created_at: '2026-07-17T00:00:00Z' },
  ]
  handler = (await import('./invites')).default
})

describe('GET /api/groups/:id/invites', () => {
  it('returns links-first: ready-to-share URLs, not bare codes', async () => {
    const res = makeRes()
    await handler(makeReq(), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.links).toHaveLength(2)
    expect(res.body.links).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'teacher', url: 'https://staging.saysomethingin.app/redeem/ABC123', code: 'ABC123' }),
      expect.objectContaining({ role: 'leader', url: 'https://staging.saysomethingin.app/group/DEF456', code: 'DEF456' }),
    ]))
  })

  it('401s an unauthenticated caller', async () => {
    verifyAdminResult = { error: 'Not admin', status: 403 }
    verifyAuthTokenResult = { valid: false, error: 'no token' }
    const res = makeRes()
    await handler(makeReq(), res)
    expect(res.statusCode).toBe(401)
  })

  it('a govt_admin outside the node/ancestor chain is rejected', async () => {
    verifyAdminResult = { error: 'Not admin', status: 403 }
    govtAdminRow = { group_id: '33333333-3333-4333-8333-333333333333' }
    const res = makeRes()
    await handler(makeReq('11111111-1111-4111-8111-111111111111'), res)
    expect(res.statusCode).toBe(403)
  })
})
