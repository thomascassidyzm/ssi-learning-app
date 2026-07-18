/**
 * REGRESSION PIN — GET/POST /api/admin/codes. No test file existed for this
 * endpoint before this pin. Pins CURRENT behaviour: list scoping (ssi_admin
 * sees all invite_codes, everyone else sees only codes they created) and the
 * is_active toggle's authorization rules (ssi_admin may toggle either table;
 * non-admins may only toggle an invite_codes row they created, never
 * entitlement_codes). No refactor, no behaviour change — baseline for
 * THE-MODEL.md's group unpick (docs/THE-MODEL.md, I8 — invites mint people
 * only, and stay server-mediated).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

process.env.SUPABASE_URL = 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'

let authUserId: string
vi.mock('../_utils/auth', () => ({
  verifyAuthToken: vi.fn(async () => ({ valid: true, userId: authUserId })),
}))

let learnerRow: { platform_role?: string | null; educational_role?: string | null } | null
let inviteCodes: Array<{ id: string; created_by: string; is_active: boolean }>
let entitlementUpdates: Array<{ id: string; is_active: boolean }>
let inviteUpdates: Array<{ id: string; is_active: boolean }>

function makeChainable(table: string) {
  const builder: any = {
    select: () => builder,
    order: () => builder,
    eq: (col: string, val: unknown) => {
      builder._eqCol = col
      builder._eqVal = val
      return builder
    },
    single: async () => {
      if (table === 'learners') return { data: learnerRow, error: learnerRow ? null : { message: 'not found' } }
      if (table === 'invite_codes') {
        const row = inviteCodes.find((c) => c.id === builder._eqVal)
        return { data: row ? { created_by: row.created_by } : null, error: null }
      }
      return { data: null, error: null }
    },
    update: (patch: { is_active: boolean }) => ({
      eq: (col: string, val: unknown) => {
        if (table === 'invite_codes') inviteUpdates.push({ id: val as string, is_active: patch.is_active })
        if (table === 'entitlement_codes') entitlementUpdates.push({ id: val as string, is_active: patch.is_active })
        return Promise.resolve({ data: null, error: null })
      },
    }),
    then(onF: any, onR: any) {
      if (table === 'invite_codes') {
        let rows = inviteCodes
        if (builder._eqCol === 'created_by') rows = rows.filter((c) => c.created_by === builder._eqVal)
        return Promise.resolve({ data: rows, error: null }).then(onF, onR)
      }
      return Promise.resolve({ data: [], error: null }).then(onF, onR)
    },
  }
  return builder
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: (table: string) => makeChainable(table) }),
}))

function makeReq(overrides: Partial<VercelRequest>): VercelRequest {
  return { method: 'GET', query: {}, headers: {}, body: {}, ...overrides } as VercelRequest
}

function makeRes() {
  const res: any = {}
  res.status = vi.fn((code: number) => { res._status = code; return res })
  res.json = vi.fn((body: unknown) => { res._json = body; return res })
  return res as VercelResponse & { _status?: number; _json?: any }
}

describe('GET/POST /api/admin/codes', () => {
  let handler: typeof import('./codes').default

  beforeEach(async () => {
    vi.resetModules()
    authUserId = 'user-1'
    learnerRow = { platform_role: null, educational_role: 'teacher' }
    inviteCodes = [
      { id: 'inv-mine', created_by: 'user-1', is_active: true },
      { id: 'inv-other', created_by: 'user-2', is_active: true },
    ]
    entitlementUpdates = []
    inviteUpdates = []
    handler = (await import('./codes')).default
  })

  it('rejects an unsupported method', async () => {
    const res = makeRes()
    await handler(makeReq({ method: 'DELETE' }), res)
    expect(res.status).toHaveBeenCalledWith(405)
  })

  it('rejects unauthenticated callers', async () => {
    authUserId = undefined as any
    const { verifyAuthToken } = await import('../_utils/auth')
    ;(verifyAuthToken as any).mockResolvedValueOnce({ valid: false, error: 'no session' })
    const res = makeRes()
    await handler(makeReq({}), res)
    expect(res.status).toHaveBeenCalledWith(401)
  })

  it('GET: a non-admin sees only invite codes they created', async () => {
    const res = makeRes()
    await handler(makeReq({}), res)
    expect(res.status).toHaveBeenCalledWith(200)
    expect((res as any)._json.codes.map((c: any) => c.id)).toEqual(['inv-mine'])
  })

  it('GET: an ssi_admin (platform_role) sees every invite code, not just their own', async () => {
    learnerRow = { platform_role: 'ssi_admin', educational_role: null }
    const res = makeRes()
    await handler(makeReq({}), res)
    expect((res as any)._json.codes.map((c: any) => c.id)).toEqual(['inv-mine', 'inv-other'])
  })

  it('GET: legacy god educational_role is also treated as ssi_admin', async () => {
    learnerRow = { platform_role: null, educational_role: 'god' }
    const res = makeRes()
    await handler(makeReq({}), res)
    expect((res as any)._json.codes.map((c: any) => c.id)).toEqual(['inv-mine', 'inv-other'])
  })

  it('POST: requires kind to be invite or entitlement', async () => {
    const res = makeRes()
    await handler(makeReq({ method: 'POST', body: { kind: 'bogus', id: 'x', is_active: true } }), res)
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('POST: requires id and is_active', async () => {
    const res = makeRes()
    await handler(makeReq({ method: 'POST', body: { kind: 'invite' } }), res)
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('POST: ssi_admin can toggle an entitlement code', async () => {
    learnerRow = { platform_role: 'ssi_admin', educational_role: null }
    const res = makeRes()
    await handler(makeReq({ method: 'POST', body: { kind: 'entitlement', id: 'ent-1', is_active: false } }), res)
    expect(res.status).toHaveBeenCalledWith(200)
    expect(entitlementUpdates).toEqual([{ id: 'ent-1', is_active: false }])
  })

  it('POST: ssi_admin can toggle ANY invite code, including one they did not create', async () => {
    learnerRow = { platform_role: 'ssi_admin', educational_role: null }
    const res = makeRes()
    await handler(makeReq({ method: 'POST', body: { kind: 'invite', id: 'inv-other', is_active: false } }), res)
    expect(res.status).toHaveBeenCalledWith(200)
    expect(inviteUpdates).toEqual([{ id: 'inv-other', is_active: false }])
  })

  it('POST: a non-admin CANNOT toggle an entitlement code at all', async () => {
    const res = makeRes()
    await handler(makeReq({ method: 'POST', body: { kind: 'entitlement', id: 'ent-1', is_active: false } }), res)
    expect(res.status).toHaveBeenCalledWith(403)
    expect(entitlementUpdates).toEqual([])
  })

  it('POST: a non-admin CAN toggle an invite code they created', async () => {
    const res = makeRes()
    await handler(makeReq({ method: 'POST', body: { kind: 'invite', id: 'inv-mine', is_active: false } }), res)
    expect(res.status).toHaveBeenCalledWith(200)
    expect(inviteUpdates).toEqual([{ id: 'inv-mine', is_active: false }])
  })

  it('POST: a non-admin CANNOT toggle an invite code created by someone else', async () => {
    const res = makeRes()
    await handler(makeReq({ method: 'POST', body: { kind: 'invite', id: 'inv-other', is_active: false } }), res)
    expect(res.status).toHaveBeenCalledWith(403)
    expect(inviteUpdates).toEqual([])
  })
})
