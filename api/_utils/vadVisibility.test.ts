// ============================================================================
// vadVisibility.test.ts — the founder ruling of 2026-08-20, as assertions.
//
//   "the VAD data should follow the same hierarchy of visibility that all data
//    follows — students < teachers < school leaders < group leaders — as long
//    as the hierarchy is legitimate, the data should be viewable"
//
// This is deliberately NOT a mock of the predicate. Only `./auth` (the JWT) is
// stubbed; resolveVisibleScope, leaderGroupIdFor and isWithinLeaderSubtree all
// RUN, against a fake Supabase holding a small but real-shaped org tree. A test
// that mocked the subtree walk would pass while the walk was wrong, which is
// the exact failure mode an authz test exists to catch.
//
// The tree (mirrors the live IME shape: programme → region → school → class):
//
//   PROGRAMME  g-prog
//     ├─ REGION g-reg-a
//     │    └─ NODE g-node-s1  (school s1 "Sunrise")   class c1 (t1) → L1, L2
//     │                                               class c2 (t2) → L3
//     └─ REGION g-reg-b
//          └─ NODE g-node-s2  (school s2 "Harbour")   class c3 (t3) → L4
//
//   L2 carries NO learner_lego_metrics row at all — the hide-don't-zero case.
// ============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

let verifyAdminResult: unknown
let verifyAuthTokenResult: unknown
vi.mock('./auth', () => ({
  verifyAdmin: vi.fn(async () => verifyAdminResult),
  verifyAuthToken: vi.fn(async () => verifyAuthTokenResult),
}))

import { resolveVadCaller, resolveVadScope, canSeeLearnerVad, isDenied } from './vadVisibility'

// ---- the fake org tree -----------------------------------------------------

const GROUPS = [
  { id: 'g-prog', name: 'IME Demo Programme', type: 'programme', parent_id: null },
  { id: 'g-reg-a', name: 'Region A', type: 'region', parent_id: 'g-prog' },
  { id: 'g-reg-b', name: 'Region B', type: 'region', parent_id: 'g-prog' },
  { id: 'g-node-s1', name: 'Sunrise', type: 'school', parent_id: 'g-reg-a' },
  { id: 'g-node-s2', name: 'Harbour', type: 'school', parent_id: 'g-reg-b' },
  { id: 'g-other', name: 'Unrelated Org', type: 'programme', parent_id: null },
]

const SCHOOLS = [
  // s1 is node-bridged ONLY (no group_id) — the 11-of-24 live case that
  // schoolsForGroupSubtree alone would miss.
  { id: 's1', school_name: 'Sunrise', group_id: null, node_group_id: 'g-node-s1', is_demo: true, is_test: false, admin_user_id: 'u-sl1' },
  { id: 's2', school_name: 'Harbour', group_id: 'g-reg-b', node_group_id: 'g-node-s2', is_demo: true, is_test: false, admin_user_id: 'u-sl2' },
]

const CLASSES = [
  { id: 'c1', class_name: 'Class One', course_code: 'cym_for_eng', school_id: 's1', group_id: null, teacher_user_id: 'u-t1', is_active: true },
  { id: 'c2', class_name: 'Class Two', course_code: 'cym_for_eng', school_id: 's1', group_id: null, teacher_user_id: 'u-t2', is_active: true },
  { id: 'c3', class_name: 'Class Three', course_code: 'spa_for_eng', school_id: 's2', group_id: null, teacher_user_id: 'u-t3', is_active: true },
]

// learners.user_id is the auth uid (TEXT); learners.id is the learner PK (uuid).
const LEARNERS = [
  { id: 'L1', user_id: 'u-L1', display_name: 'Asha', educational_role: 'student' },
  { id: 'L2', user_id: 'u-L2', display_name: 'Bina', educational_role: 'student' },
  { id: 'L3', user_id: 'u-L3', display_name: 'Chandra', educational_role: 'student' },
  { id: 'L4', user_id: 'u-L4', display_name: 'Deepa', educational_role: 'student' },
  { id: 'T1', user_id: 'u-t1', display_name: 'Teacher One', educational_role: 'teacher' },
  { id: 'T2', user_id: 'u-t2', display_name: 'Teacher Two', educational_role: 'teacher' },
  { id: 'T3', user_id: 'u-t3', display_name: 'Teacher Three', educational_role: 'teacher' },
  { id: 'SL1', user_id: 'u-sl1', display_name: 'Sunrise Head', educational_role: 'school_admin' },
  { id: 'SL2', user_id: 'u-sl2', display_name: 'Harbour Head', educational_role: 'school_admin' },
  { id: 'GL', user_id: 'u-gl', display_name: 'Programme Leader', educational_role: 'govt_admin' },
  { id: 'GLX', user_id: 'u-glx', display_name: 'Other Leader', educational_role: 'govt_admin' },
  { id: 'AD', user_id: 'u-ad', display_name: 'SSi Admin', educational_role: 'god' },
]

