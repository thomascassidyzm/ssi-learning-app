/**
 * Tests for GET /api/groups/:id/home — THE VIEW's node-home payload
 * (docs/THE-VIEW.md). Pins: id resolution (group node / school id / class
 * id → one page), the map rail (ancestors root→parent, siblings, children),
 * subtree stats via the shared resolver, lens payloads as filters (never
 * separate pages), and leader scope-trimming (a govt_admin never sees
 * above their own governed group).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

process.env.SUPABASE_URL = 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'

let verifyAdminResult: any
let verifyAuthTokenResult: any
vi.mock('../../_utils/auth', () => ({
  verifyAdmin: vi.fn(async () => verifyAdminResult),
  verifyAuthToken: vi.fn(async () => verifyAuthTokenResult),
}))

// ─── Fixture tables + generic filter-applying mock builder (same harness
// shape as tree.test.ts) ───
let TABLES: Record<string, any[]>

function resetTables(): void {
  TABLES = {
    groups: [
      { id: 'nation', name: 'India', type: 'nation', parent_id: null, path: 'india', is_demo: false, is_test: false },
      { id: 'programme', name: 'IME Demo Programme', type: 'programme', parent_id: 'nation', path: 'india/ime', is_demo: true, is_test: false },
      { id: 'programme-2', name: 'Other Programme', type: 'programme', parent_id: 'nation', path: 'india/other', is_demo: false, is_test: false },
      { id: 'school-node', name: 'Sunrise Public School', type: 'school', parent_id: 'programme', path: 'india/ime/sunrise', is_demo: true, is_test: false },
    ],
    schools: [
      { id: 'school-1', school_name: 'Sunrise Public School', group_id: 'programme', node_group_id: 'school-node', platform_status: 'trial', trial_course_code: 'hin_for_eng', trial_kind: 'standard', platform_expires_at: null, teacher_seats: 3, is_demo: true, is_test: false },
    ],
    school_summary: [
      { school_id: 'school-1', school_name: 'Sunrise Public School', teacher_count: 2, class_count: 1, student_count: 2, total_practice_hours: 135.1, has_admin: true },
    ],
    classes: [
      { id: 'class-1', class_name: 'Year 6 Hindi', course_code: 'hin_for_eng', school_id: 'school-1', group_id: 'school-node', teacher_user_id: 'teacher-uid-1', is_active: true, current_seed: 60, last_lego_id: 'S0060L02', class_learner_id: 'class-learner-1' },
    ],
    // PLAY-AS-CLASS: the class's own teacher-led sessions (the primary
    // metric) + the class-entity's enrollment cursor (THE-MODEL I6).
    class_sessions: [
      { class_id: 'class-1', started_at: new Date().toISOString(), ended_at: new Date().toISOString(), duration_seconds: 1800, cycles_completed: 160, end_lego_id: 'S0060L02' },
      { class_id: 'class-1', started_at: new Date(Date.now() - 3 * 86400000).toISOString(), ended_at: new Date(Date.now() - 3 * 86400000).toISOString(), duration_seconds: 1200, cycles_completed: 110, end_lego_id: 'S0059L03' },
      { class_id: 'class-1', started_at: new Date(Date.now() - 35 * 86400000).toISOString(), ended_at: new Date(Date.now() - 35 * 86400000).toISOString(), duration_seconds: 1500, cycles_completed: 130, end_lego_id: 'S0054L01' },
    ],
    course_enrollments: [
      { learner_id: 'class-learner-1', course_id: 'hin_for_eng', highest_completed_lego_id: 'S0060L02', last_completed_lego_id: 'S0060L02', last_practiced_at: new Date().toISOString(), total_practice_minutes: 75 },
    ],
    class_teachers: [
      { class_id: 'class-1', teacher_user_id: 'teacher-uid-1', is_lead: true },
      { class_id: 'class-1', teacher_user_id: 'teacher-uid-2', is_lead: false },
    ],
    class_student_progress: [
      { class_id: 'class-1', learner_id: 'learner-1', student_name: 'Asha', seeds_completed: 25, legos_mastered: 60, total_practice_seconds: 7200, last_active_at: '2026-07-18T10:00:00Z', joined_class_at: '2026-06-01T00:00:00Z' },
      { class_id: 'class-1', learner_id: 'learner-2', student_name: 'Ravi', seeds_completed: 5, legos_mastered: 12, total_practice_seconds: 3600, last_active_at: null, joined_class_at: '2026-06-01T00:00:00Z' },
    ],
    // 80 seeds × 4 legos — seed_number/lego_index carried so the class
    // journey's LEGO-ordinal math (legoOrdinal) is exercised for real.
    course_legos: Array.from({ length: 320 }, (_, i) => ({ id: `lego-${i}`, course_code: 'hin_for_eng', seed_number: Math.floor(i / 4) + 1, lego_index: (i % 4) + 1 })),
    class_activity_stats: [
      { class_id: 'class-1', total_practice_seconds: 10800, active_students: 2, school_id: 'school-1', region_code: null, course_code: 'hin_for_eng' },
    ],
    demographic_cycle_averages: [
      { level: 'school', group_id: 'school-1', avg_cycles_per_session: 50 },
      { level: 'course', group_id: 'hin_for_eng', avg_cycles_per_session: 40 },
    ],
    learner_speaking_opportunities: [
      { learner_id: 'learner-1', day: new Date().toISOString().split('T')[0], play_seconds: 600 },
      { learner_id: 'learner-1', day: new Date(Date.now() - 86400000).toISOString().split('T')[0], play_seconds: 1200 },
    ],
    user_tags: [
      { tag_type: 'school', tag_value: 'SCHOOL:school-1', role_in_context: 'teacher', user_id: 'teacher-uid-1', removed_at: null },
      { tag_type: 'school', tag_value: 'SCHOOL:school-1', role_in_context: 'teacher', user_id: 'teacher-uid-2', removed_at: null },
      { tag_type: 'class', tag_value: 'CLASS:class-1', role_in_context: 'student', user_id: 'student-uid-1', removed_at: null },
      { tag_type: 'class', tag_value: 'CLASS:class-1', role_in_context: 'student', user_id: 'student-uid-2', removed_at: null },
    ],
    learners: [
      { user_id: 'teacher-uid-1', display_name: 'Ms Mehta' },
      { user_id: 'teacher-uid-2', display_name: 'Mr Rao' },
    ],
    govt_admins: [
      { user_id: 'leader-1', group_id: 'programme' },
    ],
  }
}

function applyFilters(rows: any[], calls: { method: string; args: any[] }[]): any[] {
  let result = rows
  for (const c of calls) {
    if (c.method === 'eq') result = result.filter((r) => r[c.args[0]] === c.args[1])
    else if (c.method === 'in') result = result.filter((r) => (c.args[1] as any[]).includes(r[c.args[0]]))
    else if (c.method === 'is') result = result.filter((r) => r[c.args[0]] === c.args[1])
    else if (c.method === 'gte') result = result.filter((r) => String(r[c.args[0]]) >= String(c.args[1]))
    else if (c.method === 'lt') result = result.filter((r) => r[c.args[0]] < c.args[1])
    else if (c.method === 'lte') result = result.filter((r) => r[c.args[0]] <= c.args[1])
    else if (c.method === 'order') {
      const [col, opts] = c.args
      const asc = (opts?.ascending ?? true) !== false
      result = [...result].sort((a, b) => (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0) * (asc ? 1 : -1))
    }
    else if (c.method === 'limit') result = result.slice(0, c.args[0])
    else if (c.method === 'like') {
      const pattern = c.args[1] as string
      const prefix = pattern.endsWith('%') ? pattern.slice(0, -1) : pattern
      result = result.filter((r) => typeof r[c.args[0]] === 'string' && r[c.args[0]].startsWith(prefix))
    }
  }
  return result
}

function makeChainable(table: string) {
  const calls: { method: string; args: any[] }[] = []
  const builder: any = {}
  const chain = (method: string) => (...args: any[]) => { calls.push({ method, args }); return builder }
  builder.select = chain('select')
  builder.eq = chain('eq')
  builder.in = chain('in')
  builder.is = chain('is')
  builder.gte = chain('gte')
  builder.lt = chain('lt')
  builder.lte = chain('lte')
  builder.like = chain('like')
  builder.order = chain('order')
  builder.limit = chain('limit')
  builder.insert = chain('insert')
  builder.single = () => {
    const rows = applyFilters(TABLES[table] || [], calls)
    return Promise.resolve({ data: rows[0] || null, error: rows[0] ? null : { message: 'no row' } })
  }
  builder.maybeSingle = () => {
    const rows = applyFilters(TABLES[table] || [], calls)
    return Promise.resolve({ data: rows[0] || null, error: null })
  }
  builder.then = (resolve: any) => {
    const rows = applyFilters(TABLES[table] || [], calls)
    return resolve({ data: rows, count: rows.length, error: null })
  }
  return builder
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: (table: string) => makeChainable(table) }),
}))

function makeReq(id: string, query: Record<string, string> = {}): VercelRequest {
  return { method: 'GET', query: { id, ...query }, headers: { authorization: 'Bearer tok' } } as any
}

function makeRes(): VercelResponse & { statusCode?: number; body?: any } {
  const res: any = {}
  res.status = vi.fn((code: number) => { res.statusCode = code; return res })
  res.json = vi.fn((body: any) => { res.body = body; return res })
  res.setHeader = vi.fn(() => res)
  return res
}

let handler: typeof import('./home').default

beforeEach(async () => {
  resetTables()
  verifyAdminResult = { error: 'Requires SSi admin access', status: 403 }
  verifyAuthTokenResult = { valid: false, error: 'no token' }
  vi.resetModules()
  handler = (await import('./home')).default
})

describe('GET /api/groups/:id/home', () => {
  it('401s an unauthenticated caller', async () => {
    const res = makeRes()
    await handler(makeReq('programme'), res)
    expect(res.statusCode).toBe(401)
  })

  it('admin gets the node home for a group: map rail + subtree stats', async () => {
    verifyAdminResult = { userId: 'admin-1' }
    const res = makeRes()
    await handler(makeReq('programme'), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.kind).toBe('node')
    expect(res.body.node.name).toBe('IME Demo Programme')
    // Ancestors run root → parent
    expect(res.body.ancestors.map((a: any) => a.id)).toEqual(['nation'])
    // Siblings at the same level, self excluded
    expect(res.body.siblings.map((s: any) => s.id)).toEqual(['programme-2'])
    // Children are the direct child nodes
    expect(res.body.children.map((c: any) => c.id)).toEqual(['school-node'])
    // Subtree rollup via the shared resolver (2 teachers, 1 class, 2 learners)
    expect(res.body.node.rollup.teacherCount).toBe(2)
    expect(res.body.node.rollup.classCount).toBe(1)
    expect(res.body.node.rollup.learnerCount).toBe(2)
    // Practice hours: subtree school_summary sum
    expect(res.body.practiceHours).toBe(135.1)
  })

  it('resolves a SCHOOL id to its node — same page, commercial state attached', async () => {
    verifyAdminResult = { userId: 'admin-1' }
    const res = makeRes()
    await handler(makeReq('school-1'), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.node.id).toBe('school-node')
    expect(res.body.node.commercial?.schoolId).toBe('school-1')
    expect(res.body.node.commercial?.platformStatus).toBe('trial')
    expect(res.body.ancestors.map((a: any) => a.id)).toEqual(['nation', 'programme'])
  })

  it('resolves a CLASS id to a class-kind home: teachers (lead first) + students as children', async () => {
    verifyAdminResult = { userId: 'admin-1' }
    const res = makeRes()
    await handler(makeReq('class-1'), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.kind).toBe('class')
    expect(res.body.node.name).toBe('Year 6 Hindi')
    // Rail runs root → … → school (the class's node chain)
    expect(res.body.ancestors.map((a: any) => a.id)).toEqual(['nation', 'programme', 'school-node'])
    // Teachers read-only, lead flagged and first
    expect(res.body.teachers[0]).toMatchObject({ user_id: 'teacher-uid-1', name: 'Ms Mehta', is_lead: true })
    expect(res.body.teachers.map((t: any) => t.user_id)).toContain('teacher-uid-2')
    // Students with hours, sorted by practice
    expect(res.body.students.map((s: any) => s.name)).toEqual(['Asha', 'Ravi'])
    expect(res.body.students[0].practice_hours).toBe(2)
    expect(res.body.node.rollup.learnerCount).toBe(2)
  })

  it('TEACHING-DATA PIN: class home carries the belt-bearing roster data + journey/benchmark cards', async () => {
    verifyAdminResult = { userId: 'admin-1' }
    const res = makeRes()
    await handler(makeReq('class-1'), res)
    expect(res.statusCode).toBe(200)

    // Per-student teaching data (what the old roster table showed): seeds
    // (the belt input), LEGOs + last-7-days for the flat student row that
    // replaced the individual learner page. NO streak fields — streaks are
    // banned (founder ruling 2026-07-19, docs/gamification-done-right.md).
    const asha = res.body.students.find((s: any) => s.name === 'Asha')
    expect(asha).toMatchObject({ seeds_completed: 25, legos_mastered: 60 })
    expect(asha.last7_minutes).toHaveLength(7)
    expect(asha.last7_minutes[6] + asha.last7_minutes[5]).toBe(30) // 600s today + 1200s yesterday
    expect(asha.week_minutes).toBe(30)
    expect(asha).not.toHaveProperty('streak_days')
    const ravi = res.body.students.find((s: any) => s.name === 'Ravi')
    expect(ravi).toMatchObject({ seeds_completed: 5, legos_mastered: 12, week_minutes: 0 })

    // Class cards: journey — now the CLASS's own play-as-class position as a
    // LEGO ordinal (S0060L02 in an 80-seed × 4-lego course = 59×4 + 2 = 238)
    // — + practice benchmark (class min/student vs school + course averages).
    expect(res.body.journey).toEqual({ done: 238, total: 320, source: 'class-play', legoId: 'S0060L02', seedNumber: 60 })
    expect(res.body.benchmark).toEqual({ class: 90, school: 30, course: 24 })
  })

  it('CLASS-PRACTICE PIN: class home leads with the class practising together — classPractice block from class_sessions, journey from the class-entity enrollment', async () => {
    verifyAdminResult = { userId: 'admin-1' }
    const res = makeRes()
    await handler(makeReq('class-1'), res)
    expect(res.statusCode).toBe(200)
    // Two of the three teacher-led sessions land in the last 7 days; the
    // newest one is today. 4500s total = 1.3h (1dp).
    expect(res.body.classPractice).toMatchObject({
      weekSessions: 2,
      sessions28d: 2,
      totalSessions: 3,
      hours: 1.3,
    })
    expect(typeof res.body.classPractice.lastSessionAt).toBe('string')
    // Journey rides the class-entity's own play-as-class cursor.
    expect(res.body.journey.source).toBe('class-play')
    expect(res.body.journey.done).toBe(238)
  })

  it('a class with NO play-as-class history falls back to the current_seed journey estimate', async () => {
    verifyAdminResult = { userId: 'admin-1' }
    TABLES.class_sessions = []
    TABLES.course_enrollments = []
    TABLES.classes[0].last_lego_id = null
    TABLES.classes[0].class_learner_id = null
    const res = makeRes()
    await handler(makeReq('class-1'), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.classPractice).toMatchObject({ weekSessions: 0, totalSessions: 0, hours: 0, lastSessionAt: null })
    expect(res.body.journey).toEqual({ done: 60, total: 320, source: 'estimate', legoId: null, seedNumber: null })
  })

  it('node home carries the subtree CLASS PRACTICE rollup (hours, weekly sessions, active classes)', async () => {
    verifyAdminResult = { userId: 'admin-1' }
    const res = makeRes()
    await handler(makeReq('programme'), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.classPractice).toEqual({ hours: 1.3, sessions7d: 2, activeClasses7d: 1, classCount: 1 })
  })

  it('lens=schools returns the subtree-wide schools list with teacher names', async () => {
    verifyAdminResult = { userId: 'admin-1' }
    const res = makeRes()
    await handler(makeReq('programme', { lens: 'schools' }), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.schools).toHaveLength(1)
    expect(res.body.schools[0]).toMatchObject({
      schoolId: 'school-1',
      nodeId: 'school-node',
      studentCount: 2,
      practiceHours: 135.1,
    })
    expect(res.body.schools[0].teachers).toEqual(['Mr Rao', 'Ms Mehta'])
  })

  it('lens=teachers returns every teacher below with their classes', async () => {
    verifyAdminResult = { userId: 'admin-1' }
    const res = makeRes()
    await handler(makeReq('programme', { lens: 'teachers' }), res)
    expect(res.statusCode).toBe(200)
    const names = res.body.teachers.map((t: any) => t.name)
    expect(names).toEqual(['Mr Rao', 'Ms Mehta'])
    const mehta = res.body.teachers.find((t: any) => t.name === 'Ms Mehta')
    expect(mehta.classes.map((c: any) => c.name)).toEqual(['Year 6 Hindi'])
  })

  it('lens=classes returns every class below with counts', async () => {
    verifyAdminResult = { userId: 'admin-1' }
    const res = makeRes()
    await handler(makeReq('programme', { lens: 'classes' }), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.classes).toHaveLength(1)
    expect(res.body.classes[0]).toMatchObject({ name: 'Year 6 Hindi', studentCount: 2, practiceHours: 3, classPracticeHours: 1.3 })
    expect(typeof res.body.classes[0].lastClassSessionAt).toBe('string')
  })

  it('a group leader is scope-trimmed: no ancestors or siblings above their own group', async () => {
    verifyAuthTokenResult = { valid: true, userId: 'leader-1' }
    const res = makeRes()
    await handler(makeReq('programme'), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.ancestors).toEqual([])
    expect(res.body.siblings).toEqual([])
    expect(res.body.children.map((c: any) => c.id)).toEqual(['school-node'])
  })

  it('403s a leader asking for a group outside their subtree', async () => {
    verifyAuthTokenResult = { valid: true, userId: 'leader-1' }
    const res = makeRes()
    await handler(makeReq('programme-2'), res)
    expect(res.statusCode).toBe(403)
  })
})
