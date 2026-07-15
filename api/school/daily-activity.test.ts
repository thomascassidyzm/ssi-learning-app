/**
 * Tests for GET /api/school/daily-activity, focused on the coverage gate
 * (docs/schools/group-commercial-model.md, "Server-side enforcement of (4)").
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-key'

vi.mock('../_utils/auth', () => ({
  verifyAuthToken: vi.fn(async () => ({ valid: true, userId: 'caller-1' })),
}))

let scope: any
vi.mock('../_utils/schoolScope', () => ({
  resolveVisibleScope: vi.fn(async () => scope),
  chunk: (arr: any[], size = 150) => {
    const out = []
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
    return out
  },
}))

let DB: { classes: any[]; schools: any[]; learner_speaking_opportunities: any[] }

function makeChainable(table: string) {
  let rows: any[] = [...((DB as any)[table] ?? [])]
  const builder: any = {
    select: () => builder,
    eq: () => builder,
    in: (col: string, vals: unknown[]) => { rows = rows.filter((r) => vals.includes(r[col])); return builder },
    gte: () => builder,
    then: (resolve: any) => Promise.resolve({ data: rows, error: null }).then(resolve),
  }
  return builder
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: (table: string) => makeChainable(table) }),
}))

function makeReq(query: Record<string, string>): VercelRequest {
  return { method: 'GET', query, headers: { authorization: 'Bearer tok' } } as any
}

function makeRes(): VercelResponse & { statusCode?: number; body?: any } {
  const res: any = {}
  res.setHeader = vi.fn()
  res.status = vi.fn((code: number) => { res.statusCode = code; return res })
  res.json = vi.fn((body: any) => { res.body = body; return res })
  return res
}

let handler: typeof import('./daily-activity').default

beforeEach(async () => {
  vi.resetModules()
  handler = (await import('./daily-activity')).default
  DB = {
    classes: [{ id: 'c1', school_id: 's1' }],
    schools: [{ id: 's1', platform_status: 'trial', platform_expires_at: null }],
    learner_speaking_opportunities: [{ learner_id: 'l1', day: '2026-07-10', play_seconds: 120, opportunities: 5 }],
  }
  scope = {
    learnerId: 'l1', role: 'school_admin', classIds: ['c1'], learnerIds: ['l1'],
    studentsByClass: { c1: ['l1'] }, schoolIds: ['s1'], groupId: null,
  }
})

describe('GET /api/school/daily-activity — coverage gate', () => {
  it('returns activity data as normal while the school is on a live trial', async () => {
    const req = makeReq({})
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(200)
    expect(res.body.activity).toHaveLength(1)
    expect(res.body.activity[0].active_students).toBe(1)
  })

  it('403s coverage_expired once the school\'s coverage has lapsed', async () => {
    DB.schools[0].platform_status = 'expired'
    const req = makeReq({})
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(403)
    expect(res.body.error).toBe('coverage_expired')
  })

  it('is never gated for a govt_admin scope — group rollups stay intact', async () => {
    DB.schools[0].platform_status = 'expired'
    scope = { ...scope, role: 'govt_admin', schoolIds: ['s1'] }
    const req = makeReq({})
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(200)
    expect(res.body.activity).toHaveLength(1)
  })

  it('a teacher spanning two schools only loses the expired school\'s activity', async () => {
    DB.classes.push({ id: 'c2', school_id: 's2' })
    DB.schools.push({ id: 's2', platform_status: 'expired', platform_expires_at: null })
    DB.learner_speaking_opportunities.push({ learner_id: 'l2', day: '2026-07-10', play_seconds: 999, opportunities: 9 })
    scope = {
      learnerId: 'l1', role: 'teacher', classIds: ['c1', 'c2'], learnerIds: ['l1', 'l2'],
      studentsByClass: { c1: ['l1'], c2: ['l2'] }, schoolIds: [], groupId: null,
    }
    const req = makeReq({})
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(200)
    expect(res.body.activity[0].practice_minutes).toBe(2) // only l1's 120s, not l2's 999s
  })
})
