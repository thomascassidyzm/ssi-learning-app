/**
 * SEC0901-B — api/me/standing.ts, the privacy/inference surface.
 *
 * standing.test.ts already pins the k-anonymity floor and the eligibility
 * filters (they exclude demo/internal/class-entity/tester/ssi_admin rows from
 * the COUNT as well as the distribution — that is the same array, filtered
 * once, so there is no separate-count/separate-distribution split to drift).
 * This file is the SECURITY read of the same endpoint: is auth enforced on
 * every path (including error paths), can an arbitrary `course` param be used
 * to probe a cohort the caller has no entitlement to, and does the response
 * ever carry anything more granular than the aggregate?
 *
 * All SECURE-ASSERTION — every control here holds today.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-key'

let authResult: { valid: boolean; userId?: string; error?: string }
vi.mock('../_utils/auth', () => ({
  verifyAuthToken: vi.fn(async () => authResult),
}))

let learnerRow: { id: string } | null
let enrollmentRows: { data: any[] | null; error: any }
/** Captures every `.eq()` call the handler makes against course_enrollments, so
 * a test can assert the caller-supplied `course` string reaches the query
 * ONLY as a bound filter value (never concatenated into anything). */
const eqCalls: Array<[string, unknown]> = []

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => {
      if (table === 'learners') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: learnerRow, error: null }) }) }) }
      }
      // course_enrollments
      return {
        select: () => ({
          eq: (col: string, val: unknown) => {
            eqCalls.push([col, val])
            return enrollmentRows
          },
        }),
      }
    },
  }),
}))

import handler from './standing'

function mockRes() {
  const res: any = { statusCode: 0, body: undefined }
  res.status = (c: number) => { res.statusCode = c; return res }
  res.json = (b: any) => { res.body = b; return res }
  return res as VercelResponse & { statusCode: number; body: any }
}

const req = (query: Record<string, unknown>, method = 'GET') =>
  ({ method, query, headers: {} }) as unknown as VercelRequest

const person = (id: string, seed: number, extra: Record<string, any> = {}) => ({
  learner_id: id,
  enrolled_at: '2026-04-10T00:00:00Z',
  highest_completed_lego_id: `S${String(seed).padStart(4, '0')}L01`,
  learners: { is_demo: false, is_internal: false, is_class_entity: false, platform_role: null, ...extra },
})

beforeEach(() => {
  authResult = { valid: true, userId: 'auth-1' }
  learnerRow = { id: 'me' }
  enrollmentRows = { data: null, error: null }
  eqCalls.length = 0
})

describe('SEC0901-B — auth enforcement', () => {
  it('401s an unauthenticated caller before touching the DB', async () => {
    authResult = { valid: false, error: 'Missing or invalid Authorization header' }
    const res = mockRes()
    await handler(req({ course: 'fra_for_eng' }), res)
    expect(res.statusCode).toBe(401)
    expect(res.body.standing).toBeUndefined()
  })

  it('401s when the token is structurally valid but carries no userId', async () => {
    authResult = { valid: true, userId: undefined }
    const res = mockRes()
    await handler(req({ course: 'fra_for_eng' }), res)
    expect(res.statusCode).toBe(401)
  })

  it('401 happens even with an empty/missing course — the auth gate runs FIRST', async () => {
    authResult = { valid: false, error: 'nope' }
    const res = mockRes()
    await handler(req({}), res)
    // Must not be the (also 200-shaped) "no-course" response for an
    // unauthenticated caller — that would mean the auth check was skipped.
    expect(res.statusCode).toBe(401)
  })

  it('rejects non-GET before doing any work', async () => {
    const res = mockRes()
    await handler(req({ course: 'fra_for_eng' }, 'POST'), res)
    expect(res.statusCode).toBe(405)
  })
})

describe('SEC0901-B — the course param cannot be used as an entitlement probe', () => {
  it('an arbitrary/nonexistent course code yields the SAME shape as a real course the caller has not started — no oracle for course existence', async () => {
    enrollmentRows = { data: [], error: null } // no rows for a bogus course_id
    const res = mockRes()
    await handler(req({ course: 'totally-made-up-course-xyz' }), res)
    expect(res.body).toEqual({ standing: null, reason: 'no-position' })
  })

  it('a course the caller is not enrolled in, but which is real and has other learners, still yields only "no-position" — never anyone else\'s data', async () => {
    enrollmentRows = {
      data: Array.from({ length: 40 }, (_, i) => person(`p${i}`, i + 1)),
      error: null,
    }
    const res = mockRes()
    await handler(req({ course: 'spa_for_eng' }), res)
    expect(res.body).toEqual({ standing: null, reason: 'no-position' })
  })

  it('the course string reaches the query only as a bound .eq() filter value, never string-built', async () => {
    enrollmentRows = { data: [], error: null }
    const res = mockRes()
    const hostile = "'; drop table course_enrollments; --"
    await handler(req({ course: hostile }), res)
    // The Supabase query builder receives it as an opaque parameter — this
    // asserts it reaches .eq() untouched (bound), which is what makes
    // string-concatenation-style injection structurally impossible here.
    expect(eqCalls).toContainEqual(['course_id', hostile])
    expect(res.statusCode).toBe(200)
  })

  it('an array-shaped course query param is coerced to no-course rather than passed through', async () => {
    const res = mockRes()
    await handler(req({ course: ['a', 'b'] as unknown as string }), res)
    expect(res.body).toEqual({ standing: null, reason: 'no-course' })
  })
})

describe('SEC0901-B — response never leaks more than the aggregate', () => {
  it('the payload never carries a peer list, any other learner_id, or raw positions', async () => {
    enrollmentRows = {
      data: [person('me', 21), ...Array.from({ length: 39 }, (_, i) => person(`p${i}`, i + 1))],
      error: null,
    }
    const res = mockRes()
    await handler(req({ course: 'cym_n_for_eng' }), res)
    const json = JSON.stringify(res.body)
    // No peer's learner_id should ever appear in the response.
    expect(json).not.toMatch(/"p\d+"/)
    expect(json).not.toContain('learner_id')
    expect(json).not.toContain('cohort":[')
  })
})

describe('SEC0901-B — eligibility filters apply to the COUNT, not just the distribution', () => {
  it('cohortSize reflects the eligible set only — excluded rows cannot inflate or shrink it silently', async () => {
    enrollmentRows = {
      data: [
        person('me', 21),
        ...Array.from({ length: 19 }, (_, i) => person(`real${i}`, i + 1)),
        ...Array.from({ length: 500 }, (_, i) => person(`demo${i}`, i + 1, { is_demo: true })),
      ],
      error: null,
    }
    const res = mockRes()
    await handler(req({ course: 'cym_n_for_eng' }), res)
    // 20 eligible (me + 19 real peers); the 500 demo rows must not appear in
    // cohortSize even though they were in the raw query result.
    expect(res.body.standing.cohortSize).toBe(20)
  })
})
