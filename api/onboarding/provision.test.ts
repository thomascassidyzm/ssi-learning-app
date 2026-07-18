/**
 * Tests for POST /api/onboarding/provision — operator-capture guard
 * (2026-07-18 incident): provisioning mutates the signed-in account
 * (educational_role, teachers/schools rows, a first class), so an ssi_admin
 * walking the signup doors to test them must be refused before any write.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

process.env.SUPABASE_URL = 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'

vi.mock('../_utils/auth', () => ({
  verifyAuthToken: vi.fn(async () => ({ valid: true, userId: 'auth-op-1' })),
}))
vi.mock('../_utils/schoolJoinCodes', () => ({
  ensureJoinCodesRegistered: vi.fn(async () => undefined),
}))
vi.mock('../_utils/schoolPlatformTrial', () => ({
  provisionSchoolPlatformTrial: vi.fn(async () => ({ trial: null, burned: false, denied: false })),
  provisionTutorPlatformTrial: vi.fn(async () => ({ trial: null, burned: false })),
}))
vi.mock('../_utils/classLearnerEntity', () => ({
  ensureClassLearnerEntity: vi.fn(async () => ({ learnerId: 'shadow-1' })),
}))
vi.mock('../_utils/emailValidation', () => ({
  isDisposableEmailDomain: vi.fn(() => false),
}))

let writes: Record<string, any[]> = {}
let responders: Record<string, (calls: any[][]) => any> = {}

function recordWrite(table: string, op: string, payload: unknown) {
  writes[table] = writes[table] || []
  writes[table].push({ op, payload })
}

function makeChainable(table: string) {
  const calls: any[][] = []
  const builder: any = {
    select: (cols: string) => { calls.push(['select', cols]); return builder },
    insert: (obj: unknown) => { calls.push(['insert', obj]); recordWrite(table, 'insert', obj); return builder },
    update: (obj: unknown) => { calls.push(['update', obj]); recordWrite(table, 'update', obj); return builder },
    eq: (col: string, val: unknown) => { calls.push(['eq', col, val]); return builder },
    is: (col: string, val: unknown) => { calls.push(['is', col, val]); return builder },
    resolve: () => {
      const respond = responders[table]
      if (respond) {
        const r = respond(calls)
        if (r !== undefined) return r
      }
      return { data: null, error: null }
    },
    maybeSingle() { return Promise.resolve(this.resolve()) },
    single() { return Promise.resolve(this.resolve()) },
    then(onF: any, onR: any) { return Promise.resolve(this.resolve()).then(onF, onR) },
  }
  return builder
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => makeChainable(table),
    auth: {
      admin: {
        getUserById: () => Promise.resolve({ data: { user: { email: 'op@example.com' } } }),
      },
    },
  }),
}))

function makeRes() {
  const res: any = {}
  res.status = vi.fn((code: number) => { res._status = code; return res })
  res.json = vi.fn((body: unknown) => { res._json = body; return res })
  return res as VercelResponse & { _status?: number; _json?: any }
}

function makeReq(overrides: Partial<VercelRequest>): VercelRequest {
  return { method: 'POST', query: {}, headers: {}, body: {}, ...overrides } as VercelRequest
}

describe('POST /api/onboarding/provision — operator-capture guard', () => {
  let handler: typeof import('./provision').default

  beforeEach(async () => {
    vi.resetModules()
    writes = {}
    responders = {}
    responders.courses = (calls) =>
      calls.some((c) => c[0] === 'select')
        ? { data: { course_code: 'eng_for_fra', pricing_tier: 'premium', new_app_status: 'live' }, error: null }
        : undefined
    handler = (await import('./provision')).default
  })

  it('refuses to provision a tutor identity onto an ssi_admin account — zero writes', async () => {
    responders.learners = (calls) =>
      calls.some((c) => c[0] === 'select')
        ? { data: { id: 'learner-op', display_name: 'Tom', educational_role: null, platform_role: 'ssi_admin' }, error: null }
        : undefined

    const res = makeRes()
    await handler(makeReq({ body: { track: 'tutor', course_code: 'eng_for_fra' } }), res)

    expect(res._status).toBe(409)
    expect(res._json.error).toMatch(/platform admin/)
    expect(writes.learners).toBeUndefined()
    expect(writes.teachers).toBeUndefined()
    expect(writes.classes).toBeUndefined()
    expect(writes.user_entitlements).toBeUndefined()
  })

  it('refuses the school track for an ssi_admin too', async () => {
    responders.learners = (calls) =>
      calls.some((c) => c[0] === 'select')
        ? { data: { id: 'learner-op', display_name: 'Tom', educational_role: null, platform_role: 'ssi_admin' }, error: null }
        : undefined

    const res = makeRes()
    await handler(makeReq({ body: { track: 'school', course_code: 'eng_for_fra' } }), res)

    expect(res._status).toBe(409)
    expect(res._json.error).toMatch(/platform admin/)
    expect(writes.schools).toBeUndefined()
    expect(writes.learners).toBeUndefined()
  })

  it('a normal account still provisions (guard is operator-only)', async () => {
    responders.learners = (calls) =>
      calls.some((c) => c[0] === 'select')
        ? { data: { id: 'learner-n', display_name: 'Aran', educational_role: null, platform_role: null }, error: null }
        : undefined
    // No existing teacher row; teacher insert returns an id; class insert returns an id.
    responders.teachers = (calls) => {
      const isInsert = calls.some((c) => c[0] === 'insert')
      if (isInsert) return { data: { id: 'teacher-n' }, error: null }
      return { data: null, error: null }
    }
    responders.classes = (calls) =>
      calls.some((c) => c[0] === 'insert') ? { data: { id: 'class-n' }, error: null } : undefined

    const res = makeRes()
    await handler(makeReq({ body: { track: 'tutor', course_code: 'eng_for_fra' } }), res)

    expect(res._status).toBe(200)
    expect(res._json.role).toBe('teacher')
    expect(writes.teachers).toHaveLength(1)
  })
})
