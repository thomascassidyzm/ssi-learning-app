/**
 * Gate tests for POST /api/school/copy-teacher-play/{preview,apply}.
 *
 * The copy engine itself is pinned in api/_utils/classProgressCopy.test.ts;
 * here it is mocked and only the doors are tested:
 *   - apply under View-as is refused 403 BEFORE auth (Tom browsing staging as
 *     Angharad is read-only by design); preview under View-as still works;
 *   - a caller who may not teach the class gets 403 and no copy runs;
 *   - a teacher_user_id who does not teach the class gets 400;
 *   - the happy path runs plan → apply with the resolved learner ids and
 *     reports the audit id; a part-way failure is a 500 with the table named.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-key'

let authUserId = 'angharad'
vi.mock('../../_utils/auth', () => ({
  verifyAuthToken: vi.fn(async () => ({ valid: true, userId: authUserId })),
}))

let canTeach = true
vi.mock('../../_utils/classTeacherAuth', () => ({
  fetchClassAuthRow: vi.fn(async (_svc: unknown, id: string) => id === 'class-1'
    ? { id: 'class-1', teacher_user_id: 'lead-teacher', school_id: 'school-1', group_id: null }
    : null),
  canTeachClass: vi.fn(async () => canTeach),
}))

vi.mock('../../_utils/classLearnerEntity', () => ({
  ensureClassLearnerEntity: vi.fn(async () => ({ learnerId: 'class-learner' })),
}))

const planCopy = vi.fn()
const applyCopy = vi.fn()
vi.mock('../../_utils/classProgressCopy', () => ({
  planCopy: (...a: unknown[]) => planCopy(...a),
  applyCopy: (...a: unknown[]) => applyCopy(...a),
  cursorPosition: () => ({ legoId: 'S0008L01', roundIndex: 13 }),
}))

// Minimal table double for what _shared.ts reads: user_tags (co-teacher
// check), classes (course), learners (teacher's learner), course_legos.
const TAGS = [{ id: 't1', user_id: 'co-teacher', tag_type: 'class', tag_value: 'CLASS:class-1', role_in_context: 'teacher', removed_at: null }]
function fakeFrom(table: string) {
  const filters: Array<[string, unknown]> = []
  const q: any = {
    select() { return q },
    eq(c: string, v: unknown) { filters.push([c, v]); return q },
    is(c: string, v: unknown) { filters.push([c, v]); return q },
    maybeSingle() {
      const rows: any[] = table === 'user_tags' ? TAGS
        : table === 'classes' ? [{ id: 'class-1', course_code: 'cym_s_for_eng' }]
        : table === 'learners' ? [{ id: 'teacher-learner', user_id: 'lead-teacher', display_name: 'Ms Jones' }, { id: 'co-learner', user_id: 'co-teacher', display_name: 'Mr Pugh' }]
        : table === 'course_legos' ? [{ course_code: 'cym_s_for_eng', lego_id: 'S0008L01', known_text: 'I still want', target_text: 'dw i dal yn moyn' }]
        : []
      const hit = rows.find((r) => filters.every(([c, v]) => r[c] === v))
      return Promise.resolve({ data: hit ?? null, error: null })
    },
  }
  return q
}
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: fakeFrom }) }))

function makeReq(body: any, headers: Record<string, string> = {}): VercelRequest {
  return { method: 'POST', body, headers: { authorization: 'Bearer tok', ...headers } } as any
}
function makeRes(): VercelResponse & { statusCode?: number; body?: any } {
  const res: any = { setHeader: vi.fn() }
  res.status = vi.fn((code: number) => { res.statusCode = code; return res })
  res.json = vi.fn((body: any) => { res.body = body; return res })
  return res
}

let apply: typeof import('./apply').default
let preview: typeof import('./preview').default
const PLAN = {
  toCopy: { sessions: 2 }, alreadyPresent: {}, skipped: [], cursor: { source: null, target: null },
  resulting: { legoId: 'S0008L01', roundIndex: 13, takenFromSource: true }, inAppSecondsToCopy: 120, minutesToAdd: 4, priorRuns: 0, rows: {},
}

beforeEach(async () => {
  vi.resetModules()
  authUserId = 'angharad'
  canTeach = true
  planCopy.mockReset().mockResolvedValue(PLAN)
  applyCopy.mockReset().mockResolvedValue({
    auditId: 'audit-1', error: null,
    record: { copied: { sessions: { s1: 'n1', s2: 'n2' } }, alreadyPresent: {}, skipped: [], cursorBefore: {}, cursorAfter: { target: null }, cursorTakenFromSource: true, minutesAdded: 4, inAppSecondsCopied: 120 },
  })
  apply = (await import('./apply')).default
  preview = (await import('./preview')).default
})

describe('View-as', () => {
  it('apply is refused 403 under View-as and nothing is planned or copied', async () => {
    const res = makeRes()
    await apply(makeReq({ class_id: 'class-1', teacher_user_id: 'lead-teacher' }, { 'x-ssi-view-as': '1' }), res)
    expect(res.statusCode).toBe(403)
    expect(res.body.error).toMatch(/Read-only while viewing as/)
    expect(planCopy).not.toHaveBeenCalled()
    expect(applyCopy).not.toHaveBeenCalled()
  })
  it('preview still works under View-as (it writes nothing)', async () => {
    const res = makeRes()
    await preview(makeReq({ class_id: 'class-1', teacher_user_id: 'lead-teacher' }, { 'x-ssi-view-as': '1' }), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.to_copy.sessions).toBe(2)
    expect(res.body.position.resulting).toMatchObject({ known: 'I still want', target: 'dw i dal yn moyn', taken_from_teacher: true })
    expect(applyCopy).not.toHaveBeenCalled()
  })
})

describe('authorisation', () => {
  it('a caller who may not teach the class is refused 403, no copy runs', async () => {
    canTeach = false
    const res = makeRes()
    await apply(makeReq({ class_id: 'class-1', teacher_user_id: 'lead-teacher' }), res)
    expect(res.statusCode).toBe(403)
    expect(applyCopy).not.toHaveBeenCalled()
  })
  it('a teacher_user_id who does not teach the class is 400', async () => {
    const res = makeRes()
    await apply(makeReq({ class_id: 'class-1', teacher_user_id: 'stranger' }), res)
    expect(res.statusCode).toBe(400)
    expect(res.body.error).toMatch(/not a teacher of this class/)
    expect(applyCopy).not.toHaveBeenCalled()
  })
  it('an unknown class is 404', async () => {
    const res = makeRes()
    await apply(makeReq({ class_id: 'nope', teacher_user_id: 'lead-teacher' }), res)
    expect(res.statusCode).toBe(404)
  })
})

describe('apply happy path and failure', () => {
  it('copies for a co-teacher via the tag, with the resolved learner ids, and reports the audit id', async () => {
    const res = makeRes()
    await apply(makeReq({ class_id: 'class-1', teacher_user_id: 'co-teacher' }), res)
    expect(res.statusCode).toBe(200)
    expect(planCopy).toHaveBeenCalledWith(expect.anything(), { sourceLearnerId: 'co-learner', targetLearnerId: 'class-learner', courseCode: 'cym_s_for_eng' })
    expect(applyCopy).toHaveBeenCalledWith(expect.anything(), PLAN, { actorUserId: 'angharad', classId: 'class-1' })
    expect(res.body).toMatchObject({ audit_id: 'audit-1', copied: { sessions: 2 }, total_rows: 2, cursor_taken_from_teacher: true, teacher: { name: 'Mr Pugh' } })
  })
  it('a part-way failure is a 500 naming the table — never a false Copied', async () => {
    applyCopy.mockResolvedValue({
      auditId: 'audit-2', error: 'response_metrics: boom',
      record: { copied: { sessions: { s1: 'n1' } }, alreadyPresent: {}, skipped: [], cursorBefore: {}, cursorAfter: { target: null }, cursorTakenFromSource: false, minutesAdded: 0, inAppSecondsCopied: 0 },
    })
    const res = makeRes()
    await apply(makeReq({ class_id: 'class-1', teacher_user_id: 'lead-teacher' }), res)
    expect(res.statusCode).toBe(500)
    expect(res.body.error).toMatch(/Copy stopped part-way: response_metrics/)
    expect(res.body.copied.sessions).toBe(1)
  })
})
