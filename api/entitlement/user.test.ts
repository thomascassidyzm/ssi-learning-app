/**
 * Tests for GET /api/entitlement/user — covers the class-coverage entitlement
 * cascade (docs/schools/group-commercial-model.md, "Student entitlement —
 * FINAL model") alongside the pre-existing user_entitlements / group-cascade
 * behaviour. resolveClassCourseCoverage itself is unit-tested in
 * api/_utils/classCoverage.test.ts; this file proves it's actually wired into
 * the endpoint's response.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-key'

const FUTURE = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
const PAST = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

let authResult: any = { valid: true, userId: 'auth-uid-1' }
vi.mock('../_utils/auth', () => ({
  verifyAuthToken: vi.fn(async () => authResult),
}))

let DB: {
  learners: any[]
  user_entitlements: any[]
  user_tags: any[]
  classes: any[]
  schools: any[]
}
let cascadeCourses: string[] = []

function makeChainable(table: string) {
  let rows: any[] = [...((DB as any)[table] ?? [])]
  const builder: any = {
    select: () => builder,
    eq: (col: string, val: unknown) => { rows = rows.filter((r) => r[col] === val); return builder },
    is: (col: string, val: unknown) => {
      rows = rows.filter((r) => (val === null ? r[col] == null : r[col] === val))
      return builder
    },
    in: (col: string, vals: unknown[]) => { rows = rows.filter((r) => vals.includes(r[col])); return builder },
    single: () => Promise.resolve(rows[0] ? { data: rows[0], error: null } : { data: null, error: { code: 'PGRST116' } }),
    maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
    then: (resolve: any) => Promise.resolve({ data: rows, error: null }).then(resolve),
  }
  return builder
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => makeChainable(table),
    rpc: () => Promise.resolve({ data: cascadeCourses, error: null }),
  }),
}))

function makeReq(): VercelRequest {
  return { method: 'GET', headers: { authorization: 'Bearer tok' } } as any
}

function makeRes(): VercelResponse & { statusCode?: number; body?: any } {
  const res: any = {}
  res.status = vi.fn((code: number) => { res.statusCode = code; return res })
  res.json = vi.fn((body: any) => { res.body = body; return res })
  return res
}

let handler: typeof import('./user').default

beforeEach(async () => {
  vi.resetModules()
  authResult = { valid: true, userId: 'auth-uid-1' }
  cascadeCourses = []
  DB = {
    learners: [{ id: 'learner-1', user_id: 'auth-uid-1' }],
    user_entitlements: [],
    user_tags: [],
    classes: [],
    schools: [],
  }
  handler = (await import('./user')).default
})

describe('GET /api/entitlement/user — class-coverage cascade', () => {
  it('grants the class course while the school is on a live trial', async () => {
    DB.user_tags = [{ user_id: 'auth-uid-1', tag_type: 'class', role_in_context: 'student', removed_at: null, tag_value: 'CLASS:c1' }]
    DB.classes = [{ id: 'c1', school_id: 's1', course_code: 'fra_for_eng' }]
    DB.schools = [{ id: 's1', platform_status: 'trial', platform_expires_at: FUTURE }]

    const res = makeRes()
    await handler(makeReq(), res)

    expect(res.statusCode).toBe(200)
    const classCoverage = res.body.entitlements.find((e: any) => e.id === 'class-coverage')
    expect(classCoverage).toBeDefined()
    expect(classCoverage.granted_courses).toEqual(['fra_for_eng'])
  })

  it('withholds the class-coverage entitlement once the school trial has expired', async () => {
    DB.user_tags = [{ user_id: 'auth-uid-1', tag_type: 'class', role_in_context: 'student', removed_at: null, tag_value: 'CLASS:c1' }]
    DB.classes = [{ id: 'c1', school_id: 's1', course_code: 'fra_for_eng' }]
    DB.schools = [{ id: 's1', platform_status: 'trial', platform_expires_at: PAST }]

    const res = makeRes()
    await handler(makeReq(), res)

    expect(res.statusCode).toBe(200)
    expect(res.body.entitlements.find((e: any) => e.id === 'class-coverage')).toBeUndefined()
  })

  it('adds no class-coverage entitlement for a student with no class affiliation, but still returns other entitlements', async () => {
    DB.user_entitlements = [
      { id: 'ue-1', learner_id: 'learner-1', access_type: 'full', granted_courses: null, expires_at: null, redeemed_at: '2026-01-01', entitlement_code_id: 'code-1' },
    ]

    const res = makeRes()
    await handler(makeReq(), res)

    expect(res.statusCode).toBe(200)
    expect(res.body.entitlements.find((e: any) => e.id === 'class-coverage')).toBeUndefined()
    expect(res.body.entitlements.find((e: any) => e.id === 'ue-1')).toBeDefined()
  })

  it('coexists with the group/school entitlement_grants cascade', async () => {
    cascadeCourses = ['deu_for_eng']
    DB.user_tags = [{ user_id: 'auth-uid-1', tag_type: 'class', role_in_context: 'student', removed_at: null, tag_value: 'CLASS:c1' }]
    DB.classes = [{ id: 'c1', school_id: 's1', course_code: 'fra_for_eng' }]
    DB.schools = [{ id: 's1', platform_status: 'active', platform_expires_at: null }]

    const res = makeRes()
    await handler(makeReq(), res)

    expect(res.statusCode).toBe(200)
    expect(res.body.entitlements.find((e: any) => e.id === 'cascade')?.granted_courses).toEqual(['deu_for_eng'])
    expect(res.body.entitlements.find((e: any) => e.id === 'class-coverage')?.granted_courses).toEqual(['fra_for_eng'])
  })
})
