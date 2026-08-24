import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-key'

vi.mock('../_utils/auth', () => ({
  verifyAuthToken: vi.fn(async () => ({ valid: true, userId: 'auth-1' })),
}))

let learnerRow: { id: string } | null
let enrollments: { data: any; error: any }
/** course_code -> the (seed, index) filter the handler asked for, and the count to return. */
let legoCounts: Record<string, number>
let capturedFilters: Array<{ course: string; isNew: boolean; or: string }>

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => {
      if (table === 'learners') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: learnerRow, error: null }) }) }),
        }
      }
      if (table === 'course_enrollments') {
        return { select: () => ({ eq: async () => enrollments }) }
      }
      // course_legos — records the filter chain, resolves to a count.
      let course = ''
      let isNew = false
      const builder: any = {
        eq: (col: string, val: any) => {
          if (col === 'course_code') course = val
          if (col === 'is_new') isNew = val
          return builder
        },
        or: async (expr: string) => {
          capturedFilters.push({ course, isNew, or: expr })
          const count = legoCounts[course]
          if (count === undefined) return { count: null, error: { message: 'no such course' } }
          return { count, error: null }
        },
      }
      return { select: () => builder }
    },
  }),
}))

let handler: typeof import('./legos-learnt').default
let parseLegoCursor: typeof import('./legos-learnt').parseLegoCursor

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
  capturedFilters = []
  legoCounts = {}
  const mod = await import('./legos-learnt')
  handler = mod.default
  parseLegoCursor = mod.parseLegoCursor
})

describe('parseLegoCursor', () => {
  it('reads the seed and lego index out of a cursor id', () => {
    expect(parseLegoCursor('S0280L01')).toEqual({ seed: 280, index: 1 })
    expect(parseLegoCursor('S0668L02')).toEqual({ seed: 668, index: 2 })
  })

  it('returns null for anything that is not a lego cursor', () => {
    expect(parseLegoCursor(null)).toBeNull()
    expect(parseLegoCursor('')).toBeNull()
    expect(parseLegoCursor('S280L1')).toBeNull()
    expect(parseLegoCursor('not-a-cursor')).toBeNull()
  })
})

describe('GET /api/me/legos-learnt', () => {
  it('rejects a non-GET method', async () => {
    const res = makeRes()
    await handler({ ...makeReq(), method: 'POST' }, res)
    expect(res.statusCode).toBe(405)
  })

  it('sums DISTINCT introduced LEGOs across every course, not just the active one', async () => {
    enrollments = {
      data: [
        { course_id: 'zho_for_eng', last_completed_lego_id: 'S0280L01' },
        { course_id: 'deu_for_eng', last_completed_lego_id: 'S0668L02' },
        { course_id: 'fra_for_eng', last_completed_lego_id: 'S0021L02' },
      ],
      error: null,
    }
    legoCounts = { zho_for_eng: 457, deu_for_eng: 1395, fra_for_eng: 67 }
    const res = makeRes()
    await handler(makeReq(), res)
    expect(res.body).toEqual({ legosLearnt: 457 + 1395 + 67, courses: 3 })
  })

  it('counts only introducing rows, and only up to the cursor within its own seed', async () => {
    enrollments = {
      data: [{ course_id: 'zho_for_eng', last_completed_lego_id: 'S0280L01' }],
      error: null,
    }
    legoCounts = { zho_for_eng: 457 }
    await handler(makeReq(), makeRes())
    expect(capturedFilters).toHaveLength(1)
    // is_new = true is what makes the count DISTINCT — a later non-introducing
    // row is a re-encounter of a LEGO already taught, not new material.
    expect(capturedFilters[0].isNew).toBe(true)
    expect(capturedFilters[0].or).toBe(
      'seed_number.lt.280,and(seed_number.eq.280,lego_index.lte.1)'
    )
  })

  it('ignores enrollments with no cursor rather than counting them as zero-progress', async () => {
    enrollments = {
      data: [
        { course_id: 'zho_for_eng', last_completed_lego_id: 'S0280L01' },
        { course_id: 'ita_for_eng', last_completed_lego_id: null },
      ],
      error: null,
    }
    legoCounts = { zho_for_eng: 457 }
    const res = makeRes()
    await handler(makeReq(), res)
    expect(capturedFilters.map((f) => f.course)).toEqual(['zho_for_eng'])
    expect(res.body).toEqual({ legosLearnt: 457, courses: 1 })
  })

  it('a learner with no enrollments reads 0, not an error', async () => {
    enrollments = { data: [], error: null }
    const res = makeRes()
    await handler(makeReq(), res)
    expect(res.body).toEqual({ legosLearnt: 0, courses: 0 })
  })

  it('no learner row -> 0', async () => {
    learnerRow = null
    const res = makeRes()
    await handler(makeReq(), res)
    expect(res.body).toEqual({ legosLearnt: 0, courses: 0 })
  })

  it('an enrollments failure returns null (unknown), never a wrong number', async () => {
    enrollments = { data: null, error: { message: 'boom' } }
    const res = makeRes()
    await handler(makeReq(), res)
    expect(res.body).toEqual({ legosLearnt: null })
  })

  it('one course failing to count does not sink the whole total', async () => {
    enrollments = {
      data: [
        { course_id: 'zho_for_eng', last_completed_lego_id: 'S0280L01' },
        { course_id: 'gone_for_eng', last_completed_lego_id: 'S0010L01' },
      ],
      error: null,
    }
    legoCounts = { zho_for_eng: 457 }
    const res = makeRes()
    await handler(makeReq(), res)
    expect(res.body).toEqual({ legosLearnt: 457, courses: 1 })
  })
})
