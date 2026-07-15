/**
 * Tests for GET /api/school/rate-compare — course-first, full entity ladder
 * (class/school/group vs school/group/region/global averages).
 * resolveVisibleScope + the analytics_class_sessions_scoped RPC are mocked;
 * the math itself is covered by api/_utils/rateCompare.test.ts. The mock DB
 * below is a real in-memory filter engine (not table-name routing) since the
 * endpoint now issues several distinctly-shaped queries against the same
 * tables (classes/schools/groups).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-key'

vi.mock('../_utils/auth', () => ({
  verifyAuthToken: vi.fn(async () => ({ valid: true, userId: 'caller-1' })),
}))

let scope: any
vi.mock('../_utils/schoolScope', () => ({
  resolveVisibleScope: vi.fn(async () => scope),
}))

let DB: { classes: any[]; schools: any[]; groups: any[] }
let rpcRows: any[]
let rpcError: any = null

function makeChainable(table: string) {
  let rows: any[] = [...((DB as any)[table] ?? [])]
  const builder: any = {
    select: () => builder,
    eq: (col: string, val: unknown) => { rows = rows.filter((r) => r[col] === val); return builder },
    neq: (col: string, val: unknown) => { rows = rows.filter((r) => r[col] !== val); return builder },
    in: (col: string, vals: unknown[]) => { rows = rows.filter((r) => vals.includes(r[col])); return builder },
    like: (col: string, pattern: string) => {
      const prefix = pattern.endsWith('%') ? pattern.slice(0, -1) : pattern
      rows = rows.filter((r) => typeof r[col] === 'string' && r[col].startsWith(prefix))
      return builder
    },
    not: (col: string, op: string, val: unknown) => {
      if (op === 'is' && val === null) rows = rows.filter((r) => r[col] != null)
      return builder
    },
    limit: () => builder,
    maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
    single: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
    then: (resolve: any) => Promise.resolve({ data: rows, error: null }).then(resolve),
  }
  return builder
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => makeChainable(table),
    rpc: () => Promise.resolve({ data: rpcRows, error: rpcError }),
  }),
}))

function makeReq(query: Record<string, string>): VercelRequest {
  return { method: 'GET', query, headers: { authorization: 'Bearer tok' } } as any
}

function makeRes(): VercelResponse & { statusCode?: number; body?: any } {
  const res: any = {}
  res.setHeader = vi.fn()
  res.status = vi.fn((code: number) => { res.statusCode = code; return res })
  res.json = vi.fn((body: any) => { res.body = body; return res })
  return res
}

let handler: typeof import('./rate-compare').default

// Session row for one class, `pace` cohort-classes each get a distinct end_ord so their
// paces differ slightly (avoids ties masking real averaging bugs).
function sessRow(classId: string, endOrd: number, startedAt: string): any {
  return {
    class_id: classId, course_code: 'gle_for_eng', start_ord: 1, end_ord: endOrd,
    start_lego_id: 'S1L01', end_lego_id: `S2L${endOrd}`, duration_seconds: 3000, started_at: startedAt,
  }
}

beforeEach(async () => {
  vi.resetModules()
  handler = (await import('./rate-compare')).default

  DB = {
    classes: [
      { id: 'class-1', class_name: 'Rang a Cúig', course_code: 'gle_for_eng', school_id: 'sch-1', is_active: true },
      ...Array.from({ length: 6 }, (_, i) => ({
        id: `cohort-${i}`, class_name: `Cohort ${i}`, course_code: 'gle_for_eng', school_id: 'sch-1', is_active: true,
      })),
    ],
    schools: [{ id: 'sch-1', school_name: 'Coláiste Éinde', group_id: null }],
    groups: [],
  }
  scope = { learnerId: 'l1', role: 'teacher', classIds: ['class-1'], learnerIds: [], studentsByClass: {}, schoolIds: [], groupId: null }
  rpcRows = []
  rpcError = null
})

describe('GET /api/school/rate-compare — class entity', () => {
  it('rejects an entity_id outside the caller scope', async () => {
    const req = makeReq({ course_code: 'gle_for_eng', entity_level: 'class', entity_id: 'not-mine', compare_to: 'school' })
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(403)
  })

  it('rejects an unsupported compare_to for the class level', async () => {
    const req = makeReq({ course_code: 'gle_for_eng', entity_level: 'class', entity_id: 'class-1', compare_to: 'region' })
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(400)
  })

  it('returns insufficientData when the school has no other classes to compare within', async () => {
    DB.classes = DB.classes.filter((c) => c.id === 'class-1')
    const req = makeReq({ course_code: 'gle_for_eng', entity_level: 'class', entity_id: 'class-1', compare_to: 'school' })
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(200)
    expect(res.body.insufficientData).toBe(true)
    expect(res.body.kFloor).toBe(5)
  })

  it('returns insufficientData under the k-floor even when class ids exist but have no session activity', async () => {
    rpcRows = [sessRow('class-1', 10, new Date().toISOString())]
    const req = makeReq({ course_code: 'gle_for_eng', entity_level: 'class', entity_id: 'class-1', compare_to: 'school' })
    const res = makeRes()
    await handler(req, res)
    expect(res.body.insufficientData).toBe(true)
  })

  it('computes a real entity-vs-average comparison once the k-floor is met', async () => {
    const now = new Date().toISOString()
    rpcRows = [sessRow('class-1', 20, now), ...Array.from({ length: 5 }, (_, i) => sessRow(`cohort-${i}`, 10 + i, now))]
    const req = makeReq({ course_code: 'gle_for_eng', entity_level: 'class', entity_id: 'class-1', compare_to: 'school' })
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(200)
    expect(res.body.insufficientData).toBe(false)
    expect(res.body.cohortSize).toBe(5)
    expect(res.body.entity.label).toBe('Rang a Cúig')
    expect(res.body.average.label).toBe('School average')
    expect(res.body.distribution.values).toHaveLength(5)
    // Never leaks another class's identity — only the aggregate label + numbers.
    expect(JSON.stringify(res.body)).not.toContain('cohort-0')
  })

  it('rejects compare_to=school for a class with no school (nothing to compare within)', async () => {
    DB.classes = [{ id: 'class-1', class_name: 'Solo tutor class', course_code: 'gle_for_eng', school_id: null, is_active: true }]
    const req = makeReq({ course_code: 'gle_for_eng', entity_level: 'class', entity_id: 'class-1', compare_to: 'school' })
    const res = makeRes()
    await handler(req, res)
    expect(res.body.insufficientData).toBe(true)
    expect(res.body.reason).toMatch(/no school/i)
  })

  it('404s when the class does not run the requested course', async () => {
    const req = makeReq({ course_code: 'cym_for_eng', entity_level: 'class', entity_id: 'class-1', compare_to: 'school' })
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(404)
  })
})

describe('GET /api/school/rate-compare — school entity', () => {
  beforeEach(() => {
    scope = { learnerId: 'l1', role: 'school_admin', classIds: DB.classes.map((c) => c.id), learnerIds: [], studentsByClass: {}, schoolIds: ['sch-1'], groupId: null }
  })

  it('rejects a school entity_id outside the caller scope', async () => {
    const req = makeReq({ course_code: 'gle_for_eng', entity_level: 'school', entity_id: 'not-mine', compare_to: 'global' })
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(403)
  })

  it('rejects compare_to=group for a school with no group (nothing to compare within)', async () => {
    const req = makeReq({ course_code: 'gle_for_eng', entity_level: 'school', entity_id: 'sch-1', compare_to: 'group' })
    const res = makeRes()
    await handler(req, res)
    expect(res.body.insufficientData).toBe(true)
    expect(res.body.reason).toMatch(/not part of a group/i)
  })

  it('computes school-vs-global averaging each PEER SCHOOL (not each class) into one cohort value', async () => {
    // 5 peer schools, each with 2 classes at the SAME pace — a peer school's
    // aggregate must be one cohort member, not 2 (else k-floor would pass on
    // fewer real schools than it looks like).
    DB.schools.push(...Array.from({ length: 5 }, (_, i) => ({ id: `peer-sch-${i}`, school_name: `Peer ${i}`, group_id: null })))
    DB.classes.push(
      ...Array.from({ length: 5 }, (_, i) => [
        { id: `peer-${i}-a`, class_name: 'A', course_code: 'gle_for_eng', school_id: `peer-sch-${i}`, is_active: true },
        { id: `peer-${i}-b`, class_name: 'B', course_code: 'gle_for_eng', school_id: `peer-sch-${i}`, is_active: true },
      ]).flat(),
    )
    const now = new Date().toISOString()
    rpcRows = [
      sessRow('class-1', 30, now), ...Array.from({ length: 6 }, (_, i) => sessRow(`cohort-${i}`, 15, now)),
      ...Array.from({ length: 5 }, (_, i) => [sessRow(`peer-${i}-a`, 10 + i, now), sessRow(`peer-${i}-b`, 10 + i, now)]).flat(),
    ]
    const req = makeReq({ course_code: 'gle_for_eng', entity_level: 'school', entity_id: 'sch-1', compare_to: 'global' })
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(200)
    expect(res.body.insufficientData).toBe(false)
    expect(res.body.cohortSize).toBe(5) // 5 peer SCHOOLS, not 10 peer classes
    expect(res.body.entity.label).toBe('Coláiste Éinde')
    expect(res.body.average.label).toBe('Global average · this course')
    expect(JSON.stringify(res.body)).not.toContain('peer-sch-0')
  })
})

describe('GET /api/school/rate-compare — global_all_courses (offered alongside same-course cohorts, every level)', () => {
  it('class-vs-global_all_courses pulls in peer classes from OTHER courses, unlike compare_to=global', async () => {
    // A peer class on a DIFFERENT course than the entity's — same-course
    // 'global' must never see it; 'global_all_courses' must.
    DB.classes.push(
      ...Array.from({ length: 5 }, (_, i) => ({
        id: `other-course-${i}`, class_name: 'X', course_code: 'cym_for_eng', school_id: 'sch-1', is_active: true,
      })),
    )
    const now = new Date().toISOString()
    rpcRows = [
      sessRow('class-1', 30, now),
      ...Array.from({ length: 5 }, (_, i) => sessRow(`other-course-${i}`, 10 + i, now)),
    ]

    const sameCourseReq = makeReq({ course_code: 'gle_for_eng', entity_level: 'class', entity_id: 'class-1', compare_to: 'global' })
    const sameCourseRes = makeRes()
    await handler(sameCourseReq, sameCourseRes)
    // Only the 6 gle_for_eng cohort-* classes exist on this course besides class-1, none have session rows here -> insufficient.
    expect(sameCourseRes.body.insufficientData).toBe(true)

    const allCoursesReq = makeReq({ course_code: 'gle_for_eng', entity_level: 'class', entity_id: 'class-1', compare_to: 'global_all_courses' })
    const allCoursesRes = makeRes()
    await handler(allCoursesReq, allCoursesRes)
    expect(allCoursesRes.statusCode).toBe(200)
    expect(allCoursesRes.body.insufficientData).toBe(false)
    expect(allCoursesRes.body.cohortSize).toBe(5) // the 5 other-course-* classes clear k-floor
    expect(allCoursesRes.body.average.label).toBe('Global average · all courses')
  })

  it('holds the same K_FLOOR for the all-courses cohort as every other aggregate', async () => {
    DB.classes.push(
      ...Array.from({ length: 3 }, (_, i) => ({
        id: `few-other-${i}`, class_name: 'X', course_code: 'cym_for_eng', school_id: 'sch-1', is_active: true,
      })),
    )
    const now = new Date().toISOString()
    rpcRows = [sessRow('class-1', 30, now), ...Array.from({ length: 3 }, (_, i) => sessRow(`few-other-${i}`, 10 + i, now))]
    const req = makeReq({ course_code: 'gle_for_eng', entity_level: 'class', entity_id: 'class-1', compare_to: 'global_all_courses' })
    const res = makeRes()
    await handler(req, res)
    expect(res.body.insufficientData).toBe(true) // only 3 active peers, below K_FLOOR=5
    expect(res.body.kFloor).toBe(5)
  })

  it('school-vs-global_all_courses aggregates each peer school across ALL its courses, not just the selected one', async () => {
    scope = { learnerId: 'l1', role: 'school_admin', classIds: DB.classes.map((c) => c.id), learnerIds: [], studentsByClass: {}, schoolIds: ['sch-1'], groupId: null }
    DB.schools.push({ id: 'peer-sch-0', school_name: 'Peer 0', group_id: null })
    DB.classes.push(
      // this peer school's ONLY class is on a DIFFERENT course than gle_for_eng.
      { id: 'peer-0-other-course', class_name: 'X', course_code: 'cym_for_eng', school_id: 'peer-sch-0', is_active: true },
    )
    // 4 more peer schools WITH the selected course, to reach K_FLOOR=5 total.
    DB.schools.push(...Array.from({ length: 4 }, (_, i) => ({ id: `peer-sch-${i + 1}`, school_name: `Peer ${i + 1}`, group_id: null })))
    DB.classes.push(...Array.from({ length: 4 }, (_, i) => ({ id: `peer-${i + 1}-class`, class_name: 'X', course_code: 'gle_for_eng', school_id: `peer-sch-${i + 1}`, is_active: true })))
    const now = new Date().toISOString()
    rpcRows = [
      sessRow('class-1', 30, now),
      sessRow('peer-0-other-course', 12, now),
      ...Array.from({ length: 4 }, (_, i) => sessRow(`peer-${i + 1}-class`, 10 + i, now)),
    ]
    const req = makeReq({ course_code: 'gle_for_eng', entity_level: 'school', entity_id: 'sch-1', compare_to: 'global_all_courses' })
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(200)
    expect(res.body.insufficientData).toBe(false)
    expect(res.body.cohortSize).toBe(5) // peer-sch-0 (off-course) counts here, unlike compare_to=global
  })

  it('group-vs-global_all_courses still excludes ancestor/descendant subtrees, using any-course peer classIds', async () => {
    DB.groups = [
      { id: 'grp-uk', name: 'UK', path: 'uk.', parent_id: null },
      { id: 'grp-wales', name: 'Wales', path: 'uk.wales.', parent_id: 'grp-uk' },
      ...Array.from({ length: 5 }, (_, i) => ({ id: `grp-far-${i}`, name: `Far ${i}`, path: `far${i}.`, parent_id: null })),
    ]
    DB.schools = [
      { id: 'sch-1', school_name: 'Coláiste Éinde', group_id: 'grp-wales' },
      ...Array.from({ length: 5 }, (_, i) => ({ id: `far-sch-${i}`, school_name: `Far School ${i}`, group_id: `grp-far-${i}` })),
    ]
    // Each far school's class is on a DIFFERENT course than gle_for_eng.
    DB.classes.push(
      ...Array.from({ length: 5 }, (_, i) => ({ id: `far-class-${i}`, class_name: 'X', course_code: 'cym_for_eng', school_id: `far-sch-${i}`, is_active: true })),
    )
    scope = { learnerId: 'l1', role: 'govt_admin', classIds: DB.classes.map((c) => c.id), learnerIds: [], studentsByClass: {}, schoolIds: ['sch-1'], groupId: 'grp-wales' }
    const now = new Date().toISOString()
    rpcRows = [
      sessRow('class-1', 30, now), ...Array.from({ length: 6 }, (_, i) => sessRow(`cohort-${i}`, 15, now)),
      ...Array.from({ length: 5 }, (_, i) => sessRow(`far-class-${i}`, 10 + i, now)),
    ]
    const req = makeReq({ course_code: 'gle_for_eng', entity_level: 'group', entity_id: 'grp-wales', compare_to: 'global_all_courses' })
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(200)
    expect(res.body.cohortSize).toBe(5) // only the 5 unrelated "far" groups, picked up despite being off-course
    expect(res.body.average.label).toBe('Global average · all courses')
  })
})

describe('GET /api/school/rate-compare — group entity', () => {
  beforeEach(() => {
    DB.groups = [{ id: 'grp-wales', name: 'Wales', path: 'wales.', parent_id: null }]
    DB.schools = [{ id: 'sch-1', school_name: 'Coláiste Éinde', group_id: 'grp-wales' }]
    scope = { learnerId: 'l1', role: 'govt_admin', classIds: DB.classes.map((c) => c.id), learnerIds: [], studentsByClass: {}, schoolIds: ['sch-1'], groupId: 'grp-wales' }
  })

  it('rejects a group entity_id outside the caller scope (not the caller\'s own group)', async () => {
    const req = makeReq({ course_code: 'gle_for_eng', entity_level: 'group', entity_id: 'someone-elses-group', compare_to: 'global' })
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(403)
  })

  it('honestly degrades compare_to=region when the group has no parent group yet', async () => {
    const req = makeReq({ course_code: 'gle_for_eng', entity_level: 'group', entity_id: 'grp-wales', compare_to: 'region' })
    const res = makeRes()
    await handler(req, res)
    expect(res.body.insufficientData).toBe(true)
    expect(res.body.reason).toMatch(/no broader region/i)
  })

  it('computes group-vs-region from sibling groups sharing the same parent', async () => {
    DB.groups = [
      { id: 'grp-uk', name: 'UK', path: 'uk.', parent_id: null },
      { id: 'grp-wales', name: 'Wales', path: 'uk.wales.', parent_id: 'grp-uk' },
      ...Array.from({ length: 5 }, (_, i) => ({ id: `grp-sib-${i}`, name: `Sibling ${i}`, path: `uk.sib${i}.`, parent_id: 'grp-uk' })),
    ]
    DB.schools = [
      { id: 'sch-1', school_name: 'Coláiste Éinde', group_id: 'grp-wales' },
      ...Array.from({ length: 5 }, (_, i) => ({ id: `sib-sch-${i}`, school_name: `Sib School ${i}`, group_id: `grp-sib-${i}` })),
    ]
    DB.classes.push(
      ...Array.from({ length: 5 }, (_, i) => ({ id: `sib-class-${i}`, class_name: 'X', course_code: 'gle_for_eng', school_id: `sib-sch-${i}`, is_active: true })),
    )
    const now = new Date().toISOString()
    rpcRows = [
      sessRow('class-1', 30, now), ...Array.from({ length: 6 }, (_, i) => sessRow(`cohort-${i}`, 15, now)),
      ...Array.from({ length: 5 }, (_, i) => sessRow(`sib-class-${i}`, 10 + i, now)),
    ]
    const req = makeReq({ course_code: 'gle_for_eng', entity_level: 'group', entity_id: 'grp-wales', compare_to: 'region' })
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(200)
    expect(res.body.insufficientData).toBe(false)
    expect(res.body.cohortSize).toBe(5)
    expect(res.body.entity.label).toBe('Wales')
    expect(res.body.average.label).toBe('Regional average')
    expect(JSON.stringify(res.body)).not.toContain('grp-sib-0')
  })

  it('excludes ancestor/descendant groups from a group-vs-global cohort (no self-overlap)', async () => {
    DB.groups = [
      { id: 'grp-uk', name: 'UK', path: 'uk.', parent_id: null }, // ancestor of the entity — must be excluded
      { id: 'grp-wales', name: 'Wales', path: 'uk.wales.', parent_id: 'grp-uk' },
      { id: 'grp-cardiff', name: 'Cardiff', path: 'uk.wales.cardiff.', parent_id: 'grp-wales' }, // descendant — must be excluded
      ...Array.from({ length: 5 }, (_, i) => ({ id: `grp-far-${i}`, name: `Far ${i}`, path: `far${i}.`, parent_id: null })),
    ]
    DB.schools = [
      { id: 'sch-1', school_name: 'Coláiste Éinde', group_id: 'grp-wales' },
      ...Array.from({ length: 5 }, (_, i) => ({ id: `far-sch-${i}`, school_name: `Far School ${i}`, group_id: `grp-far-${i}` })),
    ]
    DB.classes.push(
      ...Array.from({ length: 5 }, (_, i) => ({ id: `far-class-${i}`, class_name: 'X', course_code: 'gle_for_eng', school_id: `far-sch-${i}`, is_active: true })),
    )
    const now = new Date().toISOString()
    rpcRows = [
      sessRow('class-1', 30, now), ...Array.from({ length: 6 }, (_, i) => sessRow(`cohort-${i}`, 15, now)),
      ...Array.from({ length: 5 }, (_, i) => sessRow(`far-class-${i}`, 10 + i, now)),
    ]
    const req = makeReq({ course_code: 'gle_for_eng', entity_level: 'group', entity_id: 'grp-wales', compare_to: 'global' })
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(200)
    expect(res.body.cohortSize).toBe(5) // only the 5 unrelated "far" groups — never grp-uk or grp-cardiff
  })
})
