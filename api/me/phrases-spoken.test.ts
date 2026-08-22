import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-key'

vi.mock('../_utils/auth', () => ({
  verifyAuthToken: vi.fn(async () => ({ valid: true, userId: 'auth-1' })),
}))

let learnerRow: { id: string } | null
/** Every ledger row the fake DB holds for the queried learner. */
let ledgerRows: Array<{ course_code: string; phrases_spoken: number }>
let ledgerError: any
/** What the handler actually asked the ledger for. */
let capturedQuery: { learnerId?: string; gtCol?: string; gtVal?: any; ranges: Array<[number, number]> }

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => {
      if (table === 'learners') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: learnerRow, error: null }) }) }),
        }
      }
      // learner_speaking_opportunities
      const builder: any = {
        eq: (col: string, val: any) => {
          if (col === 'learner_id') capturedQuery.learnerId = val
          return builder
        },
        gt: (col: string, val: any) => {
          capturedQuery.gtCol = col
          capturedQuery.gtVal = val
          return builder
        },
        range: async (from: number, to: number) => {
          capturedQuery.ranges.push([from, to])
          if (ledgerError) return { data: null, error: ledgerError }
          return { data: ledgerRows.slice(from, to + 1), error: null }
        },
      }
      return { select: () => builder }
    },
  }),
}))

let handler: typeof import('./phrases-spoken').default

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
  capturedQuery = { ranges: [] }
  handler = (await import('./phrases-spoken')).default
})

describe('GET /api/me/phrases-spoken', () => {
  it('rejects a non-GET method', async () => {
    const res = makeRes()
    await handler({ ...makeReq(), method: 'POST' }, res)
    expect(res.statusCode).toBe(405)
  })

  it('sums LIFETIME across every course — no window, no course filter', async () => {
    ledgerRows = [
      { course_code: 'zho_for_eng', phrases_spoken: 40 },
      { course_code: 'cym_s_for_eng', phrases_spoken: 12 },
      // a second day of the same course — days accumulate, they do not replace
      { course_code: 'zho_for_eng', phrases_spoken: 8 },
    ]
    const res = makeRes()
    await handler(makeReq(), res)
    expect(res.body).toEqual({ phrasesSpoken: 60, courses: 2 })
  })

  it('scopes the read to the caller\'s own learner id and only speech-bearing days', async () => {
    ledgerRows = [{ course_code: 'zho_for_eng', phrases_spoken: 3 }]
    await handler(makeReq(), makeRes())
    expect(capturedQuery.learnerId).toBe('l1')
    expect(capturedQuery.gtCol).toBe('phrases_spoken')
    expect(capturedQuery.gtVal).toBe(0)
  })

  it('a learner who has never run the mic reads 0, which is an honest zero', async () => {
    ledgerRows = []
    const res = makeRes()
    await handler(makeReq(), res)
    expect(res.body).toEqual({ phrasesSpoken: 0, courses: 0 })
  })

  it('no learner row -> 0', async () => {
    learnerRow = null
    const res = makeRes()
    await handler(makeReq(), res)
    expect(res.body).toEqual({ phrasesSpoken: 0, courses: 0 })
  })

  it('a ledger failure returns null (unknown), never a wrong number', async () => {
    ledgerError = { message: 'boom' }
    const res = makeRes()
    await handler(makeReq(), res)
    expect(res.body).toEqual({ phrasesSpoken: null })
  })

  it('pages past the first 1000 rows rather than truncating the lifetime total', async () => {
    ledgerRows = Array.from({ length: 1500 }, (_, i) => ({
      course_code: `c${i % 3}`,
      phrases_spoken: 2,
    }))
    const res = makeRes()
    await handler(makeReq(), res)
    expect(capturedQuery.ranges).toEqual([[0, 999], [1000, 1999]])
    expect(res.body).toEqual({ phrasesSpoken: 3000, courses: 3 })
  })

  it('stops after one page when the page comes back short', async () => {
    ledgerRows = [{ course_code: 'a', phrases_spoken: 1 }]
    await handler(makeReq(), makeRes())
    expect(capturedQuery.ranges).toEqual([[0, 999]])
  })
})
