/**
 * Tests for GET /api/school/rate-compare — real class-vs-average rate data.
 * resolveVisibleScope + the analytics_class_sessions_scoped RPC are mocked;
 * the math itself is covered by api/_utils/rateCompare.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-key'

vi.mock('../_utils/auth', () => ({
  verifyAuthToken: vi.fn(async () => ({ valid: true, userId: 'teacher-1' })),
}))

let scope: any
vi.mock('../_utils/schoolScope', () => ({
  resolveVisibleScope: vi.fn(async () => scope),
}))

let classesRow: any
let schoolRow: any
let groupRow: any
let cohortClassRows: any[]
let rpcRows: any[]
let rpcError: any = null

function makeChainable(table: string) {
  const builder: any = {
    select: () => builder,
    eq: () => builder,
    neq: () => builder,
    in: () => builder,
    like: () => builder,
    limit: () => builder,
    maybeSingle: () => {
      if (table === 'classes') return Promise.resolve({ data: classesRow, error: null })
      if (table === 'schools') return Promise.resolve({ data: schoolRow, error: null })
      if (table === 'groups') return Promise.resolve({ data: groupRow, error: null })
      return Promise.resolve({ data: null, error: null })
    },
    then: (resolve: any) => {
      // Used for plain `.select().eq()...` cohort-listing queries (no maybeSingle/single).
      if (table === 'classes') return resolve({ data: cohortClassRows, error: null })
      if (table === 'groups') return resolve({ data: [], error: null })
      return resolve({ data: [], error: null })
    },
  }
  return builder
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => makeChainable(table),
    rpc: () => Promise.resolve({ data: rpcRows, error: rpcError }),
  }),
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

let handler: typeof import('./rate-compare').default

beforeEach(async () => {
  vi.resetModules()
  handler = (await import('./rate-compare')).default
  scope = { learnerId: 'l1', role: 'teacher', classIds: ['class-1'], learnerIds: [], studentsByClass: {} }
  classesRow = { id: 'class-1', class_name: 'Rang a Cúig', course_code: 'gle_for_eng', school_id: 'school-1' }
  schoolRow = { group_id: null }
  groupRow = null
  cohortClassRows = Array.from({ length: 6 }, (_, i) => ({ id: `cohort-${i}` }))
  rpcRows = []
  rpcError = null
})

describe('GET /api/school/rate-compare', () => {
  it('rejects a class_id outside the caller scope', async () => {
    const req = makeReq({ class_id: 'not-mine' })
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(403)
  })

  it('returns insufficientData when the school has no other classes to compare within', async () => {
    cohortClassRows = []
    const req = makeReq({ class_id: 'class-1', compare_to: 'school' })
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(200)
    expect(res.body.insufficientData).toBe(true)
    expect(res.body.kFloor).toBe(5)
  })

  it('returns insufficientData under the k-floor even when class ids exist but have no session activity', async () => {
    // 6 cohort classes exist, but none appear in the RPC rows (no activity) -> 0 active.
    rpcRows = [{ class_id: 'class-1', course_code: 'gle_for_eng', start_ord: 1, end_ord: 10, start_lego_id: 'S1L01', end_lego_id: 'S2L10', duration_seconds: 600, started_at: new Date().toISOString() }]
    const req = makeReq({ class_id: 'class-1', compare_to: 'school' })
    const res = makeRes()
    await handler(req, res)
    expect(res.body.insufficientData).toBe(true)
  })

  it('computes a real entity-vs-average comparison once the k-floor is met', async () => {
    const now = new Date()
    const rows: any[] = [
      { class_id: 'class-1', course_code: 'gle_for_eng', start_ord: 1, end_ord: 20, start_lego_id: 'S1L01', end_lego_id: 'S3L20', duration_seconds: 6000, started_at: now.toISOString() },
    ]
    // 5 active cohort classes at varying paces, meeting K_FLOOR=5.
    for (let i = 0; i < 5; i++) {
      rows.push({
        class_id: `cohort-${i}`,
        course_code: 'gle_for_eng',
        start_ord: 1,
        end_ord: 10 + i,
        start_lego_id: 'S1L01',
        end_lego_id: `S2L${10 + i}`,
        duration_seconds: 3000,
        started_at: now.toISOString(),
      })
    }
    rpcRows = rows
    const req = makeReq({ class_id: 'class-1', compare_to: 'school' })
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(200)
    expect(res.body.insufficientData).toBe(false)
    expect(res.body.cohortSize).toBe(5)
    expect(res.body.entity.label).toBe('Rang a Cúig')
    expect(res.body.average.label).toBe('School average')
    expect(res.body.distribution.values).toHaveLength(5)
    // Never leaks another class's identity — only the aggregate label + numbers.
    expect(JSON.stringify(res.body)).not.toContain('cohort-0')
  })

  it('rejects compare_to=school for a class with no school (nothing to compare within)', async () => {
    classesRow = { id: 'class-1', class_name: 'Solo tutor class', course_code: 'gle_for_eng', school_id: null }
    const req = makeReq({ class_id: 'class-1', compare_to: 'school' })
    const res = makeRes()
    await handler(req, res)
    expect(res.body.insufficientData).toBe(true)
    expect(res.body.reason).toMatch(/no school/i)
  })
})
