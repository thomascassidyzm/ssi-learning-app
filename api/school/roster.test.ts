/**
 * Tests for GET /api/school/roster — the server-mediated read that fixes the
 * "school admin sees 0 staff / 0 students" bug (school_summary/user_tags/
 * class_teachers/class_student_progress are RLS-invoker views/tables whose
 * SELECT policy misses a school_admin invite-born via the newer
 * school_admin_join redemption path — a direct client read as that admin's
 * own session silently zeroed every other teacher/student). resolveVisibleScope
 * is mocked — authorization itself is that function's own responsibility/tests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-key'

vi.mock('../_utils/auth', () => ({
  verifyAuthToken: vi.fn(async () => ({ valid: true, userId: 'caller-1' })),
}))

let scope: any
let schoolIdForStaffMemberResult: string | null = null
vi.mock('../_utils/schoolScope', () => ({
  resolveVisibleScope: vi.fn(async () => scope),
  schoolIdForStaffMember: vi.fn(async () => schoolIdForStaffMemberResult),
  chunk: (arr: any[], size = 150) => {
    const out = []
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
    return out
  },
}))

let DB: Record<string, any[]>

function makeChainable(table: string) {
  let rows: any[] = [...((DB as any)[table] ?? [])]
  let single = false
  const builder: any = {
    select: () => builder,
    eq: (col: string, val: unknown) => { rows = rows.filter((r) => r[col] === val); return builder },
    in: (col: string, vals: unknown[]) => { rows = rows.filter((r) => vals.includes(r[col])); return builder },
    is: (col: string) => { rows = rows.filter((r) => r[col] == null); return builder },
    order: () => builder,
    limit: (n: number) => { rows = rows.slice(0, n); return builder },
    maybeSingle: () => { single = true; return builder },
    then: (resolve: any) => Promise.resolve({ data: single ? (rows[0] ?? null) : rows, error: null }).then(resolve),
  }
  return builder
}

// AUTH_EMAILS backs svc.auth.admin.getUserById — the ONLY place roster.ts
// reads an address, and only for a pending arrival at a school that has
// claimed a domain (the sort hint). Empty by default, so the hint costs
// nothing in every other test.
let AUTH_EMAILS: Record<string, string> = {}
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => makeChainable(table),
    auth: {
      admin: {
        getUserById: async (uid: string) =>
          AUTH_EMAILS[uid] ? { data: { user: { email: AUTH_EMAILS[uid] } } } : { data: { user: null } },
      },
    },
  }),
}))

function makeReq(query: Record<string, string> = {}): VercelRequest {
  return { method: 'GET', query, headers: { authorization: 'Bearer tok' } } as any
}

function makeRes(): VercelResponse & { statusCode?: number; body?: any } {
  const res: any = {}
  res.setHeader = vi.fn()
  res.status = vi.fn((code: number) => { res.statusCode = code; return res })
  res.json = vi.fn((body: any) => { res.body = body; return res })
  return res
}

let handler: typeof import('./roster').default

beforeEach(async () => {
  vi.resetModules()
  handler = (await import('./roster')).default
  DB = {
    school_summary: [
      { school_id: 's1', school_name: 'Sunrise', admin_user_id: null, teacher_count: 2, class_count: 3, student_count: 3, total_practice_hours: 3, has_admin: true },
    ],
    classes: [
      { id: 'c1', school_id: 's1', is_active: true, teacher_user_id: 'ut1' },
      { id: 'c2', school_id: 's1', is_active: true, teacher_user_id: 'ut1' },
      { id: 'c3', school_id: 's1', is_active: true, teacher_user_id: 'ut2' },
      // A tutor-lane class: no school at all.
      { id: 'c9', school_id: null, is_active: true, teacher_user_id: 'ut9' },
    ],
    schools: [{ id: 's1', admin_user_id: 'admin-1' }],
    user_tags: [
      { id: 't1', user_id: 'ut1', added_at: '2025-01-01', tag_value: 'SCHOOL:s1', tag_type: 'school', role_in_context: 'teacher', removed_at: null },
      { id: 't2', user_id: 'ut2', added_at: '2025-02-01', tag_value: 'SCHOOL:s1', tag_type: 'school', role_in_context: 'teacher', removed_at: null },
      // The supply teacher: on class c2, never given a SCHOOL: tag.
      { id: 't3', user_id: 'ut3', added_at: '2025-03-01', tag_value: 'CLASS:c2', tag_type: 'class', role_in_context: 'teacher', removed_at: null },
    ],
    class_teachers: [
      // ut1 was put on both classes BY THE ADMIN — that is the vouch, and the
      // earliest of the two is the one that counts.
      { class_id: 'c1', teacher_user_id: 'ut1', added_at: '2025-01-05', added_by: 'admin-1' },
      { class_id: 'c2', teacher_user_id: 'ut1', added_at: '2025-01-09', added_by: 'admin-1' },
      // The supply teacher, put on c2 by the class's own lead teacher.
      { class_id: 'c2', teacher_user_id: 'ut3', added_at: '2025-03-01', added_by: 'ut1' },
      // ut2 made her own class. Ordinary, and never flagged.
      { class_id: 'c3', teacher_user_id: 'ut2', added_at: '2025-02-02', added_by: 'ut2' },
    ],
    class_student_progress: [
      { class_id: 'c1', student_user_id: 'su1', learner_id: 'sl1', student_name: 'Alice', class_name: 'Welsh', course_code: 'cym', seeds_completed: 10, legos_mastered: 2, total_practice_seconds: 3600, last_active_at: null, joined_class_at: '2025-01-01' },
      { class_id: 'c1', student_user_id: 'su2', learner_id: 'sl2', student_name: 'Bob', class_name: 'Welsh', course_code: 'cym', seeds_completed: 5, legos_mastered: 1, total_practice_seconds: 7200, last_active_at: null, joined_class_at: '2025-01-02' },
      { class_id: 'c3', student_user_id: 'su3', learner_id: 'sl3', student_name: 'Cai', class_name: 'Spanish', course_code: 'spa', seeds_completed: 1, legos_mastered: 0, total_practice_seconds: 1800, last_active_at: null, joined_class_at: '2025-01-03' },
    ],
    learners: [
      { id: 'l1', user_id: 'ut1', display_name: 'Zara Teacher' },
      { id: 'l2', user_id: 'ut2', display_name: 'Alice Teacher' },
      { id: 'l3', user_id: 'ut3', display_name: 'Supply Teacher' },
      { id: 'l9', user_id: 'ut9', display_name: 'Tutor Teacher' },
      { id: 'la', user_id: 'admin-1', display_name: 'School Admin', platform_role: null, educational_role: 'school_admin' },
    ],
    sessions: [
      { learner_id: 'l1', duration_seconds: 241 },
      { learner_id: 'l1', duration_seconds: 6 },
    ],
  }
  scope = { learnerId: 'l1', role: 'school_admin', classIds: ['c1', 'c2', 'c3'], learnerIds: [], studentsByClass: {}, schoolIds: ['s1'], groupId: null }
  schoolIdForStaffMemberResult = null
  AUTH_EMAILS = {}
})

describe('GET /api/school/roster', () => {
  it('returns the school totals + full teacher/student lists for a school_admin', async () => {
    const req = makeReq()
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(200)
    expect(res.body.school.school_id).toBe('s1')
    // 3 = the two SCHOOL:-tagged teachers plus the supply teacher who only
    // ever got a CLASS: tag (guard S8 — they used to be invisible here).
    expect(res.body.teachers).toHaveLength(3)
    expect(res.body.students).toHaveLength(3)
  })

  it('includes a class-only teacher (CLASS: tag, no SCHOOL: tag) on the school roster', async () => {
    const req = makeReq()
    const res = makeRes()
    await handler(req, res)
    const supply = res.body.teachers.find((t: any) => t.display_name === 'Supply Teacher')
    expect(supply).toBeTruthy()
    expect(supply.class_count).toBe(1)
    // No SCHOOL: tag means no join date to report — reported as blank, not faked.
    expect(supply.joined_at).toBe('')
  })

  it('gives a TEACHER caller only their OWN classes\' students (founder ruling 2026-07-30)', async () => {
    scope = { ...scope, role: 'teacher', classIds: ['c3'], schoolIds: [] }
    schoolIdForStaffMemberResult = 's1'
    const req = makeReq()
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(200)
    // c3 holds only Cai; Alice and Bob are in c1, which this teacher does not teach.
    expect(res.body.students.map((s: any) => s.display_name)).toEqual(['Cai'])
    // The staff list stays school-wide — it carries no pupil data and it is
    // what the co-teacher picker needs.
    expect(res.body.teachers.length).toBe(3)
  })

  it('attributes class/student/hour counts per teacher via the class_teachers relationship', async () => {
    const req = makeReq()
    const res = makeRes()
    await handler(req, res)
    const zara = res.body.teachers.find((t: any) => t.display_name === 'Zara Teacher')
    expect(zara.class_count).toBe(2)
    expect(zara.student_count).toBe(2)
    // (3600 + 7200) / 3600 = 3.0 hours
    expect(zara.total_practice_minutes).toBe(180)
  })

  it('reports each teacher\'s OWN practice from their learner\'s sessions (the Chepstow trial-school zero)', async () => {
    const req = makeReq()
    const res = makeRes()
    await handler(req, res)
    const zara = res.body.teachers.find((t: any) => t.display_name === 'Zara Teacher')
    const alice = res.body.teachers.find((t: any) => t.display_name === 'Alice Teacher')
    // (241 + 6) / 60 rounds to 4 minutes — students' class hours must not absorb it
    expect(zara.own_practice_minutes).toBe(4)
    expect(alice.own_practice_minutes).toBe(0)
  })

  it('sorts teachers and students alphabetically', async () => {
    const req = makeReq()
    const res = makeRes()
    await handler(req, res)
    expect(res.body.teachers.map((t: any) => t.display_name)).toEqual(['Alice Teacher', 'Supply Teacher', 'Zara Teacher'])
    expect(res.body.students.map((s: any) => s.display_name)).toEqual(['Alice', 'Bob', 'Cai'])
  })

  it('resolves a teacher caller\'s own school via schoolIdForStaffMember (resolveVisibleScope leaves teacher schoolIds empty)', async () => {
    scope = { ...scope, role: 'teacher', schoolIds: [] }
    schoolIdForStaffMemberResult = 's1'
    const req = makeReq()
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(200)
    expect(res.body.school.school_id).toBe('s1')
  })

  it('returns an empty roster (not a 500) when the caller has no resolvable school', async () => {
    scope = { ...scope, role: 'teacher', schoolIds: [] }
    schoolIdForStaffMemberResult = null
    const req = makeReq()
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ school: null, teachers: [], students: [] })
  })

  it('403s a govt_admin caller (own-school endpoint, not the group rollup)', async () => {
    scope = { ...scope, role: 'govt_admin', schoolIds: ['s1', 's2'] }
    const req = makeReq()
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(403)
  })

  it('401s an unauthenticated caller', async () => {
    const { verifyAuthToken } = await import('../_utils/auth')
    ;(verifyAuthToken as any).mockResolvedValueOnce({ valid: false, error: 'no token' })
    const req = makeReq()
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(401)
  })

  // ── ?class_id= — the co-teacher picker's lookup ────────────────────────
  describe('?class_id= teacher lookup', () => {
    it('returns the school\'s teacher NAMES — and no pupil data — to a teacher of that class', async () => {
      const { verifyAuthToken } = await import('../_utils/auth')
      ;(verifyAuthToken as any).mockResolvedValueOnce({ valid: true, userId: 'ut1' })
      const res = makeRes()
      await handler(makeReq({ class_id: 'c2' }), res)
      expect(res.statusCode).toBe(200)
      expect(res.body.teachers.map((t: any) => t.display_name))
        .toEqual(['Alice Teacher', 'Supply Teacher', 'Zara Teacher'])
      // Names only: no aggregates, no students, anywhere in the payload.
      expect(Object.keys(res.body.teachers[0])).toEqual(['user_id', 'learner_id', 'display_name'])
      expect(res.body.students).toBeUndefined()
    })

    it('authorises a co-teacher who holds only a CLASS: tag (the supply-teacher case)', async () => {
      const { verifyAuthToken } = await import('../_utils/auth')
      ;(verifyAuthToken as any).mockResolvedValueOnce({ valid: true, userId: 'ut3' })
      const res = makeRes()
      await handler(makeReq({ class_id: 'c2' }), res)
      expect(res.statusCode).toBe(200)
      expect(res.body.teachers.length).toBe(3)
    })

    it('authorises the class\'s school admin', async () => {
      const { verifyAuthToken } = await import('../_utils/auth')
      ;(verifyAuthToken as any).mockResolvedValueOnce({ valid: true, userId: 'admin-1' })
      const res = makeRes()
      await handler(makeReq({ class_id: 'c2' }), res)
      expect(res.statusCode).toBe(200)
    })

    // TENANCY-08: an admin under the TAG spelling is the same principal as the
    // schools.admin_user_id founding pointer, and gets the same class roster.
    it('authorises a TAG-spelled school admin of the class (TENANCY-08)', async () => {
      DB.user_tags.push({
        id: 'tadm', user_id: 'admin-2', added_at: '2025-04-01',
        tag_value: 'SCHOOL:s1', tag_type: 'school', role_in_context: 'admin', removed_at: null,
      })
      const { verifyAuthToken } = await import('../_utils/auth')
      ;(verifyAuthToken as any).mockResolvedValueOnce({ valid: true, userId: 'admin-2' })
      const res = makeRes()
      await handler(makeReq({ class_id: 'c2' }), res)
      expect(res.statusCode).toBe(200)
    })

    it('403s a tag-spelled admin of a DIFFERENT school', async () => {
      DB.user_tags.push({
        id: 'tadm2', user_id: 'admin-3', added_at: '2025-04-01',
        tag_value: 'SCHOOL:s2', tag_type: 'school', role_in_context: 'admin', removed_at: null,
      })
      const { verifyAuthToken } = await import('../_utils/auth')
      ;(verifyAuthToken as any).mockResolvedValueOnce({ valid: true, userId: 'admin-3' })
      const res = makeRes()
      await handler(makeReq({ class_id: 'c2' }), res)
      expect(res.statusCode).toBe(403)
    })

    it('403s an authenticated NON-member of the class', async () => {
      const { verifyAuthToken } = await import('../_utils/auth')
      ;(verifyAuthToken as any).mockResolvedValueOnce({ valid: true, userId: 'stranger' })
      const res = makeRes()
      await handler(makeReq({ class_id: 'c2' }), res)
      expect(res.statusCode).toBe(403)
    })

    it('403s a teacher of a DIFFERENT class in the same school', async () => {
      const { verifyAuthToken } = await import('../_utils/auth')
      ;(verifyAuthToken as any).mockResolvedValueOnce({ valid: true, userId: 'ut2' })
      const res = makeRes()
      await handler(makeReq({ class_id: 'c2' }), res)
      expect(res.statusCode).toBe(403)
    })

    it('401s an unauthenticated caller before touching the class', async () => {
      const { verifyAuthToken } = await import('../_utils/auth')
      ;(verifyAuthToken as any).mockResolvedValueOnce({ valid: false, error: 'no token' })
      const res = makeRes()
      await handler(makeReq({ class_id: 'c2' }), res)
      expect(res.statusCode).toBe(401)
    })

    it('404s an unknown class', async () => {
      const res = makeRes()
      await handler(makeReq({ class_id: 'nope' }), res)
      expect(res.statusCode).toBe(404)
    })

    it('falls back to the class\'s own teachers for a school-less tutor class', async () => {
      const { verifyAuthToken } = await import('../_utils/auth')
      ;(verifyAuthToken as any).mockResolvedValueOnce({ valid: true, userId: 'ut9' })
      const res = makeRes()
      await handler(makeReq({ class_id: 'c9' }), res)
      expect(res.statusCode).toBe(200)
      expect(res.body.school_id).toBeNull()
      expect(res.body.teachers).toEqual([])
    })
  })

  it('405s a non-GET request', async () => {
    const req = { ...makeReq(), method: 'POST' } as any
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(405)
  })

  // --- The founding admin belongs in her own school's staff list. ---
  // Regression for Chepstow (2026-08-06): the head had 76 min across 19
  // sessions, her dashboard headline showed 7m (the two invited teachers only),
  // and she was absent from her own Teachers list — because this read filtered
  // role_in_context='teacher' STRICTLY while staff_practice_hours already
  // counted teacher OR admin. One definition of staff now.
  describe('school ADMIN membership (role_in_context = admin)', () => {
    beforeEach(() => {
      DB.user_tags.push({ user_id: 'admin-uid', added_at: '2025-03-01', tag_value: 'SCHOOL:s1', tag_type: 'school', role_in_context: 'admin', removed_at: null })
      DB.learners.push({ id: 'l-admin', user_id: 'admin-uid', display_name: 'Angharad Head' })
      DB.sessions.push({ learner_id: 'l-admin', duration_seconds: 4560 }) // 76 min
    })

    it('includes the school ADMIN in the staff list, with her own practice', async () => {
      const res = makeRes()
      await handler(makeReq(), res)
      expect(res.statusCode).toBe(200)
      // ut1 + ut2 (SCHOOL: tags), ut3 (co-teacher via class_teachers only,
      // no SCHOOL: tag — the staff UNION), and now the admin herself.
      expect(res.body.teachers.map((t: any) => t.user_id).sort())
        .toEqual(['admin-uid', 'ut1', 'ut2', 'ut3'])
      const admin = res.body.teachers.find((t: any) => t.user_id === 'admin-uid')
      expect(admin).toBeDefined()
      expect(admin.own_practice_minutes).toBe(76)
    })

    it('labels her as the ADMIN she is — never mislabelled a teacher', async () => {
      const res = makeRes()
      await handler(makeReq(), res)
      const rows = res.body.teachers
      expect(rows.find((t: any) => t.user_id === 'admin-uid').role_in_context).toBe('admin')
      expect(rows.find((t: any) => t.user_id === 'ut1').role_in_context).toBe('teacher')
    })

    it('still excludes STUDENT tags on the same school', async () => {
      DB.user_tags.push({ user_id: 'stu-uid', added_at: '2025-04-01', tag_value: 'SCHOOL:s1', tag_type: 'school', role_in_context: 'student', removed_at: null })
      DB.learners.push({ id: 'l-stu', user_id: 'stu-uid', display_name: 'Not Staff' })
      const res = makeRes()
      await handler(makeReq(), res)
      expect(res.body.teachers.map((t: any) => t.user_id)).not.toContain('stu-uid')
    })
  })
})

describe('GET /api/school/roster — the unassigned teacher (job #713 check two)', () => {
  it('a teacher with a SCHOOL tag and ZERO classes gets NO pupil rows at all', async () => {
    // The load-bearing assumption of the whole school-belonging mechanism: the
    // door can stay wide open BECAUSE an arrival nobody has vouched for can
    // see nothing. The route walk found no leak anywhere, but this route is
    // the near-miss — it pulls the WHOLE school's pupil rows into memory and
    // filters them down to scope.classIds on the way out. That filter is
    // correct today and is one careless simplification away from not being,
    // so it is pinned here for the exact caller shape that matters.
    scope = { learnerId: 'lx', role: 'teacher', classIds: [], learnerIds: [], studentsByClass: {}, schoolIds: [], groupId: null }
    schoolIdForStaffMemberResult = 's1'
    const res = makeRes()
    await handler(makeReq(), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.students).toEqual([])
    // The staff list is not pupil data and stays visible — it is what the
    // co-teacher picker needs, and it is how the admin sees this person too.
    expect(res.body.teachers.length).toBeGreaterThan(0)
  })
})

describe('GET /api/school/roster — the vouch (school-belonging design, 2026-09-09)', () => {
  it('reports WHO put each teacher on a class of this school, and when — the earliest act by somebody else', async () => {
    const res = makeRes()
    await handler(makeReq(), res)
    const zara = res.body.teachers.find((t: any) => t.display_name === 'Zara Teacher')
    expect(zara.vouched_by).toBe('admin-1')
    expect(zara.vouched_at).toBe('2025-01-05')
    expect(zara.self_assigned).toBe(false)
  })

  it('counts a co-teacher added by the class\'s own lead as vouched — the lead already holds the school', async () => {
    const res = makeRes()
    await handler(makeReq(), res)
    const supply = res.body.teachers.find((t: any) => t.display_name === 'Supply Teacher')
    expect(supply.vouched_by).toBe('ut1')
  })

  it('a teacher who made their own class is self_assigned, NOT vouched and NOT flagged', async () => {
    const res = makeRes()
    await handler(makeReq(), res)
    const alice = res.body.teachers.find((t: any) => t.display_name === 'Alice Teacher')
    expect(alice.vouched_by).toBeNull()
    expect(alice.self_assigned).toBe(true)
    // She still has her class, so she is not pending — that is what the
    // Teachers page sections on.
    expect(alice.class_count).toBe(1)
  })

  it('an arrival with no class at all is pending: no vouch, not self-assigned', async () => {
    DB.user_tags.push({ id: 't4', user_id: 'ut4', added_at: '2025-09-01', tag_value: 'SCHOOL:s1', tag_type: 'school', role_in_context: 'teacher', removed_at: null })
    DB.learners.push({ id: 'l4', user_id: 'ut4', display_name: 'New Arrival' })
    const res = makeRes()
    await handler(makeReq(), res)
    const arrival = res.body.teachers.find((t: any) => t.display_name === 'New Arrival')
    expect(arrival.class_count).toBe(0)
    expect(arrival.vouched_by).toBeNull()
    expect(arrival.vouched_at).toBeNull()
    expect(arrival.self_assigned).toBe(false)
  })

  it('the domain match is a SORT HINT on pending arrivals only — never resolved for anyone who already has classes', async () => {
    DB.school_identity_claims = [{ kind: 'domain', value: 'sunrise.sch.uk', school_id: 's1' }]
    DB.user_tags.push({ id: 't4', user_id: 'ut4', added_at: '2025-09-01', tag_value: 'SCHOOL:s1', tag_type: 'school', role_in_context: 'teacher', removed_at: null })
    DB.user_tags.push({ id: 't5', user_id: 'ut5', added_at: '2025-09-02', tag_value: 'SCHOOL:s1', tag_type: 'school', role_in_context: 'teacher', removed_at: null })
    DB.learners.push({ id: 'l4', user_id: 'ut4', display_name: 'Staff Arrival' })
    DB.learners.push({ id: 'l5', user_id: 'ut5', display_name: 'Stranger Arrival' })
    AUTH_EMAILS = {
      ut4: 'newteacher@sunrise.sch.uk',
      ut5: 'someone@gmail.com',
      // Zara HAS classes; if the hint ever resolved for her this would show up.
      ut1: 'zara@gmail.com',
    }
    const res = makeRes()
    await handler(makeReq(), res)
    const by = (n: string) => res.body.teachers.find((t: any) => t.display_name === n)
    expect(by('Staff Arrival').on_domain).toBe(true)
    expect(by('Stranger Arrival').on_domain).toBe(false)
    expect(by('Zara Teacher').on_domain).toBeNull()
  })

  it('a school that has claimed nothing resolves no hint at all — no address is read', async () => {
    DB.user_tags.push({ id: 't4', user_id: 'ut4', added_at: '2025-09-01', tag_value: 'SCHOOL:s1', tag_type: 'school', role_in_context: 'teacher', removed_at: null })
    DB.learners.push({ id: 'l4', user_id: 'ut4', display_name: 'New Arrival' })
    AUTH_EMAILS = { ut4: 'someone@gmail.com' }
    const res = makeRes()
    await handler(makeReq(), res)
    expect(res.body.teachers.find((t: any) => t.display_name === 'New Arrival').on_domain).toBeNull()
  })
})
