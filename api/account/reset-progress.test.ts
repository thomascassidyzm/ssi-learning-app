/**
 * Tests for POST /api/account/reset-progress — server-mediated course
 * progress reset. Covers: caller-only scope, that the scoped tables are
 * actually cleared (not silently permission-denied), and that
 * course_enrollments gets the same reset payload the old client write used.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-key'

let authUserId: string
vi.mock('../_utils/auth', () => ({
  verifyAuthToken: vi.fn(async () => ({ valid: true, userId: authUserId })),
}))

type Row = { learner_id: string; course_id: string; [k: string]: any }
let DB: {
  learners: Array<{ id: string; user_id: string }>
  response_metrics: Row[]
  spike_events: Row[]
  lego_progress: Row[]
  seed_progress: Row[]
  sessions: Row[]
  course_enrollments: Row[]
}

function makeChainable(table: string) {
  let rows: any[] = [...((DB as any)[table] ?? [])]
  const builder: any = {
    select() { return builder },
    eq(col: string, val: unknown) { rows = rows.filter((r: any) => r[col] === val); return builder },
    async maybeSingle() {
      return { data: rows[0] ?? null, error: null }
    },
    delete() {
      const filters: Array<[string, unknown]> = []
      const deleteBuilder: any = {
        eq(col: string, val: unknown) {
          filters.push([col, val])
          return deleteBuilder
        },
        then(resolve: any) {
          const matches = (r: any) => filters.every(([col, val]) => r[col] === val)
          ;(DB as any)[table] = ((DB as any)[table] as any[]).filter((r) => !matches(r))
          resolve({ data: null, error: null })
        },
      }
      return deleteBuilder
    },
    update(patch: any) {
      const filters: Array<[string, unknown]> = []
      const updateBuilder: any = {
        eq(col: string, val: unknown) {
          filters.push([col, val])
          return updateBuilder
        },
        then(resolve: any) {
          const matches = (r: any) => filters.every(([col, val]) => r[col] === val)
          ;((DB as any)[table] as any[]).filter(matches).forEach((r) => Object.assign(r, patch))
          resolve({ data: null, error: null })
        },
      }
      return updateBuilder
    },
  }
  return builder
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: (table: string) => makeChainable(table) }),
}))

function makeReq(body: any): VercelRequest {
  return { method: 'POST', body, headers: { authorization: 'Bearer tok' } } as any
}

function makeRes(): VercelResponse & { statusCode?: number; body?: any } {
  const res: any = {}
  res.status = vi.fn((code: number) => { res.statusCode = code; return res })
  res.json = vi.fn((body: any) => { res.body = body; return res })
  return res
}

let handler: typeof import('./reset-progress').default

beforeEach(async () => {
  vi.resetModules()
  handler = (await import('./reset-progress')).default
  DB = {
    learners: [{ id: 'learner-1', user_id: 'user-a' }],
    response_metrics: [
      { learner_id: 'learner-1', course_id: 'fra_for_eng' },
      { learner_id: 'learner-1', course_id: 'spa_for_eng' },
    ],
    spike_events: [{ learner_id: 'learner-1', course_id: 'fra_for_eng' }],
    lego_progress: [{ learner_id: 'learner-1', course_id: 'fra_for_eng' }],
    seed_progress: [{ learner_id: 'learner-1', course_id: 'fra_for_eng' }],
    sessions: [{ learner_id: 'learner-1', course_id: 'fra_for_eng' }],
    course_enrollments: [{ learner_id: 'learner-1', course_id: 'fra_for_eng', total_practice_minutes: 120, highest_completed_seed: 40 }],
  }
})

describe('POST /api/account/reset-progress', () => {
  it('clears the scoped tables for the given course only, and zeroes course_enrollments', async () => {
    authUserId = 'user-a'
    const res = makeRes()
    await handler(makeReq({ course_code: 'fra_for_eng' }), res)
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ ok: true })
    expect(DB.spike_events).toHaveLength(0)
    expect(DB.lego_progress).toHaveLength(0)
    expect(DB.seed_progress).toHaveLength(0)
    expect(DB.sessions).toHaveLength(0)
    // Other-course rows in the same table are untouched.
    expect(DB.response_metrics).toEqual([{ learner_id: 'learner-1', course_id: 'spa_for_eng' }])
    expect(DB.course_enrollments[0].total_practice_minutes).toBe(0)
    expect(DB.course_enrollments[0].highest_completed_seed).toBe(0)
  })

  it('ignores any learner_id in the body — always scopes to the caller\'s own learner row', async () => {
    authUserId = 'user-a'
    DB.learners.push({ id: 'learner-2', user_id: 'someone-else' })
    DB.sessions.push({ learner_id: 'learner-2', course_id: 'fra_for_eng' })
    const res = makeRes()
    await handler(makeReq({ course_code: 'fra_for_eng', learner_id: 'learner-2' }), res)
    expect(res.statusCode).toBe(200)
    expect(DB.sessions).toEqual([{ learner_id: 'learner-2', course_id: 'fra_for_eng' }])
  })

  it('400s a missing course_code', async () => {
    authUserId = 'user-a'
    const res = makeRes()
    await handler(makeReq({}), res)
    expect(res.statusCode).toBe(400)
  })

  it('401s an unauthenticated caller', async () => {
    const { verifyAuthToken } = await import('../_utils/auth')
    ;(verifyAuthToken as any).mockResolvedValueOnce({ valid: false, error: 'no token' })
    const res = makeRes()
    await handler(makeReq({ course_code: 'fra_for_eng' }), res)
    expect(res.statusCode).toBe(401)
    expect(DB.sessions).toHaveLength(1)
  })

  it('404s when no learner row exists for the caller', async () => {
    authUserId = 'nobody'
    const res = makeRes()
    await handler(makeReq({ course_code: 'fra_for_eng' }), res)
    expect(res.statusCode).toBe(404)
  })
})
