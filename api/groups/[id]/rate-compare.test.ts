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
import { defaultWeekWindow, weekLabel, weekRange } from '../../_utils/schoolWeek'

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
let firstPlayRpcError = false
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => makeChainable(table),
    rpc: (fn: string, args: any) => {
      // WHEN EACH CLASS FIRST PLAYED (migration 20260916a) — the cohort gate
      // reads it for every candidate. The double answers from the same
      // fixtures the rest of the file uses: a class's first session across
      // SESSION_ROWS and the class account's diary, null when it has neither,
      // which is the never-started case the rule excludes.
      if (fn === 'class_first_play') {
        // A READ FAILURE is not an absence of play (job #989 fix-up): flip
        // this and the endpoint must say so rather than quietly dividing by
        // however many classes happened to survive.
        if (firstPlayRpcError) return Promise.resolve({ data: null, error: { message: 'statement timeout' } })
        const ids = (args?.p_class_ids ?? []) as string[]
        const learnerByClass = new Map<string, string>()
        for (const c of TABLES.classes ?? []) if (c.class_learner_id) learnerByClass.set(c.id, c.class_learner_id)
        return Promise.resolve({
          data: ids.map((id) => {
            const times: number[] = []
            for (const r of SESSION_ROWS) if (r.class_id === id) times.push(new Date(r.started_at).getTime())
            const lid = learnerByClass.get(id)
            if (lid) for (const e of (TABLES.player_events ?? [])) {
              if (e.learner_id === lid) times.push(new Date(e.occurred_at).getTime())
            }
            return { class_id: id, first_play: times.length ? new Date(Math.min(...times)).toISOString() : null }
          }),
          error: null,
        })
      }
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
  firstPlayRpcError = false
  verifyAdminResult = { error: 'Requires SSi admin access', status: 403 }
  verifyAuthTokenResult = { valid: false, error: 'no token' }
  visibleScopeResult = { ...EMPTY_SCOPE }
  vi.resetModules()
  handler = (await import('./rate-compare')).default
})

