/**
 * GET /api/admin/effective-access — the admin screen must be told the SAME
 * thing the player is told, including the layers that have no row.
 *
 * Founder report 2026-09-09 (Chepstow): a teacher covered by her school's live
 * platform trial read as DEFAULT / "No active entitlements" on her user page,
 * because that page could only see stored user_entitlements rows.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-key'

const FUTURE = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()

let adminResult: any = { userId: 'admin-uid' }
vi.mock('../_utils/auth', () => ({
  verifyAdmin: vi.fn(async () => adminResult),
}))

let DB: Record<string, any[]>

function makeChainable(table: string) {
  let rows: any[] = [...(DB[table] ?? [])]
  const builder: any = {
    select: () => builder,
    eq: (col: string, val: unknown) => { rows = rows.filter((r) => r[col] === val); return builder },
    is: (col: string, val: unknown) => {
      rows = rows.filter((r) => (val === null ? r[col] == null : r[col] === val))
      return builder
    },
    in: (col: string, vals: unknown[]) => { rows = rows.filter((r) => vals.includes(r[col])); return builder },
    maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
    single: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
    then: (resolve: any) => Promise.resolve({ data: rows, error: null }).then(resolve),
  }
  return builder
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => makeChainable(table),
    rpc: () => Promise.resolve({ data: [], error: null }),
  }),
}))

function makeRes(): VercelResponse & { statusCode?: number; body?: any } {
  const res: any = {}
  res.status = (code: number) => { res.statusCode = code; return res }
  res.json = (body: any) => { res.body = body; return res }
  res.setHeader = () => res
  res.end = () => res
  return res
}

const req = (learnerId?: string) =>
  ({ method: 'GET', headers: {}, query: learnerId ? { learner_id: learnerId } : {} }) as unknown as VercelRequest

beforeEach(() => {
  adminResult = { userId: 'admin-uid' }
  DB = {
    // A teacher of class c1 at a school on a live trial — no stored entitlement.
    learners: [{ id: 'lrn-1', user_id: 'auth-teacher' }],
    user_entitlements: [],
    user_tags: [
      { user_id: 'auth-teacher', tag_type: 'class', tag_value: 'CLASS:c1', role_in_context: 'teacher', removed_at: null },
    ],
    classes: [{ id: 'c1', school_id: 's1', course_code: 'cym_s_for_eng' }],
    schools: [{ id: 's1', platform_status: 'trial', platform_expires_at: FUTURE }],
  }
})

describe('GET /api/admin/effective-access', () => {
  it('reports the covered teacher\'s course even with no stored entitlement row', async () => {
    const handler = (await import('./effective-access')).default
    const res = makeRes()
    await handler(req('lrn-1'), res)

    expect(res.statusCode).toBe(200)
    expect(res.body.entitlements).toHaveLength(1)
    expect(res.body.entitlements[0].granted_courses).toEqual(['cym_s_for_eng'])
    // Derived: there is no row, so the UI must not offer Revoke on it.
    expect(res.body.derived).toEqual(['class-coverage'])
  })

  it('reports nothing once the school platform cover has lapsed', async () => {
    DB.schools = [{ id: 's1', platform_status: 'expired', platform_expires_at: null }]
    const handler = (await import('./effective-access')).default
    const res = makeRes()
    await handler(req('lrn-1'), res)

    expect(res.statusCode).toBe(200)
    expect(res.body.entitlements).toEqual([])
    expect(res.body.derived).toEqual([])
  })

  it('refuses without a learner_id, and 404s on an unknown one', async () => {
    const handler = (await import('./effective-access')).default
    const bad = makeRes()
    await handler(req(), bad)
    expect(bad.statusCode).toBe(400)

    const missing = makeRes()
    await handler(req('nope'), missing)
    expect(missing.statusCode).toBe(404)
  })

  it('refuses a non-admin caller', async () => {
    adminResult = { error: 'Forbidden', status: 403 }
    const handler = (await import('./effective-access')).default
    const res = makeRes()
    await handler(req('lrn-1'), res)
    expect(res.statusCode).toBe(403)
  })
})
