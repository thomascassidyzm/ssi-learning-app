/**
 * Tests for the learner's sector-thread state — the laws, not the plumbing.
 *
 * The rules that must not drift: a client can never mint a thread for an
 * unregistered segment; ONE walk is active at a time and switching PARKS the
 * other rather than deleting it; and a failed write is loud, never a cheerful
 * 200 over a lost choice.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-key'

vi.mock('../_utils/auth', () => ({
  verifyAuthToken: vi.fn(async () => ({ valid: true, userId: 'auth-1' })),
}))

let DB: Record<string, any[]>
/** Tables forced to answer with an error, to prove writes stay loud. */
let ERRORS: Record<string, { message: string }>

function makeChainable(table: string) {
  const source = () => (DB[table] ??= [])
  const filters: Array<(r: any) => boolean> = []
  let single = false
  let pendingUpdate: any = null
  let pendingUpsert: { payload: any; onConflict?: string } | null = null

  function matched(): any[] {
    return source().filter((r) => filters.every((f) => f(r)))
  }

  function settle(): { data: any; error: any } {
    if (ERRORS[table]) return { data: null, error: ERRORS[table] }

    if (pendingUpdate) {
      const hits = matched()
      hits.forEach((r) => Object.assign(r, pendingUpdate))
      return { data: single ? (hits[0] ?? null) : hits, error: null }
    }

    if (pendingUpsert) {
      const keys = (pendingUpsert.onConflict ?? '').split(',').map((k) => k.trim()).filter(Boolean)
      const payload = pendingUpsert.payload
      const existing = keys.length
        ? source().find((r) => keys.every((k) => r[k] === payload[k]))
        : undefined
      let row: any
      if (existing) {
        row = Object.assign(existing, payload)
      } else {
        row = { id: `row-${source().length + 1}`, ...payload }
        source().push(row)
      }
      return { data: single ? row : [row], error: null }
    }

    const rows = matched()
    return { data: single ? (rows[0] ?? null) : rows, error: null }
  }

  const builder: any = {
    select: () => builder,
    eq: (col: string, val: unknown) => { filters.push((r) => r[col] === val); return builder },
    neq: (col: string, val: unknown) => { filters.push((r) => r[col] !== val); return builder },
    in: (col: string, vals: unknown[]) => { filters.push((r) => vals.includes(r[col])); return builder },
    order: () => builder,
    limit: () => builder,
    maybeSingle: () => { single = true; return builder },
    single: () => { single = true; return builder },
    update: (payload: any) => { pendingUpdate = payload; return builder },
    upsert: (payload: any, opts?: any) => { pendingUpsert = { payload, onConflict: opts?.onConflict }; return builder },
    then: (resolve: any) => Promise.resolve(settle()).then(resolve),
  }
  return builder
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: (table: string) => makeChainable(table) }),
}))

let handler: typeof import('./threads').default

function makeRes(): VercelResponse & { statusCode?: number; body?: any } {
  const res: any = {}
  res.status = vi.fn((code: number) => { res.statusCode = code; return res })
  res.json = vi.fn((body: any) => { res.body = body; return res })
  res.setHeader = vi.fn(() => res)
  return res
}

function getReq(query: Record<string, any> = { course: 'spa_for_eng' }): VercelRequest {
  return { method: 'GET', query, headers: { authorization: 'Bearer tok' } } as any
}

function postReq(body: any): VercelRequest {
  return { method: 'POST', query: {}, body, headers: { authorization: 'Bearer tok' } } as any
}

beforeEach(async () => {
  vi.resetModules()
  handler = (await import('./threads')).default
  ERRORS = {}
  DB = {
    learners: [{ id: 'learner-1', user_id: 'auth-1' }],
    course_enrollments: [{ id: 'enrol-1', learner_id: 'learner-1', course_id: 'spa_for_eng' }],
    course_sectors: [
      { base_course_code: 'spa_for_eng', sector_course_code: 'spa_for_eng_health', roles: ['general'] },
      { base_course_code: 'spa_for_eng', sector_course_code: 'spa_for_eng_trades', roles: ['general'] },
    ],
    enrollment_threads: [],
  }
})

describe('GET /api/me/threads', () => {
  it('rejects an unauthenticated caller', async () => {
    const { verifyAuthToken } = await import('../_utils/auth')
    ;(verifyAuthToken as any).mockResolvedValueOnce({ valid: false, error: 'no token' })
    const res = makeRes()
    await handler(getReq(), res)
    expect(res.statusCode).toBe(401)
  })

  it('rejects an unsupported method', async () => {
    const res = makeRes()
    await handler({ ...getReq(), method: 'DELETE' } as any, res)
    expect(res.statusCode).toBe(405)
  })

  it('no enrolment: an empty list, not an error', async () => {
    const res = makeRes()
    await handler(getReq({ course: 'fra_for_eng' }), res)
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ enrollmentId: null, threads: [] })
  })

  it('returns the learner rows in camelCase', async () => {
    DB.enrollment_threads = [{
      enrollment_id: 'enrol-1',
      sector_course_code: 'spa_for_eng_health',
      role: 'general',
      active: true,
      last_completed_round_index: 4,
      current_cycle_index: 2,
      highest_completed_round_index: 6,
      highest_completed_lego_id: 'S0042L03',
      completed_pod_rounds: 1,
      pod_activation_round: 6,
    }]
    const res = makeRes()
    await handler(getReq(), res)
    expect(res.body.enrollmentId).toBe('enrol-1')
    expect(res.body.threads[0]).toEqual({
      sectorCourseCode: 'spa_for_eng_health',
      role: 'general',
      active: true,
      lastCompletedRoundIndex: 4,
      currentCycleIndex: 2,
      highestCompletedRoundIndex: 6,
      highestCompletedLegoId: 'S0042L03',
      completedPodRounds: 1,
      podActivationRound: 6,
    })
  })
})