const GOVT_ADMINS = [
  { user_id: 'u-gl', group_id: 'g-prog', region_code: null },
  { user_id: 'u-glx', group_id: 'g-other', region_code: null },
]

const USER_TAGS = [
  { tag_type: 'class', tag_value: 'CLASS:c1', user_id: 'u-L1', role_in_context: 'student', removed_at: null },
  { tag_type: 'class', tag_value: 'CLASS:c1', user_id: 'u-L2', role_in_context: 'student', removed_at: null },
  { tag_type: 'class', tag_value: 'CLASS:c2', user_id: 'u-L3', role_in_context: 'student', removed_at: null },
  { tag_type: 'class', tag_value: 'CLASS:c3', user_id: 'u-L4', role_in_context: 'student', removed_at: null },
  { tag_type: 'class', tag_value: 'CLASS:c1', user_id: 'u-t1', role_in_context: 'teacher', removed_at: null },
  { tag_type: 'school', tag_value: 'SCHOOL:s1', user_id: 'u-sl1', role_in_context: 'admin', removed_at: null },
  { tag_type: 'school', tag_value: 'SCHOOL:s2', user_id: 'u-sl2', role_in_context: 'admin', removed_at: null },
]

const CLASS_TEACHERS = [
  { class_id: 'c1', teacher_user_id: 'u-t1' },
  { class_id: 'c2', teacher_user_id: 'u-t2' },
  { class_id: 'c3', teacher_user_id: 'u-t3' },
]

const TABLES: Record<string, Record<string, unknown>[]> = {
  groups: GROUPS, schools: SCHOOLS, classes: CLASSES, learners: LEARNERS,
  govt_admins: GOVT_ADMINS, user_tags: USER_TAGS, class_teachers: CLASS_TEACHERS,
}

/**
 * A fake PostgREST builder: filters really filter, so a wrong .eq() or a
 * missing .in() shows up as a wrong ANSWER rather than passing silently.
 */
function makeSupabase() {
  const from = (table: string) => {
    let rows = [...(TABLES[table] ?? [])]
    const builder: Record<string, unknown> = {}
    Object.assign(builder, {
      select: () => builder,
      eq: (col: string, val: unknown) => { rows = rows.filter(r => r[col] === val); return builder },
      in: (col: string, vals: unknown[]) => { rows = rows.filter(r => vals.includes(r[col])); return builder },
      is: (col: string, val: unknown) => { rows = rows.filter(r => (r[col] ?? null) === val); return builder },
      order: () => builder,
      limit: () => builder,
      range: () => Promise.resolve({ data: rows, error: null }),
      maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
      then: (resolve: (v: { data: unknown; error: null }) => unknown) => resolve({ data: rows, error: null }),
    })
    return builder
  }
  return { from } as never
}

function makeRes() {
  const res: Record<string, unknown> = { statusCode: 0, body: null }
  res.status = (code: number) => { res.statusCode = code; return res }
  res.json = (payload: unknown) => { res.body = payload; return res }
  return res as unknown as VercelResponse & { statusCode: number; body: { error?: string } | null }
}

const req = {} as VercelRequest

/** Each caller gets a fresh uid-keyed run; resolveVisibleScope caches by uid. */
async function callerFor(authUid: string, opts: { admin?: boolean } = {}) {
  verifyAdminResult = opts.admin ? { userId: authUid } : { error: 'not admin', status: 403 }
  verifyAuthTokenResult = { valid: true, userId: authUid }
  const res = makeRes()
  const caller = await resolveVadCaller(req, res, makeSupabase())
  expect(caller).not.toBeNull()
  return caller!
}

beforeEach(() => {
  verifyAdminResult = { error: 'not admin', status: 403 }
  verifyAuthTokenResult = { valid: true, userId: 'u-gl' }
})

