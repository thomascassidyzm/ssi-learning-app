import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-key'

let verifyAdminResult: any
vi.mock('../_utils/auth', () => ({
  verifyAdmin: vi.fn(async () => verifyAdminResult),
}))

let provisionResult: any
let provisionError: Error | null
const provisionDemoOrgMock = vi.fn(async () => {
  if (provisionError) throw provisionError
  return provisionResult
})
vi.mock('../_utils/demoSchoolGen', () => ({
  provisionDemoOrg: (...args: any[]) => provisionDemoOrgMock(...args),
}))

let purgeResult: any
let purgeError: Error | null
const purgeDemoOrgMock = vi.fn(async () => {
  if (purgeError) throw purgeError
  return purgeResult
})
vi.mock('../_utils/demoSchoolTeardown', () => ({
  purgeDemoOrg: (...args: any[]) => purgeDemoOrgMock(...args),
}))

let rateCount: number
let demoOrgRows: any[]
let learnerRows: any[]
let insertedEvents: any[]
let updatedDemoOrgs: any[]
let banCalls: any[]

function makeQueryBuilder(table: string) {
  const builder: any = {}
  const methods = ['select', 'eq', 'gte', 'lte', 'in', 'contains', 'order']
  for (const m of methods) builder[m] = vi.fn(() => builder)
  builder.maybeSingle = vi.fn(async () => {
    if (table === 'demo_orgs') {
      const found = demoOrgRows.find(r => r.id === builder._eqId)
      return { data: found || null, error: null }
    }
    return { data: null, error: null }
  })
  builder.single = vi.fn(async () => ({ data: null, error: null }))
  builder.insert = vi.fn((rows: any) => {
    if (table === 'player_events') insertedEvents.push(...(Array.isArray(rows) ? rows : [rows]))
    return builder
  })
  builder.update = vi.fn((patch: any) => {
    if (table === 'demo_orgs') updatedDemoOrgs.push(patch)
    return builder
  })
  const realEq = builder.eq
  builder.eq = vi.fn((col: string, val: any) => {
    if (table === 'demo_orgs' && col === 'id') builder._eqId = val
    return realEq(col, val)
  })
  builder.then = (resolve: any) => {
    if (table === 'player_events') return resolve({ count: rateCount, error: null })
    if (table === 'demo_orgs') return resolve({ data: demoOrgRows, error: null })
    if (table === 'learners') return resolve({ data: learnerRows, error: null })
    return resolve({ data: null, error: null })
  }
  return builder
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => makeQueryBuilder(table),
    auth: {
      admin: {
        updateUserById: vi.fn(async (uid: string, patch: any) => { banCalls.push({ uid, patch }); return { data: {}, error: null } }),
      },
    },
  }),
}))

let handler: typeof import('./demo-schools').default

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
  verifyAdminResult = { userId: 'admin-1' }
  rateCount = 0
  provisionError = null
  purgeError = null
  purgeResult = {
    demoOrgId: 'org-1', prospectName: 'Riverside Trust',
    schoolsDeleted: 1, classesDeleted: 3, learnersDeleted: 30, authAccountsDeleted: 3,
  }
  provisionResult = {
    demoOrgId: 'org-1',
    orgName: 'Riverside Trust',
    orgShape: 'single_school',
    courseCode: 'zho_for_eng',
    groupId: null,
    schoolIds: ['school-1'],
    staff: [{ role: 'school_admin', name: 'Jane Admin', email: 'jane@example.com', learnerId: 'learner-1', password: 'abc123' }],
    counts: { schools: 1, teachers: 2, classes: 3, learners: 30 },
    expiresAt: '2026-08-15T00:00:00.000Z',
  }
  demoOrgRows = [{
    id: 'org-1', prospect_name: 'Riverside Trust', status: 'active',
    expires_at: '2026-08-15T00:00:00.000Z',
    metadata: { staff: [{ learnerId: 'learner-1' }] },
  }]
  learnerRows = [{ user_id: 'auth-uid-1' }]
  insertedEvents = []
  updatedDemoOrgs = []
  banCalls = []
  handler = (await import('./demo-schools')).default
})

