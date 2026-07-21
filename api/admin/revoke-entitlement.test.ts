/**
 * Regression test for POST /api/admin/revoke-entitlement.
 *
 * Focus: the code-based revoke path. `supabase.rpc(...)` returns a PostgREST
 * builder that is thenable but has NO `.catch` — the old `.catch(() => {})`
 * threw a TypeError synchronously, which bubbled to the outer try/catch so a
 * SUCCESSFUL revoke reported HTTP 500 and the use_count decrement never ran.
 * These tests pin the fixed behaviour: 200 + the decrement rpc actually fires.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

process.env.SUPABASE_URL = 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'

vi.mock('../_utils/auth', () => ({
  verifyAuthToken: vi.fn(async () => ({ valid: true, userId: 'admin-1' })),
}))

let rpcCalls: Array<{ name: string; params: unknown }> = []
// Per-table responders keyed by whether the chain was a .single() read or an
// awaited (delete) terminal.
let singleResponders: Record<string, () => { data: unknown; error: unknown }> = {}
let awaitResponders: Record<string, () => { data: unknown; error: unknown }> = {}

function makeChainable(table: string) {
  const calls: string[] = []
  const builder: any = {
    select: () => { calls.push('select'); return builder },
    delete: () => { calls.push('delete'); return builder },
    eq: () => { calls.push('eq'); return builder },
    single: () => Promise.resolve(singleResponders[table]?.() ?? { data: null, error: null }),
    then: (onF: any, onR: any) =>
      Promise.resolve(awaitResponders[table]?.() ?? { data: null, error: null }).then(onF, onR),
  }
  return builder
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => makeChainable(table),
    // Mirrors PostgrestFilterBuilder: thenable, but deliberately NO `.catch`.
    rpc: (name: string, params: unknown) => {
      rpcCalls.push({ name, params })
      return { then: (onF: any, onR: any) => Promise.resolve({ data: null, error: null }).then(onF, onR) }
    },
  }),
}))

function makeRes() {
  const res: any = {}
  res.status = vi.fn((code: number) => { res._status = code; return res })
  res.json = vi.fn((body: unknown) => { res._json = body; return res })
  return res as VercelResponse & { _status?: number; _json?: any }
}

function makeReq(overrides: Partial<VercelRequest>): VercelRequest {
  return { method: 'POST', query: {}, headers: {}, body: {}, ...overrides } as VercelRequest
}

describe('POST /api/admin/revoke-entitlement', () => {
  let handler: typeof import('./revoke-entitlement').default

  beforeEach(async () => {
    vi.resetModules()
    rpcCalls = []
    singleResponders = {
      learners: () => ({ data: { platform_role: 'ssi_admin' }, error: null }),
    }
    awaitResponders = {}
    handler = (await import('./revoke-entitlement')).default
  })

  it('code-based revoke returns 200 and fires the use_count decrement rpc', async () => {
    singleResponders.user_entitlements = () => ({ data: { entitlement_code_id: 'code-1' }, error: null })
    awaitResponders.user_entitlements = () => ({ data: null, error: null }) // delete succeeds

    const res = makeRes()
    await handler(makeReq({ body: { entitlement_id: 'ent-1' } }), res)

    expect(res._status).toBe(200)
    expect(res._json).toEqual({ success: true })
    // The decrement actually ran (the old .catch path threw before this).
    expect(rpcCalls).toHaveLength(1)
    expect(rpcCalls[0]).toEqual({ name: 'decrement_entitlement_use_count', params: { code_id: 'code-1' } })
  })

  it('non-code entitlement revoke returns 200 and does NOT call the rpc', async () => {
    singleResponders.user_entitlements = () => ({ data: { entitlement_code_id: null }, error: null })
    awaitResponders.user_entitlements = () => ({ data: null, error: null })

    const res = makeRes()
    await handler(makeReq({ body: { entitlement_id: 'ent-2' } }), res)

    expect(res._status).toBe(200)
    expect(rpcCalls).toHaveLength(0)
  })

  it('rejects a non-admin caller with 403', async () => {
    singleResponders.learners = () => ({ data: { platform_role: 'teacher' }, error: null })

    const res = makeRes()
    await handler(makeReq({ body: { entitlement_id: 'ent-1' } }), res)

    expect(res._status).toBe(403)
    expect(rpcCalls).toHaveLength(0)
  })
})
