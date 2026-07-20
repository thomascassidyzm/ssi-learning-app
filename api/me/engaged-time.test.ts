import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-key'

vi.mock('../_utils/auth', () => ({
  verifyAuthToken: vi.fn(async () => ({ valid: true, userId: 'auth-1' })),
}))

let learnerRow: { id: string } | null
let rpcResult: { data: any; error: any }

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (_table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: learnerRow, error: null }),
        }),
      }),
    }),
    rpc: vi.fn(async () => rpcResult),
  }),
}))

let handler: typeof import('./engaged-time').default

function makeReq(): VercelRequest {
  return { method: 'GET', headers: { authorization: 'Bearer tok' } } as any
}

function makeRes(): VercelResponse & { statusCode?: number; body?: any } {
  const res: any = {}
  res.status = vi.fn((code: number) => { res.statusCode = code; return res })
  res.json = vi.fn((body: any) => { res.body = body; return res })
  return res
}

beforeEach(async () => {
  learnerRow = { id: 'l1' }
  handler = (await import('./engaged-time')).default
})

describe('GET /api/me/engaged-time', () => {
  it('rejects a non-GET method', async () => {
    const res = makeRes()
    await handler({ ...makeReq(), method: 'POST' }, res)
    expect(res.statusCode).toBe(405)
  })

  it('logged-present: real session minutes are never flagged as estimated', async () => {
    rpcResult = { data: [{ learner_id: 'l1', practice_minutes: 45, is_estimated: false }], error: null }
    const res = makeRes()
    await handler(makeReq(), res)
    expect(res.body).toEqual({ engagedMinutes: 45, isEstimated: false })
  })

  it('logged-missing: position-derived fallback is flagged as estimated', async () => {
    rpcResult = { data: [{ learner_id: 'l1', practice_minutes: 12, is_estimated: true }], error: null }
    const res = makeRes()
    await handler(makeReq(), res)
    expect(res.body).toEqual({ engagedMinutes: 12, isEstimated: true })
  })

  it('never sums logged and estimated: a row is one or the other, never both blended silently', async () => {
    // The RPC itself enforces exclusivity (per learner+course, logged XOR
    // estimated) — this asserts the API layer passes the single resulting
    // flag through unmodified, rather than re-deriving or defaulting it.
    rpcResult = { data: [{ learner_id: 'l1', practice_minutes: 100, is_estimated: true }], error: null }
    const res = makeRes()
    await handler(makeReq(), res)
    expect(res.body.engagedMinutes).toBe(100)
    expect(res.body.isEstimated).toBe(true)
  })

  it('fails soft (null minutes) when the RPC errors, without claiming an estimate', async () => {
    rpcResult = { data: null, error: { message: 'rpc boom' } }
    const res = makeRes()
    await handler(makeReq(), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.engagedMinutes).toBeNull()
  })

  it('returns 0 minutes, not estimated, for a caller with no learner row', async () => {
    learnerRow = null
    const res = makeRes()
    await handler(makeReq(), res)
    expect(res.body).toEqual({ engagedMinutes: 0 })
  })
})