describe('POST /api/me/threads', () => {
  it('400s on a sector that is not registered under that base course — a client can never mint a thread', async () => {
    const res = makeRes()
    await handler(postReq({ course: 'spa_for_eng', sectorCourseCode: 'spa_for_eng_invented' }), res)
    expect(res.statusCode).toBe(400)
    expect(DB.enrollment_threads).toHaveLength(0)
  })

  it('400s when the sector belongs to a different base course', async () => {
    DB.course_sectors.push({
      base_course_code: 'fra_for_eng', sector_course_code: 'fra_for_eng_health', roles: ['general'],
    })
    const res = makeRes()
    await handler(postReq({ course: 'spa_for_eng', sectorCourseCode: 'fra_for_eng_health' }), res)
    expect(res.statusCode).toBe(400)
  })

  it('400s without the required fields', async () => {
    const res = makeRes()
    await handler(postReq({ course: 'spa_for_eng' }), res)
    expect(res.statusCode).toBe(400)
  })

  it('creates the thread, defaulting the role to general and active to true', async () => {
    const res = makeRes()
    await handler(postReq({ course: 'spa_for_eng', sectorCourseCode: 'spa_for_eng_health' }), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.thread.role).toBe('general')
    expect(res.body.thread.active).toBe(true)
    expect(DB.enrollment_threads).toHaveLength(1)
    expect(DB.enrollment_threads[0].enrollment_id).toBe('enrol-1')
  })

  it('parks the other walk on a switch — active false, state intact, nothing deleted', async () => {
    DB.enrollment_threads = [{
      enrollment_id: 'enrol-1',
      sector_course_code: 'spa_for_eng_health',
      role: 'general',
      active: true,
      last_completed_round_index: 9,
      current_cycle_index: 3,
      highest_completed_round_index: 9,
      highest_completed_lego_id: 'S0100L01',
      completed_pod_rounds: 2,
      pod_activation_round: 6,
    }]
    const res = makeRes()
    await handler(postReq({ course: 'spa_for_eng', sectorCourseCode: 'spa_for_eng_trades' }), res)
    expect(res.statusCode).toBe(200)
    expect(DB.enrollment_threads).toHaveLength(2)
    const parked = DB.enrollment_threads.find((r) => r.sector_course_code === 'spa_for_eng_health')!
    expect(parked.active).toBe(false)
    // Parking is never destructive: the cursor is exactly where it stopped.
    expect(parked.last_completed_round_index).toBe(9)
    expect(parked.current_cycle_index).toBe(3)
    expect(parked.completed_pod_rounds).toBe(2)
    const chosen = DB.enrollment_threads.find((r) => r.sector_course_code === 'spa_for_eng_trades')!
    expect(chosen.active).toBe(true)
  })

  it('toggling a walk off parks nothing else and deletes nothing', async () => {
    DB.enrollment_threads = [
      { enrollment_id: 'enrol-1', sector_course_code: 'spa_for_eng_health', role: 'general', active: true, current_cycle_index: 5 },
    ]
    const res = makeRes()
    await handler(postReq({ course: 'spa_for_eng', sectorCourseCode: 'spa_for_eng_health', active: false }), res)
    expect(res.statusCode).toBe(200)
    expect(DB.enrollment_threads).toHaveLength(1)
    expect(DB.enrollment_threads[0].active).toBe(false)
    expect(DB.enrollment_threads[0].current_cycle_index).toBe(5)
  })

  it('creates the enrolment when the learner has none yet', async () => {
    DB.course_enrollments = []
    const res = makeRes()
    await handler(postReq({ course: 'spa_for_eng', sectorCourseCode: 'spa_for_eng_health' }), res)
    expect(res.statusCode).toBe(200)
    expect(DB.course_enrollments).toHaveLength(1)
    expect(DB.course_enrollments[0].learner_id).toBe('learner-1')
  })

  it('a failed write is loud — never a cheerful 200 over a lost choice', async () => {
    ERRORS.enrollment_threads = { message: 'boom' }
    const res = makeRes()
    await handler(postReq({ course: 'spa_for_eng', sectorCourseCode: 'spa_for_eng_health' }), res)
    expect(res.statusCode).toBe(500)
    expect(res.body.error).toBe('boom')
  })
})
