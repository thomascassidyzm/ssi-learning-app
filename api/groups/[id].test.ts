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

let govtAdminRow: any
let updateCalls: any[] = []

function makeChainable(table: string) {
  const builder: any = {
    select: () => builder,
    update: (obj: unknown) => { updateCalls.push({ table, obj }); return builder },
    eq: () => builder,
    maybeSingle: () => {
      if (table === 'govt_admins') return Promise.resolve({ data: govtAdminRow, error: null })
      return Promise.resolve({ data: null, error: null })
    },
    single: () => Promise.resolve({ data: { id: 'group-1', name: 'Updated Name' }, error: null }),
  }
  return builder
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: (table: string) => makeChainable(table) }),
}))

import handler from './[id]'

function makeReq(method: string, body: unknown, groupId = 'group-1'): VercelRequest {
  return { method, body, query: { id: groupId }, headers: { authorization: 'Bearer tok' } } as any
}

function makeRes(): VercelResponse & { statusCode?: number; body?: any } {
  const res: any = {}
  res.status = vi.fn((code: number) => { res.statusCode = code; return res })
  res.json = vi.fn((body: any) => { res.body = body; return res })
  return res
}

beforeEach(() => {
  updateCalls = []
  govtAdminRow = null
  verifyAdminResult = { error: 'Requires SSi admin access', status: 403 }
  verifyAuthTokenResult = { valid: true, userId: 'leader-1' }
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
})
