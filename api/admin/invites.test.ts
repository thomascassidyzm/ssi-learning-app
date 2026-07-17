import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-key'

let learnerRow: any
vi.mock('../_utils/auth', () => ({
  verifyAuthToken: vi.fn(async () => ({ valid: true, userId: 'user-1' })),
}))

let inviteCodeRows: any[]
let entitlementCodeRows: any[]
let emailGrantRows: any[]
let tryLinkRows: any[]
let classRows: any[]
let schoolRows: any[]
let groupRows: any[]
let learnerRows: any[]
let updateCalls: { table: string; patch: any; id: any }[]

function makeQueryBuilder(table: string) {
  const state: { eqFilters: Record<string, any>; inFilters: Record<string, any[]> } = { eqFilters: {}, inFilters: {} }
  const builder: any = {}

  builder.select = vi.fn(() => builder)
  builder.order = vi.fn(() => builder)
  builder.eq = vi.fn((col: string, val: any) => { state.eqFilters[col] = val; return builder })
  builder.in = vi.fn((col: string, vals: any[]) => { state.inFilters[col] = vals; return builder })

  builder.update = vi.fn((patch: any) => {
    builder._pendingUpdate = patch
    return builder
  })

  function rowsFor(): any[] {
    switch (table) {
      case 'invite_codes': return inviteCodeRows
      case 'entitlement_codes': return entitlementCodeRows
      case 'email_access_grants': return emailGrantRows
      case 'try_links': return tryLinkRows
      case 'classes': return classRows
      case 'schools': return schoolRows
      case 'groups': return groupRows
      case 'learners': return learnerRows
      default: return []
    }
  }

  function filtered(): any[] {
    let rows = rowsFor()
    for (const [col, val] of Object.entries(state.eqFilters)) rows = rows.filter(r => r[col] === val)
    for (const [col, vals] of Object.entries(state.inFilters)) rows = rows.filter(r => vals.includes(r[col]))
    return rows
  }

  builder.single = vi.fn(async () => {
    if (table === 'learners') {
      const found = learnerRows.find(l => l.user_id === state.eqFilters.user_id)
      return { data: found || learnerRow, error: null }
    }
    const rows = filtered()
    return { data: rows[0] || null, error: null }
  })

  builder.then = (resolve: any) => {
    if (builder._pendingUpdate) {
      updateCalls.push({ table, patch: builder._pendingUpdate, id: state.eqFilters.id })
      return resolve({ data: null, error: null })
    }
    return resolve({ data: filtered(), error: null })
  }

  return builder
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => makeQueryBuilder(table),
  }),
}))

let handler: typeof import('./invites').default

function makeReq(method: string, body?: any): VercelRequest {
  return { method, headers: { authorization: 'Bearer tok' }, body } as any
}

function makeRes(): VercelResponse & { statusCode?: number; body?: any } {
  const res: any = {}
  res.status = vi.fn((code: number) => { res.statusCode = code; return res })
  res.json = vi.fn((body: any) => { res.body = body; return res })
  return res
}

beforeEach(async () => {
  learnerRow = { platform_role: 'ssi_admin', educational_role: null }
  learnerRows = [{ user_id: 'user-1', platform_role: 'ssi_admin', educational_role: null, display_name: 'Admin Alice' }]

  inviteCodeRows = []
  entitlementCodeRows = []
  emailGrantRows = []
  tryLinkRows = []
  classRows = []
  schoolRows = []
  groupRows = []
  updateCalls = []

  const authMod: any = await import('../_utils/auth')
  authMod.verifyAuthToken.mockImplementation(async () => ({ valid: true, userId: 'user-1' }))

  handler = (await import('./invites')).default
})

describe('POST/GET /api/admin/invites — method + auth', () => {
  it('rejects an unsupported method', async () => {
    const res = makeRes()
    await handler(makeReq('DELETE'), res)
    expect(res.statusCode).toBe(405)
  })

  it('rejects unauthenticated callers', async () => {
    const authMod: any = await import('../_utils/auth')
    authMod.verifyAuthToken.mockImplementation(async () => ({ valid: false, error: 'no token' }))
    const res = makeRes()
    await handler(makeReq('GET'), res)
    expect(res.statusCode).toBe(401)
  })
})