// ---- the ruling, level by level -------------------------------------------

describe('group leader — their own subtree, and nothing sideways', () => {
  it('sees the whole programme subtree, both regions and both schools', async () => {
    const caller = await callerFor('u-gl')
    expect(caller.ownGroupId).toBe('g-prog')
    const scope = await resolveVadScope(makeSupabase(), caller, { groupId: 'g-prog' })
    expect(isDenied(scope)).toBe(false)
    if (isDenied(scope)) return
    expect(scope.kind).toBe('group')
    expect([...scope.learnerIds].sort()).toEqual(['L1', 'L2', 'L3', 'L4'])
    expect(scope.classes.map(c => c.classId).sort()).toEqual(['c1', 'c2', 'c3'])
  })

  it('reaches a school NODE inside its subtree that is bridged by node_group_id alone', async () => {
    // s1 has no group_id — the case schoolsForGroupSubtree alone misses.
    const caller = await callerFor('u-gl')
    const scope = await resolveVadScope(makeSupabase(), caller, { groupId: 'g-node-s1' })
    expect(isDenied(scope)).toBe(false)
    if (isDenied(scope)) return
    expect([...scope.learnerIds].sort()).toEqual(['L1', 'L2', 'L3'])
  })

  it('may read a learner inside its subtree', async () => {
    const caller = await callerFor('u-gl')
    expect(await canSeeLearnerVad(caller, 'L4')).toBe(true)
  })

  it('is 403 for a learner OUTSIDE its subtree', async () => {
    const caller = await callerFor('u-glx')            // governs g-other only
    expect(await canSeeLearnerVad(caller, 'L1')).toBe(false)
    const scope = await resolveVadScope(makeSupabase(), caller, { learnerId: 'L1' })
    expect(isDenied(scope)).toBe(true)
    if (!isDenied(scope)) return
    expect(scope.status).toBe(403)
  })

  it('is 403 for a NODE outside its subtree — never sideways, never upwards', async () => {
    const caller = await callerFor('u-glx')
    const scope = await resolveVadScope(makeSupabase(), caller, { groupId: 'g-prog' })
    expect(isDenied(scope)).toBe(true)
    if (!isDenied(scope)) return
    expect(scope.status).toBe(403)
  })
})

describe('school leader — their own school, not a sibling school', () => {
  it('resolves to their own school NODE and sees its learners', async () => {
    const caller = await callerFor('u-sl1')
    expect(caller.ownGroupId).toBe('g-node-s1')
    const scope = await resolveVadScope(makeSupabase(), caller, { groupId: 'g-node-s1' })
    expect(isDenied(scope)).toBe(false)
    if (isDenied(scope)) return
    expect([...scope.learnerIds].sort()).toEqual(['L1', 'L2', 'L3'])
  })

  it('is 403 for the SIBLING school, and cannot see its learners', async () => {
    const caller = await callerFor('u-sl1')
    const scope = await resolveVadScope(makeSupabase(), caller, { groupId: 'g-node-s2' })
    expect(isDenied(scope)).toBe(true)
    if (!isDenied(scope)) return
    expect(scope.status).toBe(403)
    expect(await canSeeLearnerVad(caller, 'L4')).toBe(false)
  })

  it('cannot read UPWARDS to the programme that governs it', async () => {
    const caller = await callerFor('u-sl1')
    const scope = await resolveVadScope(makeSupabase(), caller, { groupId: 'g-prog' })
    expect(isDenied(scope)).toBe(true)
  })
})

describe('teacher — their own classes only', () => {
  it('reads their own class and its learners', async () => {
    const caller = await callerFor('u-t1')
    const scope = await resolveVadScope(makeSupabase(), caller, { classId: 'c1' })
    expect(isDenied(scope)).toBe(false)
    if (isDenied(scope)) return
    expect([...scope.learnerIds].sort()).toEqual(['L1', 'L2'])
    expect(await canSeeLearnerVad(caller, 'L1')).toBe(true)
  })

  it('is 403 for ANOTHER teacher’s class, even in the same school', async () => {
    const caller = await callerFor('u-t1')
    const scope = await resolveVadScope(makeSupabase(), caller, { classId: 'c2' })
    expect(isDenied(scope)).toBe(true)
    if (!isDenied(scope)) return
    expect(scope.status).toBe(403)
    expect(await canSeeLearnerVad(caller, 'L3')).toBe(false)
  })

  it('gets NO node-surface access — a teacher is not a leader', async () => {
    const caller = await callerFor('u-t1')
    expect(caller.ownGroupId).toBeNull()
    const scope = await resolveVadScope(makeSupabase(), caller, { groupId: 'g-node-s1' })
    expect(isDenied(scope)).toBe(true)
    if (!isDenied(scope)) return
    expect(scope.status).toBe(403)
  })
})

