import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-key'

let verifyAdminResult: any
vi.mock('../_utils/auth', () => ({
  verifyAdmin: vi.fn(async () => verifyAdminResult),
}))

const KNOWN_METRICS: Record<string, any> = {
  'schools.total': { slug: 'schools.total', label: 'Schools on platform', method: 'm', value: 11, asOf: '2026-07-15T00:00:00.000Z' },
}
vi.mock('../_utils/boardMetrics', () => ({
  resolveBoardMetric: vi.fn(async (_svc: any, slug: string) => KNOWN_METRICS[slug] ?? null),
}))

vi.mock('../_utils/codeGen', () => ({
  generateShareCode: vi.fn(() => 'fixed-share-code-123'),
}))

let snapshotRows: any[] = []
let insertedRows: any[] = []
let updateCalls: any[] = []

function makeChainable() {
  const builder: any = {
    select: () => builder,
    order: () => Promise.resolve({ data: snapshotRows, error: null }),
    insert: (obj: unknown) => { insertedRows.push(obj); return builder },
    update: (obj: unknown) => { updateCalls.push(obj); return builder },
    eq: (col: string, val: unknown) => {
      builder._eqCol = col
      builder._eqVal = val
      return builder
    },
    maybeSingle: () => {
      if (updateCalls.length > 0) {
        const found = snapshotRows.find(r => r.id === builder._eqVal)
        return Promise.resolve({ data: found ? { id: found.id } : null, error: null })
      }
      // uniqueness probe for share_code — always "free" in tests
      return Promise.resolve({ data: null, error: null })
    },
    single: () => {
      const last = insertedRows[insertedRows.length - 1]
      return Promise.resolve({
        data: { id: 'snap-1', created_at: '2026-07-15T00:00:00.000Z', ...last, payload: undefined },
        error: null,
      })
    },
  }
  return builder
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: () => makeChainable() }),
}))

let handler: typeof import('./board-snapshot').default

function makeReq(method: string, body?: unknown): VercelRequest {
  return { method, body, headers: { authorization: 'Bearer tok' } } as any
}

function makeRes(): VercelResponse & { statusCode?: number; body?: any } {
  const res: any = {}
  res.status = vi.fn((code: number) => { res.statusCode = code; return res })
  res.json = vi.fn((body: any) => { res.body = body; return res })
  return res
}

beforeEach(async () => {
  verifyAdminResult = { userId: 'admin-1' }
  snapshotRows = []
  insertedRows = []
  updateCalls = []
  handler = (await import('./board-snapshot')).default
})

describe('board-snapshot admin gate', () => {
  it('rejects a non-admin caller on GET', async () => {
    verifyAdminResult = { error: 'Requires SSi admin access', status: 403 }
    const res = makeRes()
    await handler(makeReq('GET'), res)
    expect(res.statusCode).toBe(403)
  })

  it('rejects a non-admin caller on freeze', async () => {
    verifyAdminResult = { error: 'Requires SSi admin access', status: 403 }
    const res = makeRes()
    await handler(makeReq('POST', { action: 'freeze', label: 'x', reportMonth: '2026-07', markdown: 'x' }), res)
    expect(res.statusCode).toBe(403)
  })
})

describe('POST freeze', () => {
  it('resolves known tokens and inserts a snapshot', async () => {
    const res = makeRes()
    await handler(makeReq('POST', {
      action: 'freeze',
      label: 'July 2026 board report',
      reportMonth: '2026-07',
      markdown: 'We have {{metric:schools.total}} schools.',
    }), res)
    expect(res.statusCode).toBe(201)
    expect(insertedRows).toHaveLength(1)
    expect(insertedRows[0].share_code).toBe('fixed-share-code-123')
    expect(insertedRows[0].payload.resolvedMetrics['schools.total'].value).toBe(11)
    expect(insertedRows[0].payload.markdown).toContain('{{metric:schools.total}}')
  })

  it('hard-fails on an unresolvable token and inserts nothing', async () => {
    const res = makeRes()
    await handler(makeReq('POST', {
      action: 'freeze',
      label: 'July 2026 board report',
      reportMonth: '2026-07',
      markdown: 'We have {{metric:ghost.metric}} things.',
    }), res)
    expect(res.statusCode).toBe(422)
    expect(res.body.unresolvable).toEqual(['ghost.metric'])
    expect(insertedRows).toHaveLength(0)
  })

  it('requires label, reportMonth, and markdown', async () => {
    const res = makeRes()
    await handler(makeReq('POST', { action: 'freeze' }), res)
    expect(res.statusCode).toBe(400)
    expect(insertedRows).toHaveLength(0)
  })
})

describe('POST revoke', () => {
  it('sets revoked_at on an existing snapshot', async () => {
    snapshotRows = [{ id: 'snap-1' }]
    const res = makeRes()
    await handler(makeReq('POST', { action: 'revoke', id: 'snap-1' }), res)
    expect(res.statusCode).toBe(200)
    expect(updateCalls[0].revoked_at).toBeTruthy()
  })

  it('404s for a nonexistent snapshot', async () => {
    snapshotRows = []
    const res = makeRes()
    await handler(makeReq('POST', { action: 'revoke', id: 'ghost' }), res)
    expect(res.statusCode).toBe(404)
  })

  it('requires an id', async () => {
    const res = makeRes()
    await handler(makeReq('POST', { action: 'revoke' }), res)
    expect(res.statusCode).toBe(400)
  })
})

describe('GET list', () => {
  it('lists snapshots without the payload column', async () => {
    snapshotRows = [{ id: 'snap-1', created_at: 'x', label: 'July', report_month: '2026-07', share_code: 'abc', revoked_at: null, created_by: 'admin-1' }]
    const res = makeRes()
    await handler(makeReq('GET'), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.snapshots).toHaveLength(1)
    expect(res.body.snapshots[0].payload).toBeUndefined()
  })
})

describe('invalid action', () => {
  it('rejects an unknown action', async () => {
    const res = makeRes()
    await handler(makeReq('POST', { action: 'bogus' }), res)
    expect(res.statusCode).toBe(400)
  })
})

describe('method guard', () => {
  it('rejects DELETE', async () => {
    const res = makeRes()
    await handler(makeReq('DELETE'), res)
    expect(res.statusCode).toBe(405)
  })
})