describe('GET /api/admin/invites — ssi_admin aggregation', () => {
  beforeEach(() => {
    groupRows = [
      { id: 'group-japan', name: 'Japan 2026', path: 'japan-2026', parent_id: null, is_demo: true },
    ]
    schoolRows = [
      { id: 'school-sherbourne', school_name: 'Sherbourne College', group_id: 'group-japan', is_demo: true },
    ]
    classRows = [
      { id: 'class-3b', class_name: 'Class 3B', school_id: 'school-sherbourne' },
    ]
    inviteCodeRows = [
      {
        id: 'invite-1', code: 'STU123', code_type: 'student', created_by: 'user-1',
        grants_region: null, grants_school_id: null, grants_class_id: 'class-3b', grants_group_id: null,
        expires_at: null, max_uses: 10, use_count: 2, created_at: '2026-07-01T00:00:00Z', is_active: true,
      },
      {
        id: 'invite-2', code: 'TEA456', code_type: 'teacher', created_by: 'user-2',
        grants_region: null, grants_school_id: null, grants_class_id: null, grants_group_id: null,
        expires_at: null, max_uses: null, use_count: 0, created_at: '2026-07-02T00:00:00Z', is_active: true,
      },
    ]
    entitlementCodeRows = [
      {
        id: 'ent-1', code: 'ENT789', access_type: 'full', granted_courses: null,
        duration_type: 'lifetime', duration_days: null, label: 'Promo', max_uses: 1, use_count: 0,
        expires_at: null, is_active: true, created_by: 'user-1', created_at: '2026-07-03T00:00:00Z',
      },
    ]
    emailGrantRows = [
      {
        id: 'email-1', email: 'friend@example.com', access_type: 'courses', granted_courses: ['spa_for_eng'],
        duration_type: 'time_limited', duration_days: 30, is_active: true, created_by: 'user-1',
        created_at: '2026-07-04T00:00:00Z', redeemed_at: null,
      },
    ]
    tryLinkRows = [
      {
        id: 'try-1', code: 'TRY001', label: 'Trade show', created_by: 'user-1',
        expires_at: '2026-10-01T00:00:00Z', ttl_days: 90, is_active: true, created_at: '2026-07-05T00:00:00Z',
      },
    ]
  })

  it('aggregates all four sources into the unified shape', async () => {
    const res = makeRes()
    await handler(makeReq('GET'), res)
    expect(res.statusCode).toBe(200)
    const invites = res.body.invites as any[]
    expect(invites).toHaveLength(5)
    expect(invites.map(i => i.source).sort()).toEqual(['email_grant', 'entitlement', 'invite', 'invite', 'try_link'])
  })

  it('resolves a student class code who/where/what/urlPath, with demo propagated from the group', async () => {
    const res = makeRes()
    await handler(makeReq('GET'), res)
    const invite = res.body.invites.find((i: any) => i.id === 'invite-1')
    expect(invite.who).toBe('learner')
    expect(invite.urlPath).toBe('/with/STU123')
    expect(invite.where).toEqual({
      kind: 'class', id: 'class-3b', name: 'Class 3B',
      path: 'Japan 2026 › Sherbourne College › Class 3B', isDemo: true,
    })
    expect(invite.what).toBe('Demo')
    expect(invite.createdByName).toBe('Admin Alice')
  })

  it('maps a platform-scoped teacher invite code', async () => {
    const res = makeRes()
    await handler(makeReq('GET'), res)
    const invite = res.body.invites.find((i: any) => i.id === 'invite-2')
    expect(invite.who).toBe('teacher')
    expect(invite.urlPath).toBe('/redeem/TEA456')
    expect(invite.where).toEqual({ kind: 'platform', id: null, name: null, path: null, isDemo: false })
    expect(invite.what).toBe('Real account')
  })

  it('maps an entitlement code', async () => {
    const res = makeRes()
    await handler(makeReq('GET'), res)
    const invite = res.body.invites.find((i: any) => i.id === 'ent-1')
    expect(invite.who).toBe('access')
    expect(invite.urlPath).toBe('/redeem/ENT789')
    expect(invite.what).toBe('Full access · lifetime')
  })

  it('maps an email allowlist grant', async () => {
    const res = makeRes()
    await handler(makeReq('GET'), res)
    const invite = res.body.invites.find((i: any) => i.id === 'email-1')
    expect(invite.who).toBe('access')
    expect(invite.urlPath).toBeNull()
    expect(invite.email).toBe('friend@example.com')
    expect(invite.what).toBe('Courses: spa_for_eng · 30 days')
  })

  it('maps a try link', async () => {
    const res = makeRes()
    await handler(makeReq('GET'), res)
    const invite = res.body.invites.find((i: any) => i.id === 'try-1')
    expect(invite.who).toBe('guest')
    expect(invite.urlPath).toBe('/try/TRY001')
    expect(invite.what).toBe('Course preview')
  })
})

describe('GET /api/admin/invites — non-admin scoping', () => {
  beforeEach(() => {
    learnerRow = { platform_role: null, educational_role: 'teacher' }
    learnerRows = [{ user_id: 'user-1', platform_role: null, educational_role: 'teacher', display_name: 'Teacher Tim' }]
    inviteCodeRows = [
      { id: 'invite-own', code: 'OWN1', code_type: 'teacher', created_by: 'user-1', grants_class_id: null, grants_school_id: null, grants_group_id: null, expires_at: null, max_uses: null, use_count: 0, created_at: '2026-07-01T00:00:00Z', is_active: true },
      { id: 'invite-other', code: 'OTH1', code_type: 'teacher', created_by: 'user-2', grants_class_id: null, grants_school_id: null, grants_group_id: null, expires_at: null, max_uses: null, use_count: 0, created_at: '2026-07-02T00:00:00Z', is_active: true },
    ]
    entitlementCodeRows = [
      { id: 'ent-x', code: 'ENTX', access_type: 'full', granted_courses: null, duration_type: 'lifetime', duration_days: null, label: 'x', max_uses: null, use_count: 0, expires_at: null, is_active: true, created_by: 'user-1', created_at: '2026-07-03T00:00:00Z' },
    ]
  })

  it('returns only invite codes the caller created, and nothing from the other three tables', async () => {
    const res = makeRes()
    await handler(makeReq('GET'), res)
    expect(res.statusCode).toBe(200)
    const invites = res.body.invites as any[]
    expect(invites).toHaveLength(1)
    expect(invites[0].id).toBe('invite-own')
    expect(invites.some(i => i.source === 'entitlement')).toBe(false)
  })
})

