/**
 * Tests for POST /api/entitlement/grant — THE-MODEL.md §1.11 binary
 * entitlement semantics: a node is either { state: 'trial', course_code }
 * (exactly one course, auto-derived expiry) or { state: 'paid' } (every
 * live/beta course, no list, no expiry). Compat (I10): granted_courses is
 * still populated on every write so existing readers (get_cascade_courses,
 * api/groups/index.ts) keep consuming a plain array unchanged.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-key'

let verifyAdminResult: any
vi.mock('../_utils/auth', () => ({
  verifyAdmin: vi.fn(async () => verifyAdminResult),
}))

let DB: {
  courses: any[]
  entitlement_grants: any[]
}
let insertedGrant: any
let updatedGrant: any

function makeChainable(table: string) {
  let rows: any[] = [...((DB as any)[table] ?? [])]
  let lastInsert: any = null
  let lastUpdate: any = null
  const builder: any = {
    select: () => builder,
    eq: (col: string, val: unknown) => { rows = rows.filter((r) => r[col] === val); return builder },
    in: (col: string, vals: unknown[]) => { rows = rows.filter((r) => vals.includes(r[col])); return builder },
    maybeSingle: () => Promise.resolve(rows[0] ? { data: rows[0], error: null } : { data: null, error: null }),
    single: () => {
      if (lastInsert) return Promise.resolve({ data: { id: 'new-grant-id', ...lastInsert }, error: null })
      if (lastUpdate) return Promise.resolve({ data: { id: rows[0]?.id ?? 'grant-1', ...lastUpdate }, error: null })
      return Promise.resolve(rows[0] ? { data: rows[0], error: null } : { data: null, error: { code: 'PGRST116' } })
    },
    insert: (row: any) => {
      lastInsert = row
      insertedGrant = row
      return builder
    },
    update: (patch: any) => {
      lastUpdate = patch
      updatedGrant = patch
      return builder
    },
    then: (resolve: any) => {
      if (lastInsert) {
        const row = { id: 'new-grant-id', ...lastInsert }
        return Promise.resolve({ data: row, error: null }).then(resolve)
      }
      if (lastUpdate) {
        const row = { id: rows[0]?.id ?? 'grant-1', ...lastUpdate }
        return Promise.resolve({ data: row, error: null }).then(resolve)
      }
      return Promise.resolve({ data: rows, error: null }).then(resolve)
    },
  }
  return builder
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => makeChainable(table),
  }),
}))

function makeReq(body: any): VercelRequest {
  return { method: 'POST', headers: { authorization: 'Bearer tok' }, body } as any
}

function makeRes(): VercelResponse & { statusCode?: number; body?: any } {
  const res: any = {}
  res.status = vi.fn((code: number) => { res.statusCode = code; return res })
  res.json = vi.fn((body: any) => { res.body = body; return res })
  return res
}

let handler: typeof import('./grant').default

beforeEach(async () => {
  vi.resetModules()
  verifyAdminResult = { userId: 'admin-1' }
  insertedGrant = null
  updatedGrant = null
  DB = {
    courses: [
      { course_code: 'spa_for_eng', pricing_tier: 'premium', new_app_status: 'live' },
      { course_code: 'cym_for_eng', pricing_tier: 'free', new_app_status: 'live' },
      { course_code: 'gle_for_eng', pricing_tier: 'community', new_app_status: 'beta' },
      { course_code: 'draft_course', pricing_tier: 'premium', new_app_status: 'draft' },
    ],
    entitlement_grants: [],
  }
  handler = (await import('./grant')).default
})

describe('POST /api/entitlement/grant — binary semantics', () => {
  it('trial: premium course gets a 30-day expiry and a single-course granted_courses array', async () => {
    const res = makeRes()
    await handler(makeReq({ school_id: 's1', state: 'trial', course_code: 'spa_for_eng' }), res)

    expect(res.statusCode).toBe(201)
    expect(res.body.grant.state).toBe('trial')
    expect(res.body.grant.granted_courses).toEqual(['spa_for_eng'])
    const days = (new Date(res.body.grant.expires_at).getTime() - Date.now()) / 86400000
    expect(days).toBeGreaterThan(29)
    expect(days).toBeLessThan(31)
  })

  it('trial: free-tier course gets a 365-day expiry', async () => {
    const res = makeRes()
    await handler(makeReq({ school_id: 's1', state: 'trial', course_code: 'cym_for_eng' }), res)

    expect(res.statusCode).toBe(201)
    const days = (new Date(res.body.grant.expires_at).getTime() - Date.now()) / 86400000
    expect(days).toBeGreaterThan(364)
    expect(days).toBeLessThan(366)
  })

  it('trial: community-tier course also gets the free-track 365-day expiry', async () => {
    const res = makeRes()
    await handler(makeReq({ school_id: 's1', state: 'trial', course_code: 'gle_for_eng' }), res)

    expect(res.statusCode).toBe(201)
    const days = (new Date(res.body.grant.expires_at).getTime() - Date.now()) / 86400000
    expect(days).toBeGreaterThan(364)
    expect(days).toBeLessThan(366)
  })

  it('paid: grants every live/beta course, no expiry, no client-supplied list', async () => {
    const res = makeRes()
    await handler(makeReq({ school_id: 's1', state: 'paid' }), res)

    expect(res.statusCode).toBe(201)
    expect(res.body.grant.state).toBe('paid')
    expect(res.body.grant.expires_at).toBeNull()
    // draft_course is new_app_status='draft' and must be excluded.
    expect(res.body.grant.granted_courses.sort()).toEqual(['cym_for_eng', 'gle_for_eng', 'spa_for_eng'].sort())
  })

  it('rejects a missing/invalid state', async () => {
    const res = makeRes()
    await handler(makeReq({ school_id: 's1' }), res)
    expect(res.statusCode).toBe(400)

    const res2 = makeRes()
    await handler(makeReq({ school_id: 's1', state: 'lifetime' }), res2)
    expect(res2.statusCode).toBe(400)
  })

  it('rejects a trial grant with no course_code', async () => {
    const res = makeRes()
    await handler(makeReq({ school_id: 's1', state: 'trial' }), res)
    expect(res.statusCode).toBe(400)
  })

  it('rejects a paid grant that still carries course_code (no per-course list on paid)', async () => {
    const res = makeRes()
    await handler(makeReq({ school_id: 's1', state: 'paid', course_code: 'spa_for_eng' }), res)
    expect(res.statusCode).toBe(400)
  })

  it('rejects a trial course that is not live/beta', async () => {
    const res = makeRes()
    await handler(makeReq({ school_id: 's1', state: 'trial', course_code: 'draft_course' }), res)
    expect(res.statusCode).toBe(400)
  })

  it('rejects a trial course that does not exist', async () => {
    const res = makeRes()
    await handler(makeReq({ school_id: 's1', state: 'trial', course_code: 'nonexistent' }), res)
    expect(res.statusCode).toBe(400)
  })

  it('requires exactly one of group_id/school_id/class_id', async () => {
    const none = makeRes()
    await handler(makeReq({ state: 'paid' }), none)
    expect(none.statusCode).toBe(400)

    const both = makeRes()
    await handler(makeReq({ school_id: 's1', group_id: 'g1', state: 'paid' }), both)
    expect(both.statusCode).toBe(400)
  })

  it('updates an existing grant in place, switching trial -> paid', async () => {
    DB.entitlement_grants = [{ id: 'grant-1', school_id: 's1', state: 'trial', granted_courses: ['spa_for_eng'], is_active: true }]
    const res = makeRes()
    await handler(makeReq({ school_id: 's1', state: 'paid' }), res)

    expect(res.statusCode).toBe(200)
    expect(res.body.updated).toBe(true)
    expect(res.body.grant.state).toBe('paid')
    expect(res.body.grant.expires_at).toBeNull()
  })

  it('propagates a non-admin auth failure', async () => {
    verifyAdminResult = { error: 'Forbidden', status: 403 }
    const res = makeRes()
    await handler(makeReq({ school_id: 's1', state: 'paid' }), res)
    expect(res.statusCode).toBe(403)
  })
})