describe('POST /api/admin/demo-schools', () => {
  it('rejects a non-admin caller', async () => {
    verifyAdminResult = { error: 'Requires SSi admin access', status: 403 }
    const res = makeRes()
    await handler(makeReq('POST', { action: 'create' }), res)
    expect(res.statusCode).toBe(403)
  })

  it('rejects an unsupported method', async () => {
    const res = makeRes()
    await handler(makeReq('DELETE'), res)
    expect(res.statusCode).toBe(405)
  })

  it('lists demo orgs on GET', async () => {
    const res = makeRes()
    await handler(makeReq('GET'), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.orgs).toEqual(demoOrgRows)
  })

  it('rejects an unknown action', async () => {
    const res = makeRes()
    await handler(makeReq('POST', { action: 'nuke' }), res)
    expect(res.statusCode).toBe(400)
  })

  describe('create', () => {
    it('requires prospectName', async () => {
      const res = makeRes()
      await handler(makeReq('POST', { action: 'create', orgShape: 'single_school', courseCode: 'zho_for_eng' }), res)
      expect(res.statusCode).toBe(400)
    })

    it('requires a valid orgShape', async () => {
      const res = makeRes()
      await handler(makeReq('POST', { action: 'create', prospectName: 'Acme', orgShape: 'nonsense', courseCode: 'zho_for_eng' }), res)
      expect(res.statusCode).toBe(400)
    })

    it('rate-limits after too many recent creates by the same admin', async () => {
      rateCount = 10
      const res = makeRes()
      await handler(makeReq('POST', { action: 'create', prospectName: 'Acme', orgShape: 'single_school', courseCode: 'zho_for_eng' }), res)
      expect(res.statusCode).toBe(429)
      expect(provisionDemoOrgMock).not.toHaveBeenCalled()
    })

    it('provisions the org and writes an audit row', async () => {
      const res = makeRes()
      await handler(makeReq('POST', { action: 'create', prospectName: 'Acme', orgShape: 'single_school', courseCode: 'zho_for_eng' }), res)
      expect(res.statusCode).toBe(201)
      expect(res.body.org.demoOrgId).toBe('org-1')
      expect(insertedEvents).toHaveLength(1)
      expect(insertedEvents[0]).toMatchObject({ event_type: 'admin_demo_school_created', payload: { actor_user_id: 'admin-1' } })
    })

    it('500s when provisioning throws (e.g. phantom course code)', async () => {
      provisionError = new Error('course_code "fake" is not a live course')
      const res = makeRes()
      await handler(makeReq('POST', { action: 'create', prospectName: 'Acme', orgShape: 'single_school', courseCode: 'fake' }), res)
      expect(res.statusCode).toBe(500)
      expect(res.body.error).toMatch(/not a live course/)
    })
  })

  describe('expire', () => {
    it('requires id', async () => {
      const res = makeRes()
      await handler(makeReq('POST', { action: 'expire' }), res)
      expect(res.statusCode).toBe(400)
    })

    it('404s for an unknown org', async () => {
      demoOrgRows = []
      const res = makeRes()
      await handler(makeReq('POST', { action: 'expire', id: 'nope' }), res)
      expect(res.statusCode).toBe(404)
    })

    it('bans every staff account and marks the org expired', async () => {
      const res = makeRes()
      await handler(makeReq('POST', { action: 'expire', id: 'org-1' }), res)
      expect(res.statusCode).toBe(200)
      expect(banCalls).toEqual([{ uid: 'auth-uid-1', patch: { ban_duration: '87600h' } }])
      expect(updatedDemoOrgs[0]).toMatchObject({ status: 'expired' })
      expect(insertedEvents[0]).toMatchObject({ event_type: 'admin_demo_school_expired' })
    })
  })

  describe('extend', () => {
    it('requires id', async () => {
      const res = makeRes()
      await handler(makeReq('POST', { action: 'extend' }), res)
      expect(res.statusCode).toBe(400)
    })

    it('404s for an unknown org', async () => {
      demoOrgRows = []
      const res = makeRes()
      await handler(makeReq('POST', { action: 'extend', id: 'nope' }), res)
      expect(res.statusCode).toBe(404)
    })

    it('pushes expires_at out by 30 days by default', async () => {
      const res = makeRes()
      await handler(makeReq('POST', { action: 'extend', id: 'org-1' }), res)
      expect(res.statusCode).toBe(200)
      const base = new Date('2026-08-15T00:00:00.000Z').getTime()
      const got = new Date(res.body.expires_at).getTime()
      expect(got - base).toBe(30 * 86400000)
    })

    it('un-bans staff when reviving an expired org', async () => {
      demoOrgRows[0].status = 'expired'
      const res = makeRes()
      await handler(makeReq('POST', { action: 'extend', id: 'org-1' }), res)
      expect(res.statusCode).toBe(200)
      expect(banCalls).toEqual([{ uid: 'auth-uid-1', patch: { ban_duration: 'none' } }])
      expect(updatedDemoOrgs[0]).toMatchObject({ status: 'active' })
    })
  })

  describe('purge', () => {
    it('requires id', async () => {
      const res = makeRes()
      await handler(makeReq('POST', { action: 'purge' }), res)
      expect(res.statusCode).toBe(400)
    })

    it('hard-deletes the org and writes an audit row', async () => {
      const res = makeRes()
      await handler(makeReq('POST', { action: 'purge', id: 'org-1' }), res)
      expect(res.statusCode).toBe(200)
      expect(purgeDemoOrgMock).toHaveBeenCalledWith(expect.anything(), 'org-1')
      expect(res.body).toMatchObject({ success: true, schoolsDeleted: 1, learnersDeleted: 30 })
      expect(insertedEvents[0]).toMatchObject({ event_type: 'admin_demo_school_purged', payload: { actor_user_id: 'admin-1', demo_org_id: 'org-1' } })
    })

    it('500s when purge throws (e.g. org not yet expired)', async () => {
      purgeError = new Error('Demo org must be expired before it can be purged — expire it first')
      const res = makeRes()
      await handler(makeReq('POST', { action: 'purge', id: 'org-1' }), res)
      expect(res.statusCode).toBe(500)
      expect(res.body.error).toMatch(/must be expired/)
    })
  })
})
