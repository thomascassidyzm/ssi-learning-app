import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-key'

let row: any = null

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: row, error: null }),
        }),
      }),
    }),
  }),
}))

let handler: typeof import('./[code]').default

function makeReq(method: string, code?: string): VercelRequest {
  return { method, query: { code }, headers: {} } as any
}

function makeRes(): VercelResponse & { statusCode?: number; body?: any } {
  const res: any = {}
  res.status = vi.fn((c: number) => { res.statusCode = c; return res })
  res.json = vi.fn((b: any) => { res.body = b; return res })
  return res
}

beforeEach(async () => {
  row = null
  handler = (await import('./[code]')).default
})

describe('GET /api/board/snapshot/:code', () => {
  it('rejects a non-GET method', async () => {
    const res = makeRes()
    await handler(makeReq('POST', 'abc'), res)
    expect(res.statusCode).toBe(405)
  })

  it('requires a code', async () => {
    const res = makeRes()
    await handler(makeReq('GET', undefined), res)
    expect(res.statusCode).toBe(400)
  })

  it('404s for a missing code', async () => {
    row = null
    const res = makeRes()
    await handler(makeReq('GET', 'ghost'), res)
    expect(res.statusCode).toBe(404)
  })

  it('404s for a revoked snapshot', async () => {
    row = { label: 'July', report_month: '2026-07', payload: { markdown: 'x' }, revoked_at: '2026-07-15T00:00:00.000Z' }
    const res = makeRes()
    await handler(makeReq('GET', 'abc'), res)
    expect(res.statusCode).toBe(404)
  })

  it('serves the frozen payload for a live snapshot', async () => {
    row = {
      label: 'July 2026 board report',
      report_month: '2026-07',
      payload: {
        markdown: 'We have {{metric:schools.total}} schools.',
        resolvedMetrics: { 'schools.total': { slug: 'schools.total', value: 11 } },
        frozenAt: '2026-07-15T00:00:00.000Z',
      },
      revoked_at: null,
    }
    const res = makeRes()
    await handler(makeReq('GET', 'abc'), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.label).toBe('July 2026 board report')
    expect(res.body.markdown).toContain('{{metric:schools.total}}')
    expect(res.body.resolvedMetrics['schools.total'].value).toBe(11)
  })
})
