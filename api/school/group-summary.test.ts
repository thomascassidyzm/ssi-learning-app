/**
 * Tests for GET /api/school/group-summary — the server-mediated read that
 * fixes the "group dashboard shows zeros" bug (group_summary/school_summary
 * are RLS-invoker views that LATERAL-join user_tags, which has no govt_admin
 * SELECT branch; a direct client read as the group leader's own session
 * silently zeroed every teacher/student/hours count). resolveVisibleScope is
 * mocked — authorization itself is that function's own responsibility/tests.
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

let DB: { group_summary: any[]; school_summary: any[]; class_activity_stats: any[] }

function makeChainable(table: string) {
  let rows: any[] = [...((DB as any)[table] ?? [])]
  let single = false
  const builder: any = {
    select: () => builder,
    eq: (col: string, val: unknown) => { rows = rows.filter((r) => r[col] === val); return builder },
    in: (col: string, vals: unknown[]) => { rows = rows.filter((r) => vals.includes(r[col])); return builder },
    order: () => builder,
    maybeSingle: () => { single = true; return builder },
    then: (resolve: any) => Promise.resolve({ data: single ? (rows[0] ?? null) : rows, error: null }).then(resolve),
  }
  return builder
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: (table: string) => makeChainable(table) }),
}))

function makeReq(): VercelRequest {
  return { method: 'GET', query: {}, headers: { authorization: 'Bearer tok' } } as any
}

function makeRes(): VercelResponse & { statusCode?: number; body?: any } {
  const res: any = {}
  res.setHeader = vi.fn()
  res.status = vi.fn((code: number) => { res.statusCode = code; return res })
  res.json = vi.fn((body: any) => { res.body = body; return res })
  return res
}

let handler: typeof import('./group-summary').default

beforeEach(async () => {
  vi.resetModules()
  handler = (await import('./group-summary')).default
  DB = {
    group_summary: [{ group_id: 'g1', group_name: 'IME Demo Programme', school_count: 3, teacher_count: 5, student_count: 80, total_practice_hours: 256.6 }],
    school_summary: [
      { school_id: 's1', school_name: 'Sunrise', group_id: 'g1', admin_user_id: 'u1', teacher_count: 3, class_count: 3, student_count: 42, total_practice_hours: 129.9, has_admin: true },
      { school_id: 's2', school_name: 'Green Valley', group_id: 'g1', admin_user_id: null, teacher_count: 0, class_count: 0, student_count: 0, total_practice_hours: 0, has_admin: false },
    ],
    class_activity_stats: [
      { school_id: 's1', active_days_last_7: 5 },
      { school_id: 's1', active_days_last_7: 2 },
    ],
  }
  scope = { learnerId: 'l1', role: 'govt_admin', classIds: [], learnerIds: [], studentsByClass: {}, schoolIds: ['s1', 's2'], groupId: 'g1' }
})

describe('GET /api/school/group-summary', () => {
  it('returns the group rollup + per-school rows for a govt_admin', async () => {
    const req = makeReq()
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(200)
    expect(res.body.group.student_count).toBe(80)
    expect(res.body.schools).toHaveLength(2)
    expect(res.body.schools.find((s: any) => s.school_id === 's1').student_count).toBe(42)
  })

  it('takes the max active_days_last_7 across a school\'s classes', async () => {
    const req = makeReq()
    const res = makeRes()
    await handler(req, res)
    expect(res.body.schools.find((s: any) => s.school_id === 's1').active_days_last_7).toBe(5)
    expect(res.body.schools.find((s: any) => s.school_id === 's2').active_days_last_7).toBe(0)
  })

  it('403s a non-govt_admin caller', async () => {
    scope = { ...scope, role: 'teacher', groupId: null }
    const req = makeReq()
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(403)
  })

  it('401s an unauthenticated caller', async () => {
    const { verifyAuthToken } = await import('../_utils/auth')
    ;(verifyAuthToken as any).mockResolvedValueOnce({ valid: false, error: 'no token' })
    const req = makeReq()
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(401)
  })

  it('405s a non-GET request', async () => {
    const req = { ...makeReq(), method: 'POST' } as any
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(405)
  })
})
