/**
 * Tests for POST /api/school/class-progress — the server-mediated write path
 * for play-as-class (owner ruling 2026-07-16: class as first-class learner).
 *
 * Covers: role/scope authorization, method allowlisting, write semantics for
 * a couple of the mirrored ProgressStore methods, and the substitute-
 * continuity guarantee — two DIFFERENT callers (different auth uids) writing
 * against the SAME classId land on the SAME class learner id, so a covering
 * teacher resumes exactly where the last one left off.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-key'

let authUserId: string
vi.mock('../_utils/auth', () => ({
  verifyAuthToken: vi.fn(async () => ({ valid: true, userId: authUserId })),
}))

let scope: any
vi.mock('../_utils/schoolScope', () => ({
  resolveVisibleScope: vi.fn(async () => scope),
}))

let DB: {
  classes: Array<{ id: string; class_learner_id: string | null; course_code: string }>
  course_enrollments: Array<Record<string, any>>
  lego_progress: Array<Record<string, any>>
}

function makeChainable(table: string) {
  let rows: any[] = [...((DB as any)[table] ?? [])]
  const builder: any = {
    _updatePatch: null as any,
    _insertRow: null as any,
    select() { return builder },
    eq(col: string, val: unknown) { rows = rows.filter((r) => r[col] === val); return builder },
    update(patch: any) { builder._updatePatch = patch; return builder },
    insert(row: any) { builder._insertRow = row; return builder },
    or() { return builder }, // forward-only guards — not modelled here, just pass through
    async single() {
      if (builder._insertRow) {
        const row = { id: `row-${Math.random()}`, ...builder._insertRow }
        ;(DB as any)[table].push(row)
        return { data: row, error: null }
      }
      return rows[0] ? { data: rows[0], error: null } : { data: null, error: { message: 'not found', code: 'PGRST116' } }
    },
    async maybeSingle() {
      return { data: rows[0] ?? null, error: null }
    },
    then(resolve: any) {
      if (builder._updatePatch) {
        rows.forEach((r) => Object.assign(r, builder._updatePatch))
        return Promise.resolve({ data: null, error: null }).then(resolve)
      }
      return Promise.resolve({ data: rows, error: null }).then(resolve)
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

let handler: typeof import('./class-progress').default

beforeEach(async () => {
  vi.resetModules()
  handler = (await import('./class-progress')).default
  authUserId = 'teacher-a'
  DB = {
    classes: [{ id: 'class-1', class_learner_id: 'class-learner-1', course_code: 'cym_for_eng' }],
    course_enrollments: [{ learner_id: 'class-learner-1', course_id: 'cym_for_eng', last_completed_lego_id: null, last_completed_round_index: null, current_cycle_index: 0 }],
    lego_progress: [],
  }
  scope = { role: 'teacher', classIds: ['class-1'], learnerIds: [], studentsByClass: {}, schoolIds: [], groupId: null, learnerId: 'staff-learner-a' }
})

describe('POST /api/school/class-progress', () => {
  it('rejects an unknown method', async () => {
    const res = makeRes()
    await handler(makeReq({ classId: 'class-1', method: 'deleteEverything', args: [] }), res)
    expect(res.statusCode).toBe(400)
  })

  it('rejects a caller whose scope does not include the class', async () => {
    scope.classIds = ['some-other-class']
    const res = makeRes()
    await handler(makeReq({ classId: 'class-1', method: 'setLivePosition', args: ['S0001L01', 1, 0] }), res)
    expect(res.statusCode).toBe(403)
  })

  it('rejects a govt_admin — play-as-class is teacher/school_admin only', async () => {
    scope.role = 'govt_admin'
    const res = makeRes()
    await handler(makeReq({ classId: 'class-1', method: 'setLivePosition', args: ['S0001L01', 1, 0] }), res)
    expect(res.statusCode).toBe(403)
  })

  it('allows school_admin (not just teacher)', async () => {
    scope.role = 'school_admin'
    const res = makeRes()
    await handler(makeReq({ classId: 'class-1', method: 'setLivePosition', args: ['S0001L01', 1, 0] }), res)
    expect(res.statusCode).toBe(200)
  })

  it('setLivePosition writes to the CLASS learner id, never the caller\'s own', async () => {
    const res = makeRes()
    await handler(makeReq({ classId: 'class-1', method: 'setLivePosition', args: ['S0001L05', 4, 2] }), res)
    expect(res.statusCode).toBe(200)
    const row = DB.course_enrollments.find((r) => r.learner_id === 'class-learner-1')
    expect(row.last_completed_lego_id).toBe('S0001L05')
    expect(row.current_cycle_index).toBe(2)
    // never wrote a row for the caller's own learner id
    expect(DB.course_enrollments.some((r) => r.learner_id === scope.learnerId)).toBe(false)
  })

  it('409s when the class has no learner entity yet', async () => {
    DB.classes[0].class_learner_id = null
    const res = makeRes()
    await handler(makeReq({ classId: 'class-1', method: 'getEnrollment', args: [] }), res)
    expect(res.statusCode).toBe(409)
  })

  it('substitute continuity: two different staff callers land on the same class learner id', async () => {
    // Staff A (Tuesday's lesson) advances the class's live position.
    const resA = makeRes()
    authUserId = 'teacher-a'
    await handler(makeReq({ classId: 'class-1', method: 'setLivePosition', args: ['S0010L02', 9, 1] }), resA)
    expect(resA.statusCode).toBe(200)

    // Staff B (Thursday's substitute) reads the enrollment back — same
    // classId, DIFFERENT auth uid — and must see exactly where A left off.
    authUserId = 'teacher-b'
    scope = { ...scope, learnerId: 'staff-learner-b' }
    const resB = makeRes()
    await handler(makeReq({ classId: 'class-1', method: 'getEnrollment', args: [] }), resB)
    expect(resB.statusCode).toBe(200)
    expect(resB.body.result.last_completed_lego_id).toBe('S0010L02')
    expect(resB.body.result.learner_id).toBe('class-learner-1')
  })

  it('updateLegoProgress rejects a row that does not belong to this class\'s learner', async () => {
    DB.lego_progress.push({ id: 'lp-1', learner_id: 'some-other-learner' })
    const res = makeRes()
    await handler(makeReq({ classId: 'class-1', method: 'updateLegoProgress', args: ['lp-1', { reps_completed: 2 }] }), res)
    expect(res.statusCode).toBe(500)
  })

  it('401s with no auth token', async () => {
    const authMod = await import('../_utils/auth')
    ;(authMod.verifyAuthToken as any).mockResolvedValueOnce({ valid: false, error: 'no token' })
    const res = makeRes()
    await handler(makeReq({ classId: 'class-1', method: 'getEnrollment', args: [] }), res)
    expect(res.statusCode).toBe(401)
  })
})
