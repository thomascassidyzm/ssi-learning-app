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
      { id: 'class-1', class_name: 'Year 6 Hindi', course_code: 'hin_for_eng', school_id: 'school-1', group_id: 'school-node', teacher_user_id: 'teacher-uid-1', is_active: true, current_seed: 60 },
    ],
    class_teachers: [
      { class_id: 'class-1', teacher_user_id: 'teacher-uid-1', is_lead: true },
      { class_id: 'class-1', teacher_user_id: 'teacher-uid-2', is_lead: false },
    ],
    class_student_progress: [
      { class_id: 'class-1', learner_id: 'learner-1', student_name: 'Asha', seeds_completed: 25, legos_mastered: 60, total_practice_seconds: 7200, last_active_at: '2026-07-18T10:00:00Z', joined_class_at: '2026-06-01T00:00:00Z' },
      { class_id: 'class-1', learner_id: 'learner-2', student_name: 'Ravi', seeds_completed: 5, legos_mastered: 12, total_practice_seconds: 3600, last_active_at: null, joined_class_at: '2026-06-01T00:00:00Z' },
    ],
    course_legos: Array.from({ length: 320 }, (_, i) => ({ id: `lego-${i}`, course_code: 'hin_for_eng' })),
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
  builder.like = chain('like')
  builder.order = chain('order')
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

    // Class cards: journey (course_legos total, class cursor done) +
    // practice benchmark (class min/student vs school + course averages).
    expect(res.body.journey).toEqual({ done: 60, total: 320 })
    expect(res.body.benchmark).toEqual({ class: 90, school: 30, course: 24 })
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
    expect(res.body.classes[0]).toMatchObject({ name: 'Year 6 Hindi', studentCount: 2, practiceHours: 3 })
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