describe('POST /api/admin/invites — toggle', () => {
  beforeEach(() => {
    inviteCodeRows = [
      { id: 'invite-1', code: 'STU123', code_type: 'student', created_by: 'user-1', grants_class_id: null, grants_school_id: null, grants_group_id: null, expires_at: null, max_uses: null, use_count: 0, created_at: '2026-07-01T00:00:00Z', is_active: true },
    ]
    entitlementCodeRows = [
      { id: 'ent-1', code: 'ENT1', access_type: 'full', granted_courses: null, duration_type: 'lifetime', duration_days: null, label: 'x', max_uses: null, use_count: 0, expires_at: null, is_active: true, created_by: 'user-1', created_at: '2026-07-01T00:00:00Z' },
    ]
    emailGrantRows = [
      { id: 'email-1', email: 'a@b.com', access_type: 'full', granted_courses: null, duration_type: 'lifetime', duration_days: null, is_active: true, created_by: 'user-1', created_at: '2026-07-01T00:00:00Z', redeemed_at: null },
    ]
    tryLinkRows = [
      { id: 'try-1', code: 'TRY1', label: 'x', created_by: 'user-1', expires_at: null, ttl_days: 90, is_active: true, created_at: '2026-07-01T00:00:00Z' },
    ]
  })

  it('rejects an invalid source', async () => {
    const res = makeRes()
    await handler(makeReq('POST', { source: 'bogus', id: 'invite-1', is_active: false }), res)
    expect(res.statusCode).toBe(400)
  })

  it('requires id and is_active', async () => {
    const res = makeRes()
    await handler(makeReq('POST', { source: 'invite', is_active: false }), res)
    expect(res.statusCode).toBe(400)
  })

  it('routes an invite toggle to invite_codes', async () => {
    const res = makeRes()
    await handler(makeReq('POST', { source: 'invite', id: 'invite-1', is_active: false }), res)
    expect(res.statusCode).toBe(200)
    expect(updateCalls).toEqual([{ table: 'invite_codes', patch: { is_active: false }, id: 'invite-1' }])
  })

  it('routes an entitlement toggle to entitlement_codes', async () => {
    const res = makeRes()
    await handler(makeReq('POST', { source: 'entitlement', id: 'ent-1', is_active: false }), res)
    expect(res.statusCode).toBe(200)
    expect(updateCalls).toEqual([{ table: 'entitlement_codes', patch: { is_active: false }, id: 'ent-1' }])
  })

  it('routes an email_grant toggle to email_access_grants', async () => {
    const res = makeRes()
    await handler(makeReq('POST', { source: 'email_grant', id: 'email-1', is_active: false }), res)
    expect(res.statusCode).toBe(200)
    expect(updateCalls).toEqual([{ table: 'email_access_grants', patch: { is_active: false }, id: 'email-1' }])
  })

  it('routes a try_link toggle to try_links', async () => {
    const res = makeRes()
    await handler(makeReq('POST', { source: 'try_link', id: 'try-1', is_active: false }), res)
    expect(res.statusCode).toBe(200)
    expect(updateCalls).toEqual([{ table: 'try_links', patch: { is_active: false }, id: 'try-1' }])
  })

  it('403s a non-admin toggling someone else\'s invite code', async () => {
    learnerRow = { platform_role: null, educational_role: 'teacher' }
    learnerRows = [{ user_id: 'user-1', platform_role: null, educational_role: 'teacher', display_name: 'Teacher Tim' }]
    inviteCodeRows = [
      { id: 'invite-other', code: 'OTH1', code_type: 'teacher', created_by: 'user-2', grants_class_id: null, grants_school_id: null, grants_group_id: null, expires_at: null, max_uses: null, use_count: 0, created_at: '2026-07-01T00:00:00Z', is_active: true },
    ]
    const res = makeRes()
    await handler(makeReq('POST', { source: 'invite', id: 'invite-other', is_active: false }), res)
    expect(res.statusCode).toBe(403)
    expect(updateCalls).toHaveLength(0)
  })

  it('403s a non-admin toggling a non-invite source entirely', async () => {
    learnerRow = { platform_role: null, educational_role: 'teacher' }
    learnerRows = [{ user_id: 'user-1', platform_role: null, educational_role: 'teacher', display_name: 'Teacher Tim' }]
    const res = makeRes()
    await handler(makeReq('POST', { source: 'entitlement', id: 'ent-1', is_active: false }), res)
    expect(res.statusCode).toBe(403)
    expect(updateCalls).toHaveLength(0)
  })
})
