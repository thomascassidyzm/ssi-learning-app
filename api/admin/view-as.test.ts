/**
 * Tests for POST /api/admin/view-as — the audit log for the ssi_admin
 * "View as" read-only impersonation feature (useActAs.ts). Both actions
 * write/update admin_impersonation_audit (service-role only table).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-key'

let verifyAdminResult: any
vi.mock('../_utils/auth', () => ({
  verifyAdmin: vi.fn(async () => verifyAdminResult),
}))

let insertCalls: any[] = []
let updateCalls: any[] = []
let insertError: any = null
let updateError: any = null

function makeChainable(_table: string) {
  let eqCalls = 0
  const builder: any = {
    insert: (obj: unknown) => { insertCalls.push(obj); return builder },
    update: (obj: unknown) => { updateCalls.push(obj); return builder },
    select: () => builder,
    single: async () => (insertError ? { data: null, error: insertError } : { data: { id: 'audit-row-1' }, error: null }),
    // .update(...).eq('id', ...).eq('admin_user_id', ...) resolves on the
    // second .eq() (no .single() on the update path).
    eq: () => {
      eqCalls += 1
      return eqCalls >= 2 ? Promise.resolve({ error: updateError }) : builder
    },
  }
  return builder
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: (table: string) => makeChainable(table) }),
}))

function makeReq(body: any): VercelRequest {
  return { method: 'POST', body, headers: { authorization: 'Bearer tok', 'user-agent': 'vitest', 'x-forwarded-for': '1.2.3.4' } } as any
}

function makeRes(): VercelResponse & { statusCode?: number; body?: any } {
  const res: any = {}
  res.status = vi.fn((code: number) => { res.statusCode = code; return res })
  res.json = vi.fn((body: any) => { res.body = body; return res })
  return res
}

let handler: typeof import('./view-as').default

beforeEach(async () => {
  vi.resetModules()
  insertCalls = []
  updateCalls = []
  insertError = null
  updateError = null
  handler = (await import('./view-as')).default
  verifyAdminResult = { userId: 'admin-1' }
})

describe('POST /api/admin/view-as', () => {
  it('rejects a non-admin caller', async () => {
    verifyAdminResult = { error: 'Requires SSi admin access', status: 403 }
    const req = makeReq({ action: 'start', target_user_id: 'teacher-1', target_role: 'teacher' })
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(403)
    expect(insertCalls).toHaveLength(0)
  })

  it('logs a start and returns the audit row id', async () => {
    const req = makeReq({ action: 'start', target_user_id: 'teacher-1', target_role: 'teacher', target_name: 'Lucy' })
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ id: 'audit-row-1' })
    expect(insertCalls).toHaveLength(1)
    expect(insertCalls[0]).toMatchObject({
      admin_user_id: 'admin-1',
      target_user_id: 'teacher-1',
      target_role: 'teacher',
      target_name: 'Lucy',
      ip_address: '1.2.3.4',
      user_agent: 'vitest',
    })
  })

  it('400s a start missing target_user_id', async () => {
    const req = makeReq({ action: 'start', target_role: 'teacher' })
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(400)
    expect(insertCalls).toHaveLength(0)
  })

  it('closes a session on end', async () => {
    const req = makeReq({ action: 'end', id: 'audit-row-1' })
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ ok: true })
    expect(updateCalls).toHaveLength(1)
    expect(updateCalls[0]).toHaveProperty('ended_at')
  })

  it('400s an unknown action', async () => {
    const req = makeReq({ action: 'nope' })
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(400)
  })
})
