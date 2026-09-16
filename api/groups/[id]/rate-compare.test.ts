/**
 * Tests for GET /api/groups/:id/rate-compare — THE LENS's node-scoped engine.
 * Pins: id resolution (group node / school id / class id), the ancestor-chain
 * compare options (nearest first, parent's average as default), course
 * defaulting (busiest course below the node), the three authz doors (admin /
 * leader subtree / teacher class-membership), the K_FLOOR privacy floor for
 * non-admin callers (admin floor = 1), and cohort anonymity (no peer name or
 * id ever leaves the server).
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

let visibleScopeResult: any
vi.mock('../../_utils/schoolScope', () => ({
  chunk: <T,>(arr: T[], size = 150): T[][] => {
    const out: T[][] = []
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
    return out
  },
  resolveVisibleScope: vi.fn(async () => visibleScopeResult),
  ownSchoolIdForNode: vi.fn(async (_svc: any, nodeId: string) =>
    TABLES.schools.find((s: any) => s.node_group_id === nodeId)?.id ?? null),
  isStrictDescendantGroup: vi.fn(async (_svc: any, ancestorId: string, targetId: string) => {
    if (ancestorId === targetId) return false
    const anc = TABLES.groups.find((g: any) => g.id === ancestorId)
    const target = TABLES.groups.find((g: any) => g.id === targetId)
    return Boolean(anc?.path && target?.path && target.path !== anc.path && target.path.startsWith(anc.path))
  }),
}))

let coverageExpired = false
vi.mock('../../_utils/schoolCoverageGate', () => ({
  isEntityCoverageExpired: vi.fn(async () => coverageExpired),
}))
vi.mock('../../_utils/schoolNode', () => ({
  ensureSchoolNode: vi.fn(async () => null), // fixtures always carry node_group_id
}))

// ─── Fixture forest + sessions ───
const DAY = 86_400_000
const NOW = Date.now()
const daysAgo = (n: number) => new Date(NOW - n * DAY).toISOString()

let TABLES: Record<string, any[]>
let SESSION_ROWS: any[]

function sessions(classId: string, course: string, ords: [number, number][]): any[] {
  // two sessions: 7 days ago + now -> first-activity-to-now span = 1 week
  // -> pace = legos advanced (pace math is anchored to NOW, not last session)
  return ords.map(([startOrd, endOrd], i) => ({
    class_id: classId,
    course_code: course,
    start_lego_id: `S${startOrd}L01`,
    end_lego_id: `S${endOrd}L01`,
    start_ord: startOrd,
    end_ord: endOrd,
    duration_seconds: 1800,
    started_at: daysAgo(7 - i * 7),
  }))
}

function resetTables(): void {
  TABLES = {
    groups: [
      { id: 'nation', name: 'India', type: 'nation', parent_id: null, path: 'india', is_demo: false },
      { id: 'programme', name: 'IME Demo Programme', type: 'programme', parent_id: 'nation', path: 'india/ime', is_demo: false },
      { id: 'other-prog', name: 'Other Programme', type: 'programme', parent_id: 'nation', path: 'india/other', is_demo: false },
      { id: 's1-node', name: 'Sunrise Public School', type: 'school', parent_id: 'programme', path: 'india/ime/s1', is_demo: false },
      { id: 's2-node', name: 'St. Mary’s Academy', type: 'school', parent_id: 'programme', path: 'india/ime/s2', is_demo: false },
      { id: 's3-node', name: 'Green Valley International', type: 'school', parent_id: 'other-prog', path: 'india/other/s3', is_demo: false },
    ],
    schools: [
      { id: 'school-1', school_name: 'Sunrise Public School', group_id: 'programme', node_group_id: 's1-node', is_demo: false },
      { id: 'school-2', school_name: 'St. Mary’s Academy', group_id: 'programme', node_group_id: 's2-node', is_demo: false },
      { id: 'school-3', school_name: 'Green Valley International', group_id: 'other-prog', node_group_id: 's3-node', is_demo: false },
    ],
    classes: [
      { id: 'c1', class_name: 'Year 6 Hindi', course_code: 'hin_for_eng', school_id: 'school-1', group_id: 's1-node', is_active: true },
      { id: 'c2', class_name: 'Year 5 Hindi', course_code: 'hin_for_eng', school_id: 'school-2', group_id: 's2-node', is_active: true },
      { id: 'c3', class_name: 'Year 4 Hindi', course_code: 'hin_for_eng', school_id: 'school-2', group_id: 's2-node', is_active: true },
      { id: 'c4', class_name: 'Year 6 Tamil', course_code: 'tam_for_eng', school_id: 'school-2', group_id: 's2-node', is_active: true },
      { id: 'c5', class_name: 'Year 3 Hindi', course_code: 'hin_for_eng', school_id: 'school-3', group_id: 's3-node', is_active: true },
    ],
    course_legos: [
      // c1's furthest position (end_lego_id S10L01) — content the position line renders
      { course_code: 'hin_for_eng', lego_id: 'S10L01', target_text: 'मैं सीखना चाहता हूँ', target_text_roman: 'main seekhna chaahta hoon', known_text: 'I want to learn' },
    ],
  }
  SESSION_ROWS = [
    ...sessions('c1', 'hin_for_eng', [[0, 5], [5, 10]]),   // pace 10
    ...sessions('c2', 'hin_for_eng', [[0, 4], [4, 8]]),    // pace 8
    ...sessions('c3', 'hin_for_eng', [[0, 2], [2, 4]]),    // pace 4
    ...sessions('c4', 'tam_for_eng', [[0, 20], [20, 40]]), // pace 40
    ...sessions('c5', 'hin_for_eng', [[0, 6], [6, 12]]),   // pace 12
  ]
}

function applyFilters(rows: any[], calls: { method: string; args: any[] }[]): any[] {
  let result = rows
  for (const c of calls) {
    if (c.method === 'eq') result = result.filter((r) => r[c.args[0]] === c.args[1])
    else if (c.method === 'neq') result = result.filter((r) => r[c.args[0]] !== c.args[1])
    else if (c.method === 'in') result = result.filter((r) => (c.args[1] as any[]).includes(r[c.args[0]]))
    else if (c.method === 'is') result = result.filter((r) => r[c.args[0]] === c.args[1])
    else if (c.method === 'not') result = result.filter((r) => r[c.args[0]] !== null)
    else if (c.method === 'gte') result = result.filter((r) => r[c.args[0]] >= c.args[1])
    else if (c.method === 'range') result = result.slice(c.args[0], c.args[1] + 1)
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
  for (const m of ['select', 'eq', 'neq', 'in', 'is', 'not', 'like', 'gte', 'order', 'limit', 'range']) builder[m] = chain(m)
  builder.maybeSingle = () => {
    const rows = applyFilters(TABLES[table] || [], calls)
    return Promise.resolve({ data: rows[0] || null, error: null })
  }
  builder.then = (resolve: any) => {
    const rows = applyFilters(TABLES[table] || [], calls)
    return resolve({ data: rows, error: null })
  }
  return builder
}

let lastRpcArgs: any = null
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => makeChainable(table),
    rpc: (fn: string, args: any) => {
      if (fn !== 'analytics_class_sessions_scoped') return Promise.resolve({ data: null, error: { message: `unknown rpc ${fn}` } })
      lastRpcArgs = args
      const ids = (args?.p_class_ids ?? []) as string[]
      return Promise.resolve({ data: SESSION_ROWS.filter((r) => ids.includes(r.class_id)), error: null })
    },
  }),
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

const EMPTY_SCOPE = {
  learnerId: null, role: null, classIds: [], learnerIds: [], studentsByClass: {}, schoolIds: [], groupId: null,
}

let handler: typeof import('./rate-compare').default

beforeEach(async () => {
  resetTables()
  coverageExpired = false
  verifyAdminResult = { error: 'Requires SSi admin access', status: 403 }
  verifyAuthTokenResult = { valid: false, error: 'no token' }
  visibleScopeResult = { ...EMPTY_SCOPE }
  vi.resetModules()
  handler = (await import('./rate-compare')).default
})

describe('GET /api/groups/:id/rate-compare', () => {
  it('401s an unauthenticated caller', async () => {
    const res = makeRes()
    await handler(makeReq('programme'), res)
    expect(res.statusCode).toBe(401)
  })

  it('admin · class entity: ancestor chain starts at its own school, defaults to it', async () => {
    verifyAdminResult = { userId: 'admin-1' }
    const res = makeRes()
    await handler(makeReq('c1'), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.node).toEqual({ id: 'c1', name: 'Year 6 Hindi', label: 'class', kind: 'class' })
    // Compare chain nearest-first: school → programme → nation → globals
    expect(res.body.options.compares.map((o: any) => o.value)).toEqual(
      ['s1-node', 'programme', 'nation', 'global', 'global_all_courses'])
    // c1 is the only class in school-1 — the school-average default is empty,
    // so the ladder widens to global · this course (c2/c3/c5): never a blank landing.
    expect(res.body.applied.compare_to).toBe('global')
    expect(res.body.insufficientData).toBe(false)
    // cohort = c1 (itself) + c2/c3/c5 — the average is self-inclusive (Tom, 2026-09-16)
    expect(res.body.cohortSize).toBe(4)
  })

  it('admin · class vs programme average: peer classes on the SAME course only', async () => {
    verifyAdminResult = { userId: 'admin-1' }
    const res = makeRes()
    await handler(makeReq('c1', { compare_to: 'programme' }), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.insufficientData).toBe(false)
    // cohort = c1 (itself, 10) + c2 (8) + c3 (4); the tam class c4 is excluded
    // by course. The average is self-inclusive (Tom, 2026-09-16): mean(10,8,4).
    expect(res.body.cohortSize).toBe(3)
    expect(res.body.entity.value).toBe(10)
    expect(res.body.average.value).toBe(7.3)
    expect(res.body.average.label).toBe('IME Demo Programme average')
    expect(res.body.percentile).toBe(100)
    // Anonymity: no peer identity ever leaves the server
    const raw = JSON.stringify(res.body)
    for (const leak of ['c2', 'c3', 'Year 5', 'Year 4', 'St. Mary', 'school-2']) {
      expect(raw).not.toContain(leak)
    }
  })

  it('speaks AS the node: voice fields + LEGO-content position line, never raw ids', async () => {
    verifyAdminResult = { userId: 'admin-1' }
    const res = makeRes()
    await handler(makeReq('c1', { compare_to: 'programme' }), res)
    expect(res.statusCode).toBe(200)
    // Voice: subject = the node's own name; "You" is reserved for the viewer's identity
    expect(res.body.subject).toBe('Year 6 Hindi')
    expect(res.body.subjectIsViewer).toBe(false)
    expect(res.body.levelNoun).toBe('class')
    expect(res.body.cohortLabel).toBe('classes in IME Demo Programme')
    // Position line = the LEGO's content (roman preferred), not "S10 · L1"
    expect(res.body.contextLine).toBe('Furthest phrase · "main seekhna chaahta hoon" — "I want to learn"')

    // A node whose furthest LEGO has no content row gets NO line (never a raw id)
    const res2 = makeRes()
    await handler(makeReq('school-2'), res2)
    expect(res2.statusCode).toBe(200)
    expect(res2.body.contextLine).toBeUndefined()
    expect(res2.body.cohortLabel).toBe('schools in IME Demo Programme')
    expect(res2.body.levelNoun).toBe('school')
  })

  it('admin · school id resolves to its node; course defaults to the busiest below', async () => {
    verifyAdminResult = { userId: 'admin-1' }
    const res = makeRes()
    await handler(makeReq('school-2'), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.node.id).toBe('s2-node')
    expect(res.body.node.kind).toBe('node')
    // hin has 2 classes below school-2, tam has 1 → hin leads
    expect(res.body.applied.course_code).toBe('hin_for_eng')
    expect(res.body.options.courses.map((c: any) => c.code)).toEqual(['hin_for_eng', 'tam_for_eng'])
    // Default compare = parent (programme); peers-like-me = schools
    expect(res.body.applied.compare_to).toBe('programme')
    expect(res.body.insufficientData).toBe(false)
    // cohort = school-2 (itself) + school-1 peer (10); entity = mean(c2, c3) = 6.
    // The average is self-inclusive (Tom, 2026-09-16): mean(6, 10) = 8.
    expect(res.body.cohortSize).toBe(2)
    expect(res.body.entity.value).toBe(6)
    expect(res.body.average.value).toBe(8)
  })

  it('admin · group node vs nation: school-spread cohort excludes own subtree', async () => {
    verifyAdminResult = { userId: 'admin-1' }
    const res = makeRes()
    await handler(makeReq('programme'), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.applied.compare_to).toBe('nation')
    // entity = hin classes below programme: c1 (10), c2 (8), c3 (4) → 7.3
    expect(res.body.entity.value).toBe(7.3)
    // cohort = programme (itself) + school-3 peer (12), excluding programme's
    // own subtree from the PEER set. Self-inclusive average: mean(7.3, 12) = 9.7.
    expect(res.body.cohortSize).toBe(2)
    expect(res.body.average.value).toBe(9.7)
    expect(res.body.deltaPct).toBe(-24.7)
  })

  // ─── Compare-set fullness at every depth (THE LENS windows+measures
  // contract, task 3). The founder observed region/group nodes offering only
  // the two Global options. Live-data diagnosis: EVERY real+demo group in
  // production tops out at 2 levels (a region/programme/org root -> its
  // schools) — there is no 3rd tier anywhere, so a region node's ancestor
  // chain is correctly empty (roots have no parent). The code itself walks
  // parent_id with no depth cap; these tests pin that against this fixture's
  // deeper tree (nation -> programme -> school -> class = 3 real levels). ───
  it('full ancestor chain at CLASS depth: own school -> programme -> nation -> both globals, no thinning', async () => {
    verifyAdminResult = { userId: 'admin-1' }
    const res = makeRes()
    await handler(makeReq('c2'), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.options.compares.map((o: any) => o.value)).toEqual(
      ['s2-node', 'programme', 'nation', 'global', 'global_all_courses'])
  })

  it('full ancestor chain at SCHOOL depth: programme -> nation -> both globals', async () => {
    verifyAdminResult = { userId: 'admin-1' }
    const res = makeRes()
    await handler(makeReq('school-2'), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.options.compares.map((o: any) => o.value)).toEqual(
      ['programme', 'nation', 'global', 'global_all_courses'])
  })

  it('full ancestor chain at REGION/GROUP depth (programme, a non-root group): nation -> both globals', async () => {
    verifyAdminResult = { userId: 'admin-1' }
    const res = makeRes()
    await handler(makeReq('programme'), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.options.compares.map((o: any) => o.value)).toEqual(['nation', 'global', 'global_all_courses'])
  })

  it('a ROOT group (no parent) honestly offers only the two globals — data-shaped, not a bug', async () => {
    verifyAdminResult = { userId: 'admin-1' }
    const res = makeRes()
    await handler(makeReq('nation'), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.options.compares.map((o: any) => o.value)).toEqual(['global', 'global_all_courses'])
  })

  it('admin · explicit course_code is honoured; unknown falls back to default', async () => {
    verifyAdminResult = { userId: 'admin-1' }
    const res = makeRes()
    await handler(makeReq('school-2', { course_code: 'tam_for_eng', compare_to: 'global' }), res)
    expect(res.body.applied.course_code).toBe('tam_for_eng')
    // no other school runs tam — insufficient, but options still present
    expect(res.body.insufficientData).toBe(true)
    expect(res.body.options.compares.length).toBeGreaterThan(0)

    const res2 = makeRes()
    await handler(makeReq('school-2', { course_code: 'nope_for_no' }), res2)
    expect(res2.body.applied.course_code).toBe('hin_for_eng')
  })

  it('teacher · own class passes the door; a CLASS cohort has floor 1, so 2 peer classes compare (Tom, 2026-09-15)', async () => {
    verifyAuthTokenResult = { valid: true, userId: 'teacher-1' }
    visibleScopeResult = { ...EMPTY_SCOPE, role: 'teacher', classIds: ['c1'] }
    const res = makeRes()
    await handler(makeReq('c1', { compare_to: 'programme' }), res)
    expect(res.statusCode).toBe(200)
    // The 5-floor is for cohorts of INDIVIDUAL learners (GDPR); classes are
    // entities. Before this ruling a teacher here was told "needs at least 5".
    expect(res.body.insufficientData).toBe(false)
    // c1 (itself) + 2 peer classes — self-inclusive (Tom, 2026-09-16)
    expect(res.body.cohortSize).toBe(3)
    expect(res.body.kFloor).toBe(1)
  })

  it('teacher · one class, ONE comparable class elsewhere on the course → a comparison, not a blank (Tom, 2026-09-15)', async () => {
    verifyAuthTokenResult = { valid: true, userId: 'teacher-1' }
    visibleScopeResult = { ...EMPTY_SCOPE, role: 'teacher', classIds: ['c1'] }
    // One class, one comparable class elsewhere: only c1 and c2 (another
    // school, same course) exist — membership is structural (Tom, 2026-09-16),
    // so c3/c4/c5 are removed here rather than just their session rows.
    TABLES.classes = TABLES.classes.filter((c: any) => ['c1', 'c2'].includes(c.id))
    SESSION_ROWS = [
      ...sessions('c1', 'hin_for_eng', [[0, 5], [5, 10]]),
      ...sessions('c2', 'hin_for_eng', [[0, 4], [4, 8]]),
    ]
    const res = makeRes()
    await handler(makeReq('c1', { compare_to: 'global' }), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.insufficientData).toBe(false)
    // c1 (itself) + 1 comparable peer — self-inclusive (Tom, 2026-09-16)
    expect(res.body.cohortSize).toBe(2)
    expect(res.body.kFloor).toBe(1)
    expect(res.body.average.value).toBeGreaterThan(0)
  })

  it('teacher · someone else’s class is 403', async () => {
    verifyAuthTokenResult = { valid: true, userId: 'teacher-1' }
    visibleScopeResult = { ...EMPTY_SCOPE, role: 'teacher', classIds: ['c1'] }
    const res = makeRes()
    await handler(makeReq('c2'), res)
    expect(res.statusCode).toBe(403)
  })

  it('leader · school inside their governed subtree passes; outside is 403', async () => {
    verifyAuthTokenResult = { valid: true, userId: 'leader-1' }
    visibleScopeResult = {
      ...EMPTY_SCOPE, role: 'govt_admin', groupId: 'programme',
      schoolIds: ['school-1', 'school-2'], classIds: ['c1', 'c2', 'c3', 'c4'],
    }
    const res = makeRes()
    await handler(makeReq('school-2'), res)
    expect(res.statusCode).toBe(200)

    const res2 = makeRes()
    await handler(makeReq('school-3'), res2)
    expect(res2.statusCode).toBe(403)

    // a strict-descendant group node also passes
    const res3 = makeRes()
    await handler(makeReq('s1-node'), res3)
    expect(res3.statusCode).toBe(200)
  })

  it('coverage-expired school goes dark for non-admin callers only', async () => {
    coverageExpired = true
    verifyAuthTokenResult = { valid: true, userId: 'teacher-1' }
    visibleScopeResult = { ...EMPTY_SCOPE, role: 'teacher', classIds: ['c1'] }
    const res = makeRes()
    await handler(makeReq('c1'), res)
    expect(res.statusCode).toBe(403)
    expect(res.body.error).toBe('coverage_expired')

    verifyAdminResult = { userId: 'admin-1' }
    const res2 = makeRes()
    await handler(makeReq('c1'), res2)
    expect(res2.statusCode).toBe(200)
  })

  it('global_all_courses widens the cohort pool across courses', async () => {
    verifyAdminResult = { userId: 'admin-1' }
    const res = makeRes()
    await handler(makeReq('school-1', { compare_to: 'global_all_courses' }), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.insufficientData).toBe(false)
    // school-1 (itself) + schools 2 + 3 as peers (school-2's pool now
    // includes the tam class) — self-inclusive (Tom, 2026-09-16)
    expect(res.body.cohortSize).toBe(3)
  })

  it('a DEMO node opts into its own demo sessions; a real node never does', async () => {
    verifyAdminResult = { userId: 'admin-1' }
    const res = makeRes()
    await handler(makeReq('school-2'), res)
    expect(lastRpcArgs.p_include_demo).toBe(false)

    TABLES.groups.find((g: any) => g.id === 's2-node').is_demo = true
    const res2 = makeRes()
    await handler(makeReq('school-2'), res2)
    expect(lastRpcArgs.p_include_demo).toBe(true)
  })

  it('demo entity global cohort excludes REAL peers (analytics real or absent — never mixed)', async () => {
    verifyAdminResult = { userId: 'admin-1' }
    // school-1 becomes demo; every other school stays real.
    TABLES.schools.find((s: any) => s.id === 'school-1').is_demo = true
    TABLES.groups.find((g: any) => g.id === 's1-node').is_demo = true
    const res = makeRes()
    // c1 (demo) vs global on hin — the only hin peers (c2/c3/c5) live in real
    // schools, so the demo entity is left with no comparable world.
    await handler(makeReq('c1', { compare_to: 'global' }), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.insufficientData).toBe(true)
    expect(res.body.cohortSize).toBe(0)
    // …and the empty-state NAMES the gate, not a vague "not enough data".
    // Membership is structural now, so the reason no longer names a window.
    expect(res.body.reason).toMatch(/demo classes running this course/)
    expect(res.body.reason).toMatch(/at least 1/)
    expect(res.body.reason).not.toBe('Not enough data to compare fairly yet.')
  })

  it('demo entity global cohort SEATS demo peers (demo compares within the demo world)', async () => {
    verifyAdminResult = { userId: 'admin-1' }
    TABLES.schools.find((s: any) => s.id === 'school-1').is_demo = true
    TABLES.groups.find((g: any) => g.id === 's1-node').is_demo = true
    // a DEMO peer school on the same course, plus a real one that must be ignored.
    TABLES.groups.push({ id: 's4-node', name: 'Demo Peer', type: 'school', parent_id: 'programme', path: 'india/ime/s4', is_demo: true })
    TABLES.schools.push({ id: 'school-4', school_name: 'Demo Peer', group_id: 'programme', node_group_id: 's4-node', is_demo: true })
    TABLES.classes.push({ id: 'c6', class_name: 'Demo Hindi', course_code: 'hin_for_eng', school_id: 'school-4', group_id: 's4-node', is_active: true })
    SESSION_ROWS.push(...sessions('c6', 'hin_for_eng', [[0, 3], [3, 6]]))
    const res = makeRes()
    await handler(makeReq('c1', { compare_to: 'global' }), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.insufficientData).toBe(false)
    // c1 (itself) + the demo peer (c6) — real peers c2/c3/c5 are excluded
    // from the demo world; self-inclusive (Tom, 2026-09-16).
    expect(res.body.cohortSize).toBe(2)
  })

  it('real entity global_all_courses cohort excludes DEMO schools (a real average is never diluted)', async () => {
    verifyAdminResult = { userId: 'admin-1' }
    // school-3 (a peer for school-1's all-courses pool) is turned demo.
    TABLES.schools.find((s: any) => s.id === 'school-3').is_demo = true
    TABLES.groups.find((g: any) => g.id === 's3-node').is_demo = true
    const res = makeRes()
    await handler(makeReq('school-1', { compare_to: 'global_all_courses' }), res)
    expect(res.statusCode).toBe(200)
    // school-1 (itself) + school-2 (real); school-3 now demo → dropped from
    // peers. Was 2 peers, now 1 peer + entity = 2 (self-inclusive).
    expect(res.body.cohortSize).toBe(2)
  })

  it('root node auto-widens to all-courses when its default this-course global cohort is empty (landing never blank)', async () => {
    verifyAdminResult = { userId: 'admin-1' }
    // Make `programme` a ROOT, and leave the only outside peer (school-3) on a
    // DIFFERENT course — so global·this-course(hin) has no peers but
    // global·all-courses does.
    TABLES.groups.find((g: any) => g.id === 'programme').parent_id = null
    TABLES.classes.find((c: any) => c.id === 'c5').course_code = 'fra_for_eng'
    const res = makeRes()
    await handler(makeReq('programme'), res) // no compare_to → default = global (this course)
    expect(res.statusCode).toBe(200)
    // The empty this-course default silently widened to all-courses…
    expect(res.body.applied.compare_to).toBe('global_all_courses')
    expect(res.body.insufficientData).toBe(false)
    // programme (itself) + school-3 (via its now-fra class) — self-inclusive
    expect(res.body.cohortSize).toBe(2)
    // …but the this-course option stays offered for anyone who wants to switch back.
    expect(res.body.options.compares.map((o: any) => o.value)).toEqual(['global', 'global_all_courses'])
    expect(res.body.average.label).toBe('Global average · all courses')
  })

  it('an EXPLICIT empty this-course pick does NOT auto-widen — keeps the named empty-state', async () => {
    verifyAdminResult = { userId: 'admin-1' }
    TABLES.groups.find((g: any) => g.id === 'programme').parent_id = null
    TABLES.classes.find((c: any) => c.id === 'c5').course_code = 'fra_for_eng'
    const res = makeRes()
    await handler(makeReq('programme', { compare_to: 'global' }), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.applied.compare_to).toBe('global') // respected, not widened
    expect(res.body.insufficientData).toBe(true)
    expect(res.body.reason).toMatch(/running this course/)
    expect(res.body.reason).toMatch(/at least 1/)
  })

  it('root with NO comparable peers on any course stays insufficient after widening (honest, named)', async () => {
    verifyAdminResult = { userId: 'admin-1' }
    // `nation` is a root that contains every school → both this-course and
    // all-courses global cohorts are empty. Widening cannot rescue it.
    const res = makeRes()
    await handler(makeReq('nation'), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.insufficientData).toBe(true)
    expect(res.body.applied.compare_to).toBe('global_all_courses') // it did attempt the widen
    expect(res.body.reason).toMatch(/exist in this scope/)
    expect(res.body.reason).not.toMatch(/running this course/) // all-courses scope, so no course clause
  })

  it('404s an unknown id', async () => {
    verifyAdminResult = { userId: 'admin-1' }
    const res = makeRes()
    await handler(makeReq('nothing-here'), res)
    expect(res.statusCode).toBe(404)
  })
})

describe('GET /api/groups/:id/rate-compare — course defaulting (founder rule 2026-07-20: busiest by RECENT ACTIVITY, k-floor preferred)', () => {
  it('activity beats class count: a class-heavy course with no practice never becomes the default', async () => {
    verifyAdminResult = { userId: 'admin-1' }
    // The Coastal Districts hole: eng_for_hin has MORE classes below school-2
    // than any other course — but zero practice. hin/tam carry the sessions.
    for (const id of ['c7', 'c8', 'c9']) {
      TABLES.classes.push({ id, class_name: `Eng ${id}`, course_code: 'eng_for_hin', school_id: 'school-2', group_id: 's2-node', is_active: true })
    }
    const res = makeRes()
    await handler(makeReq('school-2'), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.applied.course_code).toBe('hin_for_eng') // active, not class-heavy
    expect(res.body.insufficientData).toBe(false)
    // Dropdown: active courses first (by recent activity), dataless last + flagged
    expect(res.body.options.courses.map((c: any) => c.code)).toEqual(['hin_for_eng', 'tam_for_eng', 'eng_for_hin'])
    expect(res.body.options.courses.map((c: any) => c.hasData)).toEqual([true, true, false])
  })

  it('prefers the highest-ranked course whose ancestor cohort clears the k-floor', async () => {
    verifyAdminResult = { userId: 'admin-1' }
    // Make tam the busiest at school-2 (5 recent sessions vs hin's 4) — but NO
    // peer school under `programme` runs tam, so its cohort fails even the
    // admin floor of 1. hin has an active peer (school-1). Default must be hin.
    SESSION_ROWS.push(...sessions('c4', 'tam_for_eng', [[40, 50], [50, 60], [60, 70]]))
    const res = makeRes()
    await handler(makeReq('school-2'), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.applied.compare_to).toBe('programme')
    expect(res.body.applied.course_code).toBe('hin_for_eng')
    expect(res.body.insufficientData).toBe(false)
    // …but tam still ranks first in the dropdown (it IS the busiest here)
    expect(res.body.options.courses[0].code).toBe('tam_for_eng')
  })

  it('an EXPLICIT course pick is never overridden by the k-floor preference — the compare ladders instead', async () => {
    verifyAdminResult = { userId: 'admin-1' }
    SESSION_ROWS.push(...sessions('c4', 'tam_for_eng', [[40, 50], [50, 60], [60, 70]]))
    const res = makeRes()
    await handler(makeReq('school-2', { course_code: 'tam_for_eng' }), res)
    expect(res.body.applied.course_code).toBe('tam_for_eng') // the pick is honoured
    // no other school runs tam → programme and global · this-course are both
    // empty; the DEFAULT compare ladders to all-courses so the pick still
    // lands on a real comparison (entity stays anchored to tam).
    expect(res.body.applied.compare_to).toBe('global_all_courses')
    expect(res.body.insufficientData).toBe(false)
  })

  it('the default course does not depend on the window (switching windows never re-defaults)', async () => {
    verifyAdminResult = { userId: 'admin-1' }
    for (const win of ['today', '7d', '30d', 'all']) {
      const res = makeRes()
      await handler(makeReq('school-2', { window: win }), res)
      expect(res.body.applied.course_code).toBe('hin_for_eng')
    }
  })

  it('a DEMO entity holds a floor of 1 for NON-ADMIN leaders too — demo cohorts are fictional schools, the floor protects nobody', async () => {
    verifyAuthTokenResult = { valid: true, userId: 'leader-1' }
    visibleScopeResult = {
      ...EMPTY_SCOPE, role: 'govt_admin', groupId: 'programme',
      schoolIds: ['school-1', 'school-2'], classIds: ['c1', 'c2', 'c3', 'c4'],
    }
    // the whole programme world is demo
    for (const g of TABLES.groups) g.is_demo = true
    for (const s of TABLES.schools) s.is_demo = true
    const res = makeRes()
    await handler(makeReq('school-2'), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.kFloor).toBe(1)
    expect(res.body.insufficientData).toBe(false) // school-1 is a single valid demo peer
    // school-2 (itself) + school-1 peer — self-inclusive (Tom, 2026-09-16)
    expect(res.body.cohortSize).toBe(2)
    // a REAL school for the same leader: a SCHOOL cohort is entities too, so
    // the floor is 1 there as well (Tom, 2026-09-15) — one real peer compares.
    for (const g of TABLES.groups) g.is_demo = false
    for (const s of TABLES.schools) s.is_demo = false
    const res2 = makeRes()
    await handler(makeReq('school-2'), res2)
    expect(res2.body.kFloor).toBe(1)
    expect(res2.body.insufficientData).toBe(false)
    expect(res2.body.cohortSize).toBe(2)
  })

  it('an INTERIOR node whose peers share NONE of its courses ladders the compare to global · all courses (the Metro case)', async () => {
    verifyAdminResult = { userId: 'admin-1' }
    // A second region under `programme` running a course nobody else runs —
    // its parent-average cohort is empty for EVERY course it has.
    TABLES.groups.push({ id: 'metro', name: 'Metro International', type: 'region', parent_id: 'programme', path: 'india/ime/metro', is_demo: false })
    TABLES.groups.push({ id: 's4-node', name: 'Metro School', type: 'school', parent_id: 'metro', path: 'india/ime/metro/s4', is_demo: false })
    TABLES.schools.push({ id: 'school-4', school_name: 'Metro School', group_id: 'metro', node_group_id: 's4-node', is_demo: false })
    TABLES.classes.push({ id: 'c6', class_name: 'Year 8 French', course_code: 'fra_for_eng', school_id: 'school-4', group_id: 's4-node', is_active: true })
    SESSION_ROWS.push(...sessions('c6', 'fra_for_eng', [[0, 6], [6, 12]]))
    const res = makeRes()
    await handler(makeReq('metro'), res) // default compare = programme average
    expect(res.statusCode).toBe(200)
    expect(res.body.applied.course_code).toBe('fra_for_eng') // its own busiest
    // parent cohort empty on fra → ladder: global (still empty) → all courses
    expect(res.body.applied.compare_to).toBe('global_all_courses')
    expect(res.body.insufficientData).toBe(false)
    expect(res.body.cohortSize).toBeGreaterThanOrEqual(1)
    expect(res.body.average.label).toBe('Global average · all courses')
    // the narrower options are all still offered for manual picking
    expect(res.body.options.compares.map((o: any) => o.value)).toEqual(
      ['programme', 'nation', 'global', 'global_all_courses'])
  })

  it('a genuinely dark node says WHY — never the generic compare message', async () => {
    verifyAdminResult = { userId: 'admin-1' }
    SESSION_ROWS = SESSION_ROWS.filter((r) => !['c2', 'c3', 'c4'].includes(r.class_id))
    const res = makeRes()
    await handler(makeReq('school-2'), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.insufficientData).toBe(true)
    expect(res.body.reason).toBe('No practice recorded below this level yet.')
    // …and a dark CLASS names itself, not "below this level"
    const res2 = makeRes()
    await handler(makeReq('c2'), res2)
    expect(res2.body.insufficientData).toBe(true)
    expect(res2.body.reason).toBe('No practice recorded in this class yet.')
  })
})

describe('GET /api/groups/:id/rate-compare — windows (?window=, rolling day units)', () => {
  it('defaults to "30d" when neither window nor days is present', async () => {
    verifyAdminResult = { userId: 'admin-1' }
    const res = makeRes()
    await handler(makeReq('c1', { compare_to: 'programme' }), res)
    expect(res.body.applied.window).toBe('30d')
    expect(res.body.applied.days).toBe(30)
    expect(res.body.windowLabel).toBe('Last 30 days')
    expect(res.body.trendLabel).toBe('Daily · last 30 days')
    expect(res.body.trendPeriodDays).toBe(1)
    expect(lastRpcArgs.p_days).toBe(31) // (30+1)*1
  })

  it('?window=7d sets a 7-day headline period and a 7-point daily trend', async () => {
    verifyAdminResult = { userId: 'admin-1' }
    const res = makeRes()
    await handler(makeReq('c1', { compare_to: 'programme', window: '7d' }), res)
    expect(res.body.applied.window).toBe('7d')
    expect(res.body.windowLabel).toBe('Last 7 days')
    expect(res.body.trendLabel).toBe('Daily · last 7 days')
    expect(res.body.trendPeriodDays).toBe(1)
    expect(res.body.entity.trend).toHaveLength(7)
    expect(lastRpcArgs.p_days).toBe(8) // (7+1)*1
  })

  it('?window=today sets a 1-day headline period, a 24-point hourly trend, and a per-day rate', async () => {
    verifyAdminResult = { userId: 'admin-1' }
    const res = makeRes()
    await handler(makeReq('c1', { compare_to: 'programme', window: 'today' }), res)
    expect(res.body.applied.window).toBe('today')
    expect(res.body.applied.days).toBe(1)
    expect(res.body.windowLabel).toBe('Today')
    expect(res.body.trendLabel).toBe('Hourly · last 24 hours')
    expect(res.body.trendPeriodDays).toBeCloseTo(1 / 24)
    expect(res.body.entity.trend).toHaveLength(24)
    // honest rate framing: never "per week" over a single day
    expect(res.body.per).toBe('day')
    expect(lastRpcArgs.p_days).toBe(2) // ceil((24+1)/24)
  })

  it('?window=today scales the headline AND the cohort together (delta is scale-invariant)', async () => {
    verifyAdminResult = { userId: 'admin-1' }
    const resWeekly = makeRes()
    await handler(makeReq('c1', { compare_to: 'programme', window: '7d' }), resWeekly)
    const resToday = makeRes()
    await handler(makeReq('c1', { compare_to: 'programme', window: 'today' }), resToday)
    // both headline and average carry the same /7 scaling, so the entity's
    // standing vs the cohort is a pure function of the window's data.
    expect(resToday.body.distribution.entityValue).toBe(resToday.body.entity.value)
    expect(resToday.body.distribution.averageValue).toBe(resToday.body.average.value)
    // c1 advanced 5 LEGOs in its today-session → exactly 5 LEGOs/day, not 35/week
    expect(resToday.body.entity.value).toBe(5)
    // self-inclusive mean of c1 (5/day, itself), c2 (4/day) and c3 (2/day)
    expect(resToday.body.average.value).toBe(3.7)
  })

  it('?window=all sets a practical-unbounded headline period and a 12-point monthly trend', async () => {
    verifyAdminResult = { userId: 'admin-1' }
    const res = makeRes()
    await handler(makeReq('c1', { compare_to: 'programme', window: 'all' }), res)
    expect(res.body.applied.window).toBe('all')
    expect(res.body.trendLabel).toBe('Monthly · last 12 months')
    expect(res.body.trendPeriodDays).toBe(30)
    expect(res.body.entity.trend).toHaveLength(12)
    expect(lastRpcArgs.p_days).toBe(3650)
  })

  it('old chip values alias forward (week→7d, 4w→30d, term→30d) — saved links keep working', async () => {
    verifyAdminResult = { userId: 'admin-1' }
    for (const [legacy, expected] of [['week', '7d'], ['4w', '30d'], ['term', '30d']] as const) {
      const res = makeRes()
      await handler(makeReq('c1', { compare_to: 'programme', window: legacy }), res)
      expect(res.body.applied.window).toBe(expected)
    }
  })

  it('legacy ?days= alone still works — byte-identical trend shape, applied.window is null (no chip matches)', async () => {
    verifyAdminResult = { userId: 'admin-1' }
    const res = makeRes()
    await handler(makeReq('c1', { compare_to: 'programme', days: '30' }), res)
    expect(res.body.applied.window).toBeNull()
    expect(res.body.applied.days).toBe(30)
    expect(res.body.trendLabel).toBe('Weekly · last 8 weeks')
    expect(res.body.entity.trend).toHaveLength(8)
    expect(lastRpcArgs.p_days).toBe(63) // (8+1)*7
  })

  it('?window= wins over ?days= when both are present', async () => {
    verifyAdminResult = { userId: 'admin-1' }
    const res = makeRes()
    await handler(makeReq('c1', { compare_to: 'programme', window: '7d', days: '90' }), res)
    expect(res.body.applied.window).toBe('7d')
    expect(res.body.applied.days).toBe(7)
  })

  it('options.windows always carries the 4 canonical chips', async () => {
    verifyAdminResult = { userId: 'admin-1' }
    const res = makeRes()
    await handler(makeReq('c1'), res)
    expect(res.body.options.windows).toEqual([
      { value: 'today', label: 'Today' },
      { value: '7d', label: 'Last 7 days' },
      { value: '30d', label: 'Last 30 days' },
      { value: 'all', label: 'All time' },
    ])
  })
})

describe('GET /api/groups/:id/rate-compare — measures (?measure=)', () => {
  it('minutes: one burst of play reads at least as much over 30 days as over 7 — a TOTAL in the window, never a rate (Tom, 2026-09-14)', async () => {
    verifyAdminResult = { userId: 'admin-1' }
    // The class 7H shape: an hour two days ago, five minutes twenty days ago.
    // A per-week rate anchored to first activity read 210 for the week and
    // 22.8 for the month; a total reads 60 and 65.
    SESSION_ROWS = SESSION_ROWS.filter((r) => r.class_id !== 'c1')
    SESSION_ROWS.push(
      { class_id: 'c1', course_code: 'hin_for_eng', start_lego_id: 'S0L01', end_lego_id: 'S5L01', start_ord: 0, end_ord: 5, duration_seconds: 3600, started_at: daysAgo(2) },
      { class_id: 'c1', course_code: 'hin_for_eng', start_lego_id: 'S0L01', end_lego_id: 'S1L01', start_ord: 0, end_ord: 1, duration_seconds: 300, started_at: daysAgo(20) },
    )
    const week = makeRes()
    await handler(makeReq('c1', { compare_to: 'programme', measure: 'minutes', window: '7d' }), week)
    const month = makeRes()
    await handler(makeReq('c1', { compare_to: 'programme', measure: 'minutes', window: '30d' }), month)
    const all = makeRes()
    await handler(makeReq('c1', { compare_to: 'programme', measure: 'minutes', window: 'all' }), all)
    expect(week.statusCode).toBe(200)
    expect(week.body.applied.measure).toBe('minutes')
    expect(week.body.per).toBe('')
    expect(week.body.entity.value).toBe(60)
    expect(month.body.entity.value).toBe(65)
    expect(month.body.entity.value).toBeGreaterThanOrEqual(week.body.entity.value)
    expect(all.body.entity.value).toBeGreaterThanOrEqual(month.body.entity.value)
  })

  it('the old measure ids in bookmarks resolve to minutes rather than 404ing to the default', async () => {
    verifyAdminResult = { userId: 'admin-1' }
    for (const legacy of ['minutes_per_class', 'hours_total']) {
      const res = makeRes()
      await handler(makeReq('c1', { compare_to: 'programme', measure: legacy }), res)
      expect(res.statusCode).toBe(200)
      expect(res.body.applied.measure).toBe('minutes')
    }
  })

  it('under Today the minutes total is the total — never divided by seven', async () => {
    verifyAdminResult = { userId: 'admin-1' }
    SESSION_ROWS = SESSION_ROWS.filter((r) => r.class_id !== 'c1')
    SESSION_ROWS.push({ class_id: 'c1', course_code: 'hin_for_eng', start_lego_id: 'S0L01', end_lego_id: 'S5L01', start_ord: 0, end_ord: 5, duration_seconds: 1800, started_at: daysAgo(0) })
    const res = makeRes()
    await handler(makeReq('c1', { compare_to: 'programme', measure: 'minutes', window: 'today' }), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.entity.value).toBe(30)
    expect(res.body.per).toBe('')
  })

  it('measure=minutes: same grammar, a different metric — the in-app minutes total in the window', async () => {
    verifyAdminResult = { userId: 'admin-1' }
    const res = makeRes()
    await handler(makeReq('c1', { compare_to: 'programme', measure: 'minutes' }), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.applied.measure).toBe('minutes')
    expect(res.body.metricLabel).toBe('Practice minutes')
    expect(res.body.unit).toBe('min')
    expect(res.body.per).toBe('')
    expect(res.body.entity.value).toBe(60) // 2 × 1800 s of class play in the window
    expect(res.body.contextLine).toBeUndefined() // contextLine rides ONLY on the rate measure
  })

  it('measure=active_classes: % of the entity’s own classes active — available at node level', async () => {
    verifyAdminResult = { userId: 'admin-1' }
    const res = makeRes()
    await handler(makeReq('school-2', { measure: 'active_classes' }), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.applied.measure).toBe('active_classes')
    expect(res.body.metricLabel).toBe('Active classes share')
    expect(res.body.unit).toBe('%')
    expect(res.body.per).toBe('')
    expect(res.body.entity.value).toBe(100) // both of school-2's hin classes (c2, c3) are active
  })

  it('measure=active_classes on a CLASS entity falls back to the default (rate) rather than erroring', async () => {
    verifyAdminResult = { userId: 'admin-1' }
    const res = makeRes()
    await handler(makeReq('c1', { measure: 'active_classes' }), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.applied.measure).toBe('rate')
    expect(res.body.options.measures.map((m: any) => m.value)).not.toContain('active_classes')
  })

  it('options.measures: full 3 at node level, 2 (no active_classes) at class level; each carries a plain-language desc', async () => {
    verifyAdminResult = { userId: 'admin-1' }
    const res = makeRes()
    await handler(makeReq('school-2'), res)
    expect(res.body.options.measures.map((m: any) => m.value)).toEqual(
      ['rate', 'minutes', 'active_classes'])
    expect(res.body.options.measures.every((m: any) => typeof m.desc === 'string' && m.desc.length > 0)).toBe(true)

    const res2 = makeRes()
    await handler(makeReq('c1'), res2)
    expect(res2.body.options.measures.map((m: any) => m.value)).toEqual(['rate', 'minutes'])
  })

  it('unknown measure falls back to the default (rate)', async () => {
    verifyAdminResult = { userId: 'admin-1' }
    const res = makeRes()
    await handler(makeReq('c1', { compare_to: 'programme', measure: 'bogus' }), res)
    expect(res.body.applied.measure).toBe('rate')
    expect(res.body.metricLabel).toBe('Rate of progress')
  })
})

describe('GET /api/groups/:id/rate-compare — whole-class play lives in the diary (Tom, 2026-09-11: "the data IS all there")', () => {
  // A class that plays from the front has NO class_sessions rows (nothing has
  // written that table since the 2026-08-19 re-anchor) and no pupil accounts.
  // Its only record is the diary under its own account. Before the fix the
  // engine read it as never having practised.
  function seedDiaryClass(): void {
    TABLES.classes.push({ id: 'c6', class_name: '7P', course_code: 'hin_for_eng', school_id: 'school-1', group_id: 's1-node', is_active: true, class_learner_id: 'CL6' })
    for (let i = 1; i <= 10; i++) TABLES.course_legos.push({ course_code: 'hin_for_eng', lego_id: `S${i}L01`, seed_number: i, lego_index: 1 })
    const lesson = NOW - 3 * DAY
    TABLES.player_events = [
      { id: 1, learner_id: 'CL6', course_code: 'hin_for_eng', event_type: 'tap_play', occurred_at: new Date(lesson).toISOString(), lego: null },
      { id: 2, learner_id: 'CL6', course_code: 'hin_for_eng', event_type: 'audio_play', duration: 0, occurred_at: new Date(lesson + 10_000).toISOString(), lego: 'S1L01' },
      { id: 3, learner_id: 'CL6', course_code: 'hin_for_eng', event_type: 'audio_play', duration: 0, occurred_at: new Date(lesson + 20_000).toISOString(), lego: 'S3L01' },
      { id: 4, learner_id: 'CL6', course_code: 'hin_for_eng', event_type: 'audio_play', duration: 0, occurred_at: new Date(lesson + 40_000).toISOString(), lego: 'S5L01' },
    ]
  }

  it('a class whose only record is the diary has a non-zero rate and non-zero minutes', async () => {
    seedDiaryClass()
    verifyAdminResult = { userId: 'admin-1' }
    const res = makeRes()
    await handler(makeReq('c6', { compare_to: 'programme' }), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.insufficientData).toBe(false)
    expect(res.body.entity.value).toBeGreaterThan(0)       // LEGOs per week off the diary
    expect(res.body.contextLine).toBeUndefined()           // S5L01 has no content row in this fixture: no line, never a raw id

    const mins = makeRes()
    await handler(makeReq('c6', { compare_to: 'programme', measure: 'minutes' }), mins)
    expect(mins.statusCode).toBe(200)
    expect(mins.body.entity.value).toBeGreaterThan(0)      // in-app minutes off the same diary blocks
  })

  it('a school whose classes ALL play from the front is no longer dark', async () => {
    seedDiaryClass()
    verifyAdminResult = { userId: 'admin-1' }
    // school-1 keeps c1 (class_sessions rows) — take them away so the school
    // has ONLY diary practice, the Chepstow shape.
    SESSION_ROWS = SESSION_ROWS.filter((r) => r.class_id !== 'c1')
    const res = makeRes()
    await handler(makeReq('school-1', { compare_to: 'programme' }), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.insufficientData).toBe(false)
    expect(res.body.entity.value).toBeGreaterThan(0)
  })
})

// ─── Self-inclusive, structural averaging (Tom's ruling 2026-09-16: "the
// averages need to be logical to a teacher, not technically correct, and a
// set member should ALWAYS be included in the average, not excluded — else
// the school average changes when a school leader looks at each class
// against it"). Cohort membership is now every class/school in the compare-to
// scope on this course, active or not, entity included — a fixed set for a
// given school+course whoever is looking and whichever window is applied. ───
describe('GET /api/groups/:id/rate-compare — self-inclusive averaging (Tom, 2026-09-16)', () => {
  it('a sum measure (practice minutes): all-time average >= 30-day average >= 7-day average', async () => {
    verifyAdminResult = { userId: 'admin-1' }
    // c1 (entity) practises 2 days ago only; c2 (peer) 20 days ago only; c3
    // (peer) 200 days ago only — inactive members count with their TRUE
    // value (0) in a window they didn't practise in, never dropped.
    SESSION_ROWS = [
      { class_id: 'c1', course_code: 'hin_for_eng', start_lego_id: 'S0L01', end_lego_id: 'S1L01', start_ord: 0, end_ord: 1, duration_seconds: 3600, started_at: daysAgo(2) },
      { class_id: 'c2', course_code: 'hin_for_eng', start_lego_id: 'S0L01', end_lego_id: 'S1L01', start_ord: 0, end_ord: 1, duration_seconds: 1800, started_at: daysAgo(20) },
      { class_id: 'c3', course_code: 'hin_for_eng', start_lego_id: 'S0L01', end_lego_id: 'S1L01', start_ord: 0, end_ord: 1, duration_seconds: 1800, started_at: daysAgo(200) },
    ]
    const week = makeRes()
    await handler(makeReq('c1', { compare_to: 'programme', measure: 'minutes', window: '7d' }), week)
    const month = makeRes()
    await handler(makeReq('c1', { compare_to: 'programme', measure: 'minutes', window: '30d' }), month)
    const all = makeRes()
    await handler(makeReq('c1', { compare_to: 'programme', measure: 'minutes', window: 'all' }), all)
    expect(week.statusCode).toBe(200)
    expect(month.statusCode).toBe(200)
    expect(all.statusCode).toBe(200)
    // cohort = c1 (60), c2 (0 this window), c3 (0 this window) -> mean 20
    expect(week.body.average.value).toBe(20)
    // cohort = c1 (60), c2 (30), c3 (0 this window) -> mean 30
    expect(month.body.average.value).toBe(30)
    // cohort = c1 (60), c2 (30), c3 (30) -> mean 40
    expect(all.body.average.value).toBe(40)
    expect(month.body.average.value).toBeGreaterThanOrEqual(week.body.average.value)
    expect(all.body.average.value).toBeGreaterThanOrEqual(month.body.average.value)
  })

  it('a ladder from an ancestor default onto a global rung values peers OUTSIDE the prefetched scope', async () => {
    // Regression (job #983): the ancestor-default path prefetches session rows
    // for the ancestor SCOPE and reuses them for the final averaging. When the
    // compare ladder then widens to a global rung, the cohort is global — so
    // school-3, which sits under `other-prog` and never appears in programme's
    // scope rows, must have its rows fetched rather than silently valued 0.
    verifyAdminResult = { userId: 'admin-1' }
    TABLES.groups.push({ id: 'metro', name: 'Metro International', type: 'region', parent_id: 'programme', path: 'india/ime/metro', is_demo: false })
    TABLES.groups.push({ id: 's4-node', name: 'Metro School', type: 'school', parent_id: 'metro', path: 'india/ime/metro/s4', is_demo: false })
    TABLES.schools.push({ id: 'school-4', school_name: 'Metro School', group_id: 'metro', node_group_id: 's4-node', is_demo: false })
    TABLES.classes.push({ id: 'c6', class_name: 'Year 8 French', course_code: 'fra_for_eng', school_id: 'school-4', group_id: 's4-node', is_active: true })
    SESSION_ROWS.push(...sessions('c6', 'fra_for_eng', [[0, 6], [6, 12]]))
    const res = makeRes()
    await handler(makeReq('metro'), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.applied.compare_to).toBe('global_all_courses')
    // school-3 (outside programme's scope, pace 12 via c5) is in the cohort
    // with its REAL value, so no cohort member reads as an unpractised zero.
    expect(res.body.distribution.values).toContain(12)
    expect(res.body.distribution.min).toBeGreaterThan(0)
  })

  it('the average is identical whichever of two classes in the same school requests it', async () => {
    verifyAdminResult = { userId: 'admin-1' }
    // c2 (pace 8) and c3 (pace 4) are the only two hin classes in school-2.
    // Each viewer's own compare_to defaults to its own school node (s2-node);
    // asking explicitly pins both requests to the same scope.
    const asC2 = makeRes()
    await handler(makeReq('c2', { compare_to: 's2-node' }), asC2)
    const asC3 = makeRes()
    await handler(makeReq('c3', { compare_to: 's2-node' }), asC3)
    expect(asC2.statusCode).toBe(200)
    expect(asC3.statusCode).toBe(200)
    // same two-member cohort (c2, c3) either way -> the same mean, 6
    expect(asC2.body.cohortSize).toBe(2)
    expect(asC3.body.cohortSize).toBe(2)
    expect(asC2.body.average.value).toBe(6)
    expect(asC3.body.average.value).toBe(6)
    expect(asC2.body.average.value).toBe(asC3.body.average.value)
  })
})
