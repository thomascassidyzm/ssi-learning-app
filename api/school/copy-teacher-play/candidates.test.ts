/**
 * Gate tests for POST /api/school/copy-teacher-play/candidates (job #662).
 *
 * The planner is mocked (its engine is pinned in classProgressCopy.test.ts);
 * here the doors and the shape are tested:
 *   - the school admin of a school gets every (class, teacher) pair where the
 *     teacher has own-account play on the class course and the class is
 *     behind — with the same fields the single-pair preview returns — and a
 *     pair with nothing to copy is left out;
 *   - View-as is ALLOWED (it writes nothing): an ssi_admin naming school_id
 *     under the View-as header gets the list;
 *   - a caller who is not an admin of the named school is refused 403;
 *   - nothing is ever applied.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-key'

let authUserId = 'angharad'
vi.mock('../../_utils/auth', () => ({
  verifyAuthToken: vi.fn(async () => ({ valid: true, userId: authUserId })),
}))

let platformAdmin = false
vi.mock('../../_utils/classTeacherAuth', () => ({
  isPlatformAdmin: vi.fn(async () => platformAdmin),
}))

vi.mock('../../_utils/schoolStaff', () => ({
  isSchoolAdminOf: vi.fn(async (_svc: unknown, uid: string, schoolId: string) => uid === 'angharad' && schoolId === 'chepstow'),
  adminSchoolIdFor: vi.fn(async (_svc: unknown, uid: string) => (uid === 'angharad' ? 'chepstow' : null)),
}))

const planCopy = vi.fn()
const applyCopy = vi.fn()
vi.mock('../../_utils/classProgressCopy', () => ({
  planCopy: (...a: unknown[]) => planCopy(...a),
  applyCopy: (...a: unknown[]) => applyCopy(...a),
  cursorPosition: (c: any) => ({ legoId: c?.last_completed_lego_id ?? null, roundIndex: null }),
}))

// Chepstow, trimmed: 10C led by florencecotten (own play, class never played);
// 8B led by benjones (own play, but already copied → nothing to copy); 7A led
// by hannahmcwha with a co-teacher tag for karinejames, neither enrolled on
// the course themselves; and an archived class that must not appear.
const DB: Record<string, any[]> = {
  classes: [
    { id: 'c-10c', school_id: 'chepstow', class_name: '10C', course_code: 'cym_s_for_eng', teacher_user_id: 'u-florence', class_learner_id: 'cl-10c', is_active: true },
    { id: 'c-8b', school_id: 'chepstow', class_name: '8B', course_code: 'cym_s_for_eng', teacher_user_id: 'u-ben', class_learner_id: 'cl-8b', is_active: true },
    { id: 'c-7a', school_id: 'chepstow', class_name: '7A', course_code: 'cym_s_for_eng', teacher_user_id: 'u-hannah', class_learner_id: null, is_active: true },
    { id: 'c-old', school_id: 'chepstow', class_name: 'Old', course_code: 'cym_s_for_eng', teacher_user_id: 'u-florence', class_learner_id: null, is_active: false },
    { id: 'c-other', school_id: 'elsewhere', class_name: 'X', course_code: 'cym_s_for_eng', teacher_user_id: 'u-florence', class_learner_id: null, is_active: true },
  ],
  user_tags: [
    { user_id: 'u-karine', tag_type: 'class', tag_value: 'CLASS:c-7a', role_in_context: 'teacher', removed_at: null },
  ],
  learners: [
    { id: 'l-florence', user_id: 'u-florence', display_name: 'florencecotten' },
    { id: 'l-ben', user_id: 'u-ben', display_name: 'benjones' },
    { id: 'l-hannah', user_id: 'u-hannah', display_name: 'hannahmcwha' },
    { id: 'l-karine', user_id: 'u-karine', display_name: 'karinejames' },
  ],
  course_enrollments: [
    { learner_id: 'l-florence', course_id: 'cym_s_for_eng' },
    { learner_id: 'l-ben', course_id: 'cym_s_for_eng' },
  ],
  course_legos: [{ course_code: 'cym_s_for_eng', lego_id: 'S0008L01', known_text: 'I still want', target_text: 'dw i dal yn moyn' }],
}

function fakeFrom(table: string) {
  let rows = [...(DB[table] ?? [])]
  const q: any = {
    select() { return q },
    eq(c: string, v: unknown) { rows = rows.filter((r) => r[c] === v); return q },
    is(c: string, v: unknown) { rows = rows.filter((r) => r[c] === v); return q },
    in(c: string, vals: unknown[]) { rows = rows.filter((r) => vals.includes(r[c])); return q },
    maybeSingle() { return Promise.resolve({ data: rows[0] ?? null, error: null }) },
    then(resolve: any) { return Promise.resolve({ data: rows, error: null }).then(resolve) },
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

const planFor = (source: string) => source === 'l-ben'
  ? { toCopy: { sessions: 0 }, alreadyPresent: { sessions: 3 }, skipped: [], cursor: { source: null, target: null }, resulting: { legoId: 'S0008L01', roundIndex: null, takenFromSource: false }, inAppSecondsToCopy: 0, minutesToAdd: 0, priorRuns: 1, rows: {} }
  : { toCopy: { sessions: 2, player_events: 125 }, alreadyPresent: {}, skipped: [], cursor: { source: { last_completed_lego_id: 'S0008L01' }, target: null }, resulting: { legoId: 'S0008L01', roundIndex: null, takenFromSource: true }, inAppSecondsToCopy: 722, minutesToAdd: 12, priorRuns: 0, rows: {} }

let candidates: typeof import('./candidates').default

beforeEach(async () => {
  vi.resetModules()
  authUserId = 'angharad'
  platformAdmin = false
  planCopy.mockReset().mockImplementation(async (_svc: unknown, p: { sourceLearnerId: string }) => planFor(p.sourceLearnerId))
  applyCopy.mockReset()
  candidates = (await import('./candidates')).default
})

describe('POST /api/school/copy-teacher-play/candidates — the school-admin sweep (job #662)', () => {
  it('the school admin gets every mis-played (class, teacher) pair with the preview figures; nothing-to-copy pairs, archived classes and other schools are left out; nothing is applied', async () => {
    const res = makeRes()
    await candidates(makeReq({}), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.school_id).toBe('chepstow')
    expect(res.body.classes_checked).toBe(3)
    // Only enrolled teachers reach the planner: florence on 10C, ben on 8B.
    expect(res.body.pairs_checked).toBe(2)
    expect(planCopy).toHaveBeenCalledTimes(2)
    expect(planCopy).toHaveBeenCalledWith(expect.anything(), { sourceLearnerId: 'l-florence', targetLearnerId: 'cl-10c', courseCode: 'cym_s_for_eng' })
    expect(res.body.candidates).toHaveLength(1)
    expect(res.body.candidates[0]).toMatchObject({
      class_id: 'c-10c', class_name: '10C', course_code: 'cym_s_for_eng',
      teacher: { user_id: 'u-florence', name: 'florencecotten', learner_id: 'l-florence' },
      to_copy: { sessions: 2, player_events: 125 }, total_rows: 127, in_app_seconds: 722, minutes_to_add: 12, prior_runs: 0,
      position: { teacher: { known: 'I still want', target: 'dw i dal yn moyn' }, class: { known: null, target: null }, resulting: { known: 'I still want', taken_from_teacher: true } },
      nothing_to_copy: false,
    })
    expect(applyCopy).not.toHaveBeenCalled()
  })

  it('View-as is allowed: an ssi_admin naming school_id under the View-as header gets the list', async () => {
    authUserId = 'tom'
    platformAdmin = true
    const res = makeRes()
    await candidates(makeReq({ school_id: 'chepstow' }, { 'x-ssi-view-as': '1' }), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.candidates.map((c: any) => c.teacher.name)).toEqual(['florencecotten'])
    expect(applyCopy).not.toHaveBeenCalled()
  })

  it('a caller who is not an admin of the named school is refused 403, and a caller with no school is refused too', async () => {
    authUserId = 'stranger'
    const res = makeRes()
    await candidates(makeReq({ school_id: 'chepstow' }), res)
    expect(res.statusCode).toBe(403)
    expect(planCopy).not.toHaveBeenCalled()
    const res2 = makeRes()
    await candidates(makeReq({}), res2)
    expect(res2.statusCode).toBe(403)
  })
})