describe('GET /api/groups/:id/rate-compare', () => {
  it('401s an unauthenticated caller', async () => {
    const res = makeRes()
    await handler(makeReq('programme', { days: '90' }), res)
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
    await handler(makeReq('c1', { compare_to: 'programme', days: '90' }), res)
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
    await handler(makeReq('c1', { compare_to: 'programme', days: '90' }), res)
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
    await handler(makeReq('school-2', { days: '90' }), res)
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
    await handler(makeReq('programme', { days: '90' }), res)
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
    await handler(makeReq('school-2', { days: '90' }), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.options.compares.map((o: any) => o.value)).toEqual(
      ['programme', 'nation', 'global', 'global_all_courses'])
  })

  it('full ancestor chain at REGION/GROUP depth (programme, a non-root group): nation -> both globals', async () => {
    verifyAdminResult = { userId: 'admin-1' }
    const res = makeRes()
    await handler(makeReq('programme', { days: '90' }), res)
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
    await handler(makeReq('c1', { compare_to: 'programme', days: '90' }), res)
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
    await handler(makeReq('c1', { compare_to: 'global', days: '90' }), res)
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
    await handler(makeReq('school-2', { days: '90' }), res)
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
    await handler(makeReq('c1', { days: '90' }), res2)
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
    await handler(makeReq('school-2', { days: '90' }), res)
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
    await handler(makeReq('c1', { compare_to: 'global', days: '90' }), res)
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
    await handler(makeReq('c1', { compare_to: 'global', days: '90' }), res)
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
    await handler(makeReq('programme', { days: '90' }), res) // no compare_to → default = global (this course)
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
    expect(res.body.reason).toMatch(/have started in this scope/)
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
    await handler(makeReq('school-2', { days: '90' }), res)
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
    await handler(makeReq('school-2', { days: '90' }), res)
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
    await handler(makeReq('school-2', { days: '90' }), res)
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
    await handler(makeReq('metro', { days: '90' }), res) // default compare = programme average
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
    await handler(makeReq('school-2', { days: '90' }), res)
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

describe('GET /api/groups/:id/rate-compare — the SCHOOL WEEK is the window (job #989)', () => {
  // Tom, 2026-09-16: "today / 7 days / 30 days is the wrong primitive for
  // schools who work in week-units." These replace the rolling-window tests
  // deliberately — Today / Last 7 days / Last 30 days / All time are no
  // longer selectable windows, and ?days= is the only rolling path left.
  const LONDON = 'Europe/London'

  it('offers exactly two windows — This week and Last week', async () => {
    verifyAdminResult = { userId: 'admin-1' }
    const res = makeRes()
    await handler(makeReq('school-2'), res)
    expect(res.body.options.windows).toEqual([
      { value: 'this_week', label: 'This week' },
      { value: 'last_week', label: 'Last week' },
    ])
  })

  it('defaults to a week — last week on a Monday or Tuesday, this week otherwise', async () => {
    verifyAdminResult = { userId: 'admin-1' }
    const res = makeRes()
    await handler(makeReq('c1', { compare_to: 'programme', tz: LONDON }), res)
    const expected = defaultWeekWindow(Date.now(), LONDON)
    expect(res.body.applied.window).toBe(expected)
    expect(res.body.week.window).toBe(expected)
  })

  it('?window=this_week runs Monday 00:00 local to now', async () => {
    verifyAdminResult = { userId: 'admin-1' }
    const res = makeRes()
    await handler(makeReq('c1', { compare_to: 'programme', window: 'this_week', tz: LONDON }), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.applied.window).toBe('this_week')
    expect(res.body.windowLabel).toBe('This week')
    expect(res.body.week.rangeLabel).toBe(weekLabel(weekRange('this_week', Date.now(), LONDON), LONDON))
  })

  it('?window=last_week is the previous complete Monday–Sunday', async () => {
    verifyAdminResult = { userId: 'admin-1' }
    const res = makeRes()
    await handler(makeReq('c1', { compare_to: 'programme', window: 'last_week', tz: LONDON }), res)
    expect(res.body.applied.window).toBe('last_week')
    expect(res.body.windowLabel).toBe('Last week')
  })

  it('the trend is 12 Monday-anchored weekly bars, and an empty week is an empty week', async () => {
    verifyAdminResult = { userId: 'admin-1' }
    const res = makeRes()
    await handler(makeReq('c1', { compare_to: 'programme', window: 'this_week', tz: LONDON }), res)
    expect(res.body.week.bars.weeks).toHaveLength(12)
    expect(res.body.week.bars.entity).toHaveLength(12)
    expect(res.body.trendPeriodDays).toBe(7)
    // The legacy trend array carries the SAME bars — never two different
    // "last 12 weeks" on one page.
    expect(res.body.entity.trend).toEqual(res.body.week.bars.entity)
    // Two different nothings, and nothing else: a number is a real week, null
    // is absence (nobody had started yet). Never an interpolated value.
    const bars: (number | null)[] = res.body.week.bars.entity
    expect(bars.every((v) => v === null || typeof v === 'number')).toBe(true)
    // c1 first played 7 days ago, so the earlier buckets are ABSENCE, and the
    // newest ones are real weeks — a zero there would claim it was idle when
    // it did not yet exist as a playing class.
    expect(bars[0]).toBeNull()
    expect(typeof bars[bars.length - 1]).toBe('number')
  })

  it('carries the three numbers, with the total equal to X + Y', async () => {
    verifyAdminResult = { userId: 'admin-1' }
    const res = makeRes()
    await handler(makeReq('c1', { compare_to: 'programme', window: 'this_week', tz: LONDON }), res)
    const e = res.body.week.entity
    expect(typeof e.classMinutes).toBe('number')
    expect(typeof e.pupilMinutes).toBe('number')
    expect(e.totalMinutes).toBeCloseTo(e.classMinutes + e.pupilMinutes, 5)
    expect(typeof e.newPhrases).toBe('number')
  })

  it('the cohort keeps job #979b\u2019s fixed, self-inclusive denominator', async () => {
    verifyAdminResult = { userId: 'admin-1' }
    const res = makeRes()
    await handler(makeReq('c1', { compare_to: 'programme', window: 'this_week', tz: LONDON }), res)
    // c1 + its two hin peers c2/c3 — the tam class c4 is excluded by course.
    expect(res.body.week.cohort.size).toBe(3)
    expect(res.body.week.cohort.size).toBe(res.body.cohortSize)
  })

  it('never ships a ratio or a percent-vs-average inside the week block', async () => {
    verifyAdminResult = { userId: 'admin-1' }
    const res = makeRes()
    await handler(makeReq('c1', { compare_to: 'programme', window: 'this_week', tz: LONDON }), res)
    const keys = [...Object.keys(res.body.week.entity), ...Object.keys(res.body.week.cohort ?? {})]
    expect(keys.some((k) => /ratio|pct|percent|delta/i.test(k))).toBe(false)
  })

  it('there is no measure dropdown under a week — the card IS the numbers', async () => {
    verifyAdminResult = { userId: 'admin-1' }
    const res = makeRes()
    await handler(makeReq('school-2', { window: 'this_week' }), res)
    expect(res.body.options.measures).toEqual([])
  })

  it('old chip values in saved links land on a week rather than 404ing', async () => {
    verifyAdminResult = { userId: 'admin-1' }
    for (const [legacy, expected] of [['7d', 'this_week'], ['30d', 'this_week'], ['today', 'this_week'], ['all', 'this_week'], ['4w', 'last_week'], ['term', 'this_week']]) {
      const res = makeRes()
      await handler(makeReq('c1', { compare_to: 'programme', window: legacy }), res)
      expect(res.body.applied.window).toBe(expected)
    }
  })

  it('?days= still resolves the legacy rolling path, with no week block', async () => {
    verifyAdminResult = { userId: 'admin-1' }
    const res = makeRes()
    await handler(makeReq('c1', { compare_to: 'programme', days: '45' }), res)
    expect(res.body.applied.window).toBeNull()
    expect(res.body.applied.days).toBe(45)
    expect(res.body.week).toBeNull()
  })

  it('?window= wins over ?days= when both are present', async () => {
    verifyAdminResult = { userId: 'admin-1' }
    const res = makeRes()
    await handler(makeReq('c1', { compare_to: 'programme', window: 'last_week', days: '45' }), res)
    expect(res.body.applied.window).toBe('last_week')
  })

  it('a class that has NEVER played is in no denominator — the cohort counts started classes only (Tom via Watson, 2026-09-16)', async () => {
    verifyAdminResult = { userId: 'admin-1' }
    // c1 (entity), c2 and c3 are the hin classes; c3 is set up and has never
    // played a session. This OVERRIDES the never-started half of job #979b's
    // structural cohort: averaging a school against classes that never started
    // reads it as less than half as busy as it is — on the live cym_s course,
    // 67 of 127 active classes have never played.
    SESSION_ROWS = SESSION_ROWS.filter((r) => r.class_id !== 'c3')
    const res = makeRes()
    await handler(makeReq('c1', { compare_to: 'programme', window: 'this_week', tz: LONDON }), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.week.cohort.size).toBe(2) // c1 + c2, never c3
    expect(res.body.cohortSize).toBe(2)       // and ONE denominator for the whole page
  })

  it('the denominator does not move with the WINDOW — this week and last week divide by the same classes', async () => {
    verifyAdminResult = { userId: 'admin-1' }
    const thisW = makeRes()
    await handler(makeReq('c1', { compare_to: 'programme', window: 'this_week', tz: LONDON }), thisW)
    const lastW = makeRes()
    await handler(makeReq('c1', { compare_to: 'programme', window: 'last_week', tz: LONDON }), lastW)
    expect(thisW.body.week.cohort.size).toBe(lastW.body.week.cohort.size)
  })

  it('the denominator is viewer-independent — two classes in one school read the same N', async () => {
    verifyAdminResult = { userId: 'admin-1' }
    const asC2 = makeRes()
    await handler(makeReq('c2', { compare_to: 'programme', window: 'last_week', tz: LONDON }), asC2)
    const asC3 = makeRes()
    await handler(makeReq('c3', { compare_to: 'programme', window: 'last_week', tz: LONDON }), asC3)
    expect(asC2.body.week.cohort.size).toBe(asC3.body.week.cohort.size)
    expect(asC2.body.week.cohort.totalMinutes).toBe(asC3.body.week.cohort.totalMinutes)
  })

  it('a week before any class had started draws as ABSENCE, never as a row of zeros', async () => {
    verifyAdminResult = { userId: 'admin-1' }
    // Every class first plays 7 days ago, so the eleven older buckets have no
    // cohort at all — nothing to average, and nothing to draw.
    const res = makeRes()
    await handler(makeReq('c1', { compare_to: 'programme', window: 'this_week', tz: LONDON }), res)
    const cohortBars: (number | null)[] = res.body.week.bars.cohort
    expect(cohortBars).toHaveLength(12)
    expect(cohortBars[0]).toBeNull()
    expect(cohortBars.slice(0, 9).every((v) => v === null)).toBe(true)
    expect(cohortBars.some((v) => typeof v === 'number')).toBe(true)
  })

  it('a class joining today does not rewrite the school’s past bars', async () => {
    verifyAdminResult = { userId: 'admin-1' }
    const before = makeRes()
    await handler(makeReq('c1', { compare_to: 'programme', window: 'this_week', tz: LONDON }), before)
    // A brand-new class on the same course plays for the first time today.
    TABLES.classes.push({ id: 'c9', class_name: 'New', course_code: 'hin_for_eng', school_id: 'school-2', group_id: 's2-node', is_active: true })
    SESSION_ROWS.push({ class_id: 'c9', course_code: 'hin_for_eng', start_lego_id: 'S0L01', end_lego_id: 'S1L01', start_ord: 0, end_ord: 1, duration_seconds: 3600, started_at: daysAgo(0) })
    const after = makeRes()
    await handler(makeReq('c1', { compare_to: 'programme', window: 'this_week', tz: LONDON }), after)
    const b: (number | null)[] = before.body.week.bars.cohort
    const a: (number | null)[] = after.body.week.bars.cohort
    // Every bucket before the newcomer's first week is byte-identical.
    expect(a.slice(0, 11)).toEqual(b.slice(0, 11))
    expect(after.body.week.cohort.size).toBe(before.body.week.cohort.size + 1)
  })

  it('at SCHOOL level the cohort is SCHOOLS — the mean and the caption count the same thing (job #989 fix-up)', async () => {
    verifyAdminResult = { userId: 'admin-1' }
    const res = makeRes()
    await handler(makeReq('school-2', { compare_to: 'programme', window: 'this_week', tz: LONDON }), res)
    expect(res.statusCode).toBe(200)
    // Entity school-2 = c2 + c3 (30 min each this week). Peer school-1 = c1 (30).
    // Two SCHOOLS, so the average is mean(60, 30) = 45 — not mean(30,30,30) = 30,
    // which is what flattening the members into a list of class ids produced
    // while the caption underneath it still said "schools".
    expect(res.body.week.entity.totalMinutes).toBe(60)
    expect(res.body.week.cohort.size).toBe(2)
    expect(res.body.week.cohort.sizeLabel).toBe('2 schools')
    expect(res.body.week.cohort.totalMinutes).toBe(45)
    // One denominator for the whole page, at every level.
    expect(res.body.cohortSize).toBe(2)
  })

  it('the 12 cohort bars are IDENTICAL whichever week is selected (job #989 fix-up)', async () => {
    verifyAdminResult = { userId: 'admin-1' }
    // A class whose FIRST play is this week. Selecting "last week" used to drop
    // it from the candidate set before the buckets were built, so the newest
    // bar's average lost a member — history changed under the reader's feet
    // depending on which week they were standing in.
    TABLES.classes.push({ id: 'c9', class_name: 'Brand New', course_code: 'hin_for_eng', school_id: 'school-2', group_id: 's2-node', is_active: true })
    SESSION_ROWS.push({ class_id: 'c9', course_code: 'hin_for_eng', start_lego_id: 'S0L01', end_lego_id: 'S3L01', start_ord: 0, end_ord: 3, duration_seconds: 5400, started_at: daysAgo(0) })
    const thisW = makeRes()
    await handler(makeReq('c1', { compare_to: 'programme', window: 'this_week', tz: LONDON }), thisW)
    const lastW = makeRes()
    await handler(makeReq('c1', { compare_to: 'programme', window: 'last_week', tz: LONDON }), lastW)
    expect(thisW.body.week.bars.cohort).toEqual(lastW.body.week.bars.cohort)
    expect(thisW.body.week.bars.entity).toEqual(lastW.body.week.bars.entity)
    // The newcomer really is in the newest bar — otherwise this pins nothing.
    expect(typeof thisW.body.week.bars.cohort[11]).toBe('number')
  })

  it('a viewed class that had not STARTED by the end of the selected week is in no denominator — headline and card agree (job #989 fix-up)', async () => {
    verifyAdminResult = { userId: 'admin-1' }
    // c1's only play is today, i.e. THIS week. Read with "last week" selected,
    // it had not started by that week's end — so it is not one of the classes
    // last week's average divides by, exactly as a peer in the same position
    // would not be. It is still shown its own numbers. Before this fix-up the
    // headline counted it and the week card did not, so one screen carried two
    // denominators.
    SESSION_ROWS = [
      { class_id: 'c1', course_code: 'hin_for_eng', start_lego_id: 'S0L01', end_lego_id: 'S2L01', start_ord: 0, end_ord: 2, duration_seconds: 1800, started_at: daysAgo(0) },
      ...SESSION_ROWS.filter((r) => r.class_id === 'c2' || r.class_id === 'c3'),
    ]
    const res = makeRes()
    await handler(makeReq('c1', { compare_to: 'programme', window: 'last_week', tz: LONDON }), res)
    expect(res.statusCode).toBe(200)
    // Its own row is still drawn — a class always sees itself.
    expect(res.body.entity.label).toBe('Year 6 Hindi')
    expect(res.body.week.cohort.size).toBe(2)      // c2 + c3, never c1
    expect(res.body.cohortSize).toBe(2)            // ONE denominator for the page
    expect(res.body.cohortIncludesEntity).toBe(false)
  })

  it('a FAILED first-play read is loud, never a quietly smaller cohort (job #989 fix-up)', async () => {
    verifyAdminResult = { userId: 'admin-1' }
    firstPlayRpcError = true
    const res = makeRes()
    await handler(makeReq('c1', { compare_to: 'programme', window: 'this_week', tz: LONDON }), res)
    expect(res.statusCode).toBe(500)
    expect(res.body.error).toMatch(/first played/i)
  })

  it('a nonsense time zone falls back rather than throwing', async () => {
    verifyAdminResult = { userId: 'admin-1' }
    const res = makeRes()
    await handler(makeReq('c1', { compare_to: 'programme', window: 'this_week', tz: 'Mars/Olympus' }), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.week.timeZone).toBe('Europe/London')
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
    await handler(makeReq('c1', { compare_to: 'programme', measure: 'minutes', days: '7' }), week)
    const month = makeRes()
    await handler(makeReq('c1', { compare_to: 'programme', measure: 'minutes', days: '30' }), month)
    const all = makeRes()
    await handler(makeReq('c1', { compare_to: 'programme', measure: 'minutes', days: '180' }), all)
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
      await handler(makeReq('c1', { compare_to: 'programme', measure: legacy, days: '90' }), res)
      expect(res.statusCode).toBe(200)
      expect(res.body.applied.measure).toBe('minutes')
    }
  })

  it('the minutes total is a TOTAL, never divided down to a per-day rate', async () => {
    // Was "under Today…": the Today window went when the week became the
    // primitive (job #989). The rule it guarded — a total is never scaled —
    // still holds on the preserved ?days= path.
    verifyAdminResult = { userId: 'admin-1' }
    SESSION_ROWS = SESSION_ROWS.filter((r) => r.class_id !== 'c1')
    SESSION_ROWS.push({ class_id: 'c1', course_code: 'hin_for_eng', start_lego_id: 'S0L01', end_lego_id: 'S5L01', start_ord: 0, end_ord: 5, duration_seconds: 1800, started_at: daysAgo(0) })
    const res = makeRes()
    await handler(makeReq('c1', { compare_to: 'programme', measure: 'minutes', days: '7' }), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.entity.value).toBe(30)
    expect(res.body.per).toBe('')
  })

  it('measure=minutes: same grammar, a different metric — the in-app minutes total in the window', async () => {
    verifyAdminResult = { userId: 'admin-1' }
    const res = makeRes()
    await handler(makeReq('c1', { compare_to: 'programme', measure: 'minutes', days: '90' }), res)
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
    await handler(makeReq('school-2', { measure: 'active_classes', days: '90' }), res)
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
    await handler(makeReq('c1', { measure: 'active_classes', days: '90' }), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.applied.measure).toBe('rate')
    expect(res.body.options.measures.map((m: any) => m.value)).not.toContain('active_classes')
  })

  it('options.measures: full 3 at node level, 2 (no active_classes) at class level; each carries a plain-language desc', async () => {
    verifyAdminResult = { userId: 'admin-1' }
    const res = makeRes()
    await handler(makeReq('school-2', { days: '90' }), res)
    expect(res.body.options.measures.map((m: any) => m.value)).toEqual(
      ['rate', 'minutes', 'active_classes'])
    expect(res.body.options.measures.every((m: any) => typeof m.desc === 'string' && m.desc.length > 0)).toBe(true)

    const res2 = makeRes()
    await handler(makeReq('c1', { days: '90' }), res2)
    expect(res2.body.options.measures.map((m: any) => m.value)).toEqual(['rate', 'minutes'])
  })

  it('unknown measure falls back to the default (rate)', async () => {
    verifyAdminResult = { userId: 'admin-1' }
    const res = makeRes()
    await handler(makeReq('c1', { compare_to: 'programme', measure: 'bogus', days: '90' }), res)
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
    await handler(makeReq('c6', { compare_to: 'programme', days: '90' }), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.insufficientData).toBe(false)
    expect(res.body.entity.value).toBeGreaterThan(0)       // LEGOs per week off the diary
    expect(res.body.contextLine).toBeUndefined()           // S5L01 has no content row in this fixture: no line, never a raw id

    const mins = makeRes()
    await handler(makeReq('c6', { compare_to: 'programme', measure: 'minutes', days: '90' }), mins)
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
    await handler(makeReq('school-1', { compare_to: 'programme', days: '90' }), res)
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
  it('a sum measure (practice minutes): the average only rises as the window widens', async () => {
    verifyAdminResult = { userId: 'admin-1' }
    // c1 (entity) practises 2 days ago only; c2 (peer) 20 days ago only; c3
    // (peer) 120 days ago only — inactive members count with their TRUE
    // value (0) in a window they didn't practise in, never dropped. The three
    // arms ride ?days=, the only rolling path left since the week became the
    // primitive (job #989); 180 days is its ceiling and stands in for the old
    // all-time arm.
    SESSION_ROWS = [
      { class_id: 'c1', course_code: 'hin_for_eng', start_lego_id: 'S0L01', end_lego_id: 'S1L01', start_ord: 0, end_ord: 1, duration_seconds: 3600, started_at: daysAgo(2) },
      { class_id: 'c2', course_code: 'hin_for_eng', start_lego_id: 'S0L01', end_lego_id: 'S1L01', start_ord: 0, end_ord: 1, duration_seconds: 1800, started_at: daysAgo(20) },
      { class_id: 'c3', course_code: 'hin_for_eng', start_lego_id: 'S0L01', end_lego_id: 'S1L01', start_ord: 0, end_ord: 1, duration_seconds: 1800, started_at: daysAgo(120) },
    ]
    const week = makeRes()
    await handler(makeReq('c1', { compare_to: 'programme', measure: 'minutes', days: '7' }), week)
    const month = makeRes()
    await handler(makeReq('c1', { compare_to: 'programme', measure: 'minutes', days: '30' }), month)
    const all = makeRes()
    await handler(makeReq('c1', { compare_to: 'programme', measure: 'minutes', days: '180' }), all)
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

  it('names the cohort scope once — a global rung carries it in its own label', async () => {
    // Staging read "Global average · this course · all 6 classes on this
    // course" before this (job #983): the label and the appended note both
    // said it.
    verifyAdminResult = { userId: 'admin-1' }
    const res = makeRes()
    await handler(makeReq('c1', { compare_to: 'global' }), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.average.label).toBe('Global average · this course')
    expect(res.body.cohortSizeLine).toBe('Global average · this course · all 4 classes')
    // a scope whose label does NOT name the course still says which course
    const res2 = makeRes()
    await handler(makeReq('c1', { compare_to: 'programme' }), res2)
    expect(res2.body.cohortSizeLine).toBe('IME Demo Programme average · all 3 classes on this course')
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
    await handler(makeReq('metro', { days: '90' }), res)
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
    await handler(makeReq('c2', { compare_to: 's2-node', days: '90' }), asC2)
    const asC3 = makeRes()
    await handler(makeReq('c3', { compare_to: 's2-node', days: '90' }), asC3)
    expect(asC2.statusCode).toBe(200)
    expect(asC3.statusCode).toBe(200)
    // same two-member cohort (c2, c3) either way -> the same mean, 6
    expect(asC2.body.cohortSize).toBe(2)
    expect(asC3.body.cohortSize).toBe(2)
    expect(asC2.body.average.value).toBe(6)
    expect(asC3.body.average.value).toBe(6)
    expect(asC2.body.average.value).toBe(asC3.body.average.value)
  })

  it('the dashed comparison series is a mean over the SAME cohort as the headline average — a dormant member contributes zeros, it does not drop out', async () => {
    verifyAdminResult = { userId: 'admin-1' }
    // c1 (entity) and c2 practise today; c3 STARTED long ago and has been
    // silent since. periodTrendForClass used to return an empty array for a
    // silent class and meanTrend silently dropped it, so the dashed line was
    // a mean of 2 while the headline average beside it was a mean of 3.
    //
    // c3 was a NEVER-PLAYED class when this test was written. Tom's cohort
    // ruling of 2026-09-16 (job #989) takes never-started classes out of every
    // denominator, so the fixture is now a class that started and went quiet —
    // which is the case this rule is actually about, and it is unchanged:
    // dormancy is a fact about the week, never grounds for dropping out.
    SESSION_ROWS = [
      { class_id: 'c1', course_code: 'hin_for_eng', start_lego_id: 'S0L01', end_lego_id: 'S1L01', start_ord: 0, end_ord: 6, duration_seconds: 1800, started_at: daysAgo(0) },
      { class_id: 'c2', course_code: 'hin_for_eng', start_lego_id: 'S0L01', end_lego_id: 'S1L01', start_ord: 0, end_ord: 3, duration_seconds: 1800, started_at: daysAgo(0) },
      { class_id: 'c3', course_code: 'hin_for_eng', start_lego_id: 'S0L01', end_lego_id: 'S0L01', start_ord: 0, end_ord: 0, duration_seconds: 600, started_at: daysAgo(150) },
    ]
    const res = makeRes()
    // measure=rate is where the bug lived: the minutes trend already emitted
    // zeros for a dormant member, the LEGO-progress trend emitted nothing. It
    // rides the ?days= path now — the week windows carry their own bars.
    await handler(makeReq('c1', { compare_to: 'programme', measure: 'rate', days: '7' }), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.cohortSize).toBe(3)
    // The newest point is mean(c1's 6 LEGOs, c2's 3, c3's 0) = 3. Dropping c3
    // reads 4.5 — a dashed line drawn over a different cohort than the
    // figure it sits beside.
    const trend: number[] = res.body.average.trend
    expect(trend[trend.length - 1]).toBe(3)
    expect(trend.slice(0, -1).every((v: number) => v === 0)).toBe(true)
  })

  it('the same rule under a WEEK window: the dashed weekly bars are a mean over every member, dormant ones at zero (job #989)', async () => {
    verifyAdminResult = { userId: 'admin-1' }
    // c1 and c2 each play half an hour this week; c3 STARTED 150 days ago and
    // has been silent since. The bars are total learning time, so this week's
    // bar is mean(30, 30, 0) = 20 — dropping the dormant c3 would read 30.
    SESSION_ROWS = [
      // daysAgo(0), not `new Date()`: the week's end is EXCLUSIVE (cohortFor
      // and the minute sums both read `< endMs`), and for THIS week that end
      // is the instant the request is served — a fixture stamped in the same
      // millisecond as the handler's own clock is a knife-edge, not a case.
      { class_id: 'c1', course_code: 'hin_for_eng', start_lego_id: 'S0L01', end_lego_id: 'S1L01', start_ord: 0, end_ord: 6, duration_seconds: 1800, started_at: daysAgo(0) },
      { class_id: 'c2', course_code: 'hin_for_eng', start_lego_id: 'S0L01', end_lego_id: 'S1L01', start_ord: 0, end_ord: 3, duration_seconds: 1800, started_at: daysAgo(0) },
      { class_id: 'c3', course_code: 'hin_for_eng', start_lego_id: 'S0L01', end_lego_id: 'S0L01', start_ord: 0, end_ord: 0, duration_seconds: 600, started_at: daysAgo(150) },
    ]
    const res = makeRes()
    await handler(makeReq('c1', { compare_to: 'programme', window: 'this_week', tz: 'Europe/London' }), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.week.cohort.size).toBe(3)
    const bars: number[] = res.body.week.bars.cohort
    expect(bars).toHaveLength(12)
    expect(bars[bars.length - 1]).toBe(20)
  })
})
