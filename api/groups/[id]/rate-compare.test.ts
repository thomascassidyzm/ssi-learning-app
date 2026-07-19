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
  // two sessions exactly 7 days apart -> weeks span = 1 -> pace = legos advanced
  return ords.map(([startOrd, endOrd], i) => ({
    class_id: classId,
    course_code: course,
    start_lego_id: `S${startOrd}L01`,
    end_lego_id: `S${endOrd}L01`,
    start_ord: startOrd,
    end_ord: endOrd,
    duration_seconds: 1800,
    started_at: daysAgo(14 - i * 7),
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
      { id: 'school-1', school_name: 'Sunrise Public School', group_id: 'programme', node_group_id: 's1-node' },
      { id: 'school-2', school_name: 'St. Mary’s Academy', group_id: 'programme', node_group_id: 's2-node' },
      { id: 'school-3', school_name: 'Green Valley International', group_id: 'other-prog', node_group_id: 's3-node' },
    ],
    classes: [
      { id: 'c1', class_name: 'Year 6 Hindi', course_code: 'hin_for_eng', school_id: 'school-1', group_id: 's1-node', is_active: true },
      { id: 'c2', class_name: 'Year 5 Hindi', course_code: 'hin_for_eng', school_id: 'school-2', group_id: 's2-node', is_active: true },
      { id: 'c3', class_name: 'Year 4 Hindi', course_code: 'hin_for_eng', school_id: 'school-2', group_id: 's2-node', is_active: true },
      { id: 'c4', class_name: 'Year 6 Tamil', course_code: 'tam_for_eng', school_id: 'school-2', group_id: 's2-node', is_active: true },
      { id: 'c5', class_name: 'Year 3 Hindi', course_code: 'hin_for_eng', school_id: 'school-3', group_id: 's3-node', is_active: true },
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
  for (const m of ['select', 'eq', 'neq', 'in', 'is', 'not', 'like', 'order', 'limit']) builder[m] = chain(m)
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
    expect(res.body.applied.compare_to).toBe('s1-node')
    // c1 is the only class in school-1 — no peers, honest insufficiency even for admin
    expect(res.body.insufficientData).toBe(true)
    expect(res.body.cohortSize).toBe(0)
  })

  it('admin · class vs programme average: peer classes on the SAME course only', async () => {
    verifyAdminResult = { userId: 'admin-1' }
    const res = makeRes()
    await handler(makeReq('c1', { compare_to: 'programme' }), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.insufficientData).toBe(false)
    // cohort = c2 (8) + c3 (4); the tam class c4 is excluded by course
    expect(res.body.cohortSize).toBe(2)
    expect(res.body.entity.value).toBe(10)
    expect(res.body.average.value).toBe(6)
    expect(res.body.average.label).toBe('IME Demo Programme average')
    expect(res.body.percentile).toBe(100)
    // Anonymity: no peer identity ever leaves the server
    const raw = JSON.stringify(res.body)
    for (const leak of ['c2', 'c3', 'Year 5', 'Year 4', 'St. Mary', 'school-2']) {
      expect(raw).not.toContain(leak)
    }
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
    // cohort = school-1 only (aggregate of c1 = 10); entity = mean(c2, c3) = 6
    expect(res.body.cohortSize).toBe(1)
    expect(res.body.entity.value).toBe(6)
    expect(res.body.average.value).toBe(10)
  })

  it('admin · group node vs nation: school-spread cohort excludes own subtree', async () => {
    verifyAdminResult = { userId: 'admin-1' }
    const res = makeRes()
    await handler(makeReq('programme'), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.applied.compare_to).toBe('nation')
    // entity = hin classes below programme: c1 (10), c2 (8), c3 (4) → 7.3
    expect(res.body.entity.value).toBe(7.3)
    // cohort = schools under nation minus programme's own → school-3 (12)
    expect(res.body.cohortSize).toBe(1)
    expect(res.body.average.value).toBe(12)
    expect(res.body.deltaPct).toBe(-39.2)
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

  it('teacher · own class passes the door but K_FLOOR holds (never a tiny cohort)', async () => {
    verifyAuthTokenResult = { valid: true, userId: 'teacher-1' }
    visibleScopeResult = { ...EMPTY_SCOPE, role: 'teacher', classIds: ['c1'] }
    const res = makeRes()
    await handler(makeReq('c1', { compare_to: 'programme' }), res)
    expect(res.statusCode).toBe(200)
    // 2 active peers < K_FLOOR 5 → honest insufficiency for a non-admin
    expect(res.body.insufficientData).toBe(true)
    expect(res.body.cohortSize).toBe(2)
    expect(res.body.kFloor).toBe(5)
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
    // schools 2 + 3 as peers (school-2's pool now includes the tam class)
    expect(res.body.cohortSize).toBe(2)
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

  it('404s an unknown id', async () => {
    verifyAdminResult = { userId: 'admin-1' }
    const res = makeRes()
    await handler(makeReq('nothing-here'), res)
    expect(res.statusCode).toBe(404)
  })
})