describe('leaders above a class reach it too', () => {
  it('the school leader reads a class in their own school', async () => {
    const caller = await callerFor('u-sl1')
    const scope = await resolveVadScope(makeSupabase(), caller, { classId: 'c2' })
    expect(isDenied(scope)).toBe(false)
  })

  it('the group leader reads a class three levels below', async () => {
    const caller = await callerFor('u-gl')
    const scope = await resolveVadScope(makeSupabase(), caller, { classId: 'c3' })
    expect(isDenied(scope)).toBe(false)
  })
})

describe('student — themselves and nobody else', () => {
  it('reads their own learner scope', async () => {
    const caller = await callerFor('u-L1')
    expect(caller.learnerId).toBe('L1')
    expect(await canSeeLearnerVad(caller, 'L1')).toBe(true)
    const scope = await resolveVadScope(makeSupabase(), caller, { learnerId: 'L1' })
    expect(isDenied(scope)).toBe(false)
    if (isDenied(scope)) return
    expect(scope.kind).toBe('learner')
    expect(scope.learnerIds).toEqual(['L1'])
  })

  it('is 403 for a CLASSMATE — nobody sees sideways', async () => {
    const caller = await callerFor('u-L1')
    expect(await canSeeLearnerVad(caller, 'L2')).toBe(false)
    const scope = await resolveVadScope(makeSupabase(), caller, { learnerId: 'L2' })
    expect(isDenied(scope)).toBe(true)
    if (!isDenied(scope)) return
    expect(scope.status).toBe(403)
  })

  it('is 403 for their own class as a scope — a student is not a teacher', async () => {
    const caller = await callerFor('u-L1')
    const scope = await resolveVadScope(makeSupabase(), caller, { classId: 'c1' })
    expect(isDenied(scope)).toBe(true)
  })
})

describe('ssi_admin — the whole forest, unchanged', () => {
  it('reads any node, any class, any learner', async () => {
    const caller = await callerFor('u-ad', { admin: true })
    expect(caller.isAdmin).toBe(true)
    for (const target of [{ groupId: 'g-prog' }, { groupId: 'g-node-s2' }, { classId: 'c2' }, { learnerId: 'L4' }]) {
      expect(isDenied(await resolveVadScope(makeSupabase(), caller, target))).toBe(false)
    }
    expect(await canSeeLearnerVad(caller, 'L4')).toBe(true)
  })
})

describe('hide, don’t zero', () => {
  it('keeps a learner with no VAD rows ON the roster — the denominator is honest', async () => {
    // L2 has no learner_lego_metrics row anywhere in this fixture. The scope
    // must still count them, so the client's summary reports 1-of-2, not 1-of-1.
    const caller = await callerFor('u-t1')
    const scope = await resolveVadScope(makeSupabase(), caller, { classId: 'c1' })
    if (isDenied(scope)) throw new Error('expected access')
    expect(scope.learnerIds).toContain('L2')
    expect(scope.learnerIds).toHaveLength(2)
  })

  it('returns an EMPTY roster, not a denial, for a legitimate scope with no students', async () => {
    const caller = await callerFor('u-glx')            // governs g-other, which has no schools
    const scope = await resolveVadScope(makeSupabase(), caller, { groupId: 'g-other' })
    expect(isDenied(scope)).toBe(false)
    if (isDenied(scope)) return
    expect(scope.learnerIds).toEqual([])
    expect(scope.classes).toEqual([])
  })
})

describe('unauthenticated', () => {
  it('is 401 with no valid token, and resolves no caller', async () => {
    verifyAdminResult = { error: 'not admin', status: 403 }
    verifyAuthTokenResult = { valid: false, error: 'Invalid token' }
    const res = makeRes()
    const caller = await resolveVadCaller(req, res, makeSupabase())
    expect(caller).toBeNull()
    expect(res.statusCode).toBe(401)
  })
})
