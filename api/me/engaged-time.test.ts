import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-key'

vi.mock('../_utils/auth', () => ({
  verifyAuthToken: vi.fn(async () => ({ valid: true, userId: 'auth-1' })),
}))

let learnerRow: { id: string } | null
/** Every learner_speaking_opportunities row the mock ledger holds. */
let ledgerRows: Array<{ play_seconds: number }>
let ledgerError: any
/** Tables the handler actually read — proves the retired RPC is gone. */
let tablesRead: string[]
let rangesRequested: Array<[number, number]>

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => {
      tablesRead.push(table)
      if (table === 'learners') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: learnerRow, error: null }) }) }) }
      }
      return {
        select: () => ({
          eq: () => ({
            range: async (from: number, to: number) => {
              rangesRequested.push([from, to])
              if (ledgerError) return { data: null, error: ledgerError }
              return { data: ledgerRows.slice(from, to + 1), error: null }
            },
          }),
        }),
      }
    },
    rpc: vi.fn(async () => {
      throw new Error('admin_practice_minutes must not be called — Total Time is playback time now')
    }),
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
  ledgerRows = []
  ledgerError = null
  tablesRead = []
  rangesRequested = []
  handler = (await import('./engaged-time')).default
})

describe('GET /api/me/engaged-time', () => {
  it('rejects a non-GET method', async () => {
    const res = makeRes()
    await handler({ ...makeReq(), method: 'POST' }, res)
    expect(res.statusCode).toBe(405)
  })

  it('sums measured PLAYBACK seconds from the ledger, not wall-clock session spans', async () => {
    ledgerRows = [{ play_seconds: 1800 }, { play_seconds: 900 }, { play_seconds: 300 }]
    const res = makeRes()
    await handler(makeReq(), res)
    expect(res.body).toEqual({ engagedMinutes: 50, isEstimated: false })
    expect(tablesRead).toContain('learner_speaking_opportunities')
  })

  it('never reads the retired wall-clock source — that is the whole point of the change', async () => {
    // sessions.duration_seconds / admin_practice_minutes counted every idle
    // minute a tab sat open; one owner row claimed 128 hours with zero items
    // practised. Reading it again from here would silently reinstate that.
    ledgerRows = [{ play_seconds: 60 }]
    await handler(makeReq(), makeRes())
    expect(tablesRead).not.toContain('sessions')
  })

  it('is never flagged estimated: measured playback is not derived from position', async () => {
    ledgerRows = [{ play_seconds: 7 }]
    const res = makeRes()
    await handler(makeReq(), res)
    expect(res.body.isEstimated).toBe(false)
  })

  it('rounds down to whole minutes rather than rounding a part-minute up', async () => {
    ledgerRows = [{ play_seconds: 119 }]
    const res = makeRes()
    await handler(makeReq(), res)
    expect(res.body.engagedMinutes).toBe(1)
  })

  it('a learner who has never played reads 0, not null', async () => {
    ledgerRows = []
    const res = makeRes()
    await handler(makeReq(), res)
    expect(res.body).toEqual({ engagedMinutes: 0, isEstimated: false })
  })

  it('paginates past the page cap instead of silently truncating a long history', async () => {
    // One row per course per day: a committed learner passes 1000 rows inside
    // a year, and an unpaginated read would quietly under-report from then on.
    ledgerRows = Array.from({ length: 2300 }, () => ({ play_seconds: 60 }))
    const res = makeRes()
    await handler(makeReq(), res)
    expect(res.body.engagedMinutes).toBe(2300)
    expect(rangesRequested.length).toBeGreaterThan(2)
  })

  it('fails soft (null minutes) when the ledger read errors, without claiming a number', async () => {
    ledgerError = { message: 'ledger boom' }
    const res = makeRes()
    await handler(makeReq(), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.engagedMinutes).toBeNull()
  })

  it('returns 0 minutes for a caller with no learner row', async () => {
    learnerRow = null
    const res = makeRes()
    await handler(makeReq(), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.engagedMinutes).toBe(0)
  })
})
