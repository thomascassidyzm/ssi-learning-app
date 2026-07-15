import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-key'

let verifyAdminResult: any
vi.mock('../_utils/auth', () => ({
  verifyAdmin: vi.fn(async () => verifyAdminResult),
}))

vi.mock('../_utils/boardMetrics', () => ({
  resolveAllBoardMetrics: vi.fn(async () => [
    { slug: 'learners.active_30d', label: 'Active learners (30d)', method: 'm', value: 73, asOf: '2026-07-15T00:00:00.000Z' },
    { slug: 'minutes.total_30d', label: 'Practice minutes (30d)', method: 'm', value: 26751, asOf: '2026-07-15T00:00:00.000Z' },
    { slug: 'schools.total', label: 'Schools on platform', method: 'm', value: 11, asOf: '2026-07-15T00:00:00.000Z' },
  ]),
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({}),
}))

let handler: typeof import('./board-metrics').default

function makeReq(method: string): VercelRequest {
  return { method, headers: { authorization: 'Bearer tok' } } as any
}

function makeRes(): VercelResponse & { statusCode?: number; body?: any } {
  const res: any = {}
  res.status = vi.fn((code: number) => { res.statusCode = code; return res })
  res.json = vi.fn((body: any) => { res.body = body; return res })
  return res
}

beforeEach(async () => {
  verifyAdminResult = { userId: 'admin-1' }
  handler = (await import('./board-metrics')).default
})

describe('GET /api/admin/board-metrics', () => {
  it('rejects a non-GET method', async () => {
    const req = makeReq('POST')
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(405)
  })

  it('rejects a non-admin caller', async () => {
    verifyAdminResult = { error: 'Requires SSi admin access', status: 403 }
    const req = makeReq('GET')
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(403)
  })

  it('returns all resolved metrics for an admin caller', async () => {
    const req = makeReq('GET')
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(200)
    expect(res.body.metrics).toHaveLength(3)
    expect(res.body.metrics.map((m: any) => m.slug).sort()).toEqual([
      'learners.active_30d', 'minutes.total_30d', 'schools.total',
    ])
  })
})
