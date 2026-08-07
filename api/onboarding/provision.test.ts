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

  it('refuses the org track for an ssi_admin too', async () => {
    responders.learners = (calls) =>
      calls.some((c) => c[0] === 'select')
        ? { data: { id: 'learner-op', display_name: 'Tom', educational_role: null, platform_role: 'ssi_admin' }, error: null }
        : undefined

    const res = makeRes()
    await handler(makeReq({ body: { track: 'org', org_name: 'Cardiff Council' } }), res)

    expect(res._status).toBe(409)
    expect(res._json.error).toMatch(/platform admin/)
    expect(writes.groups).toBeUndefined()
    expect(writes.govt_admins).toBeUndefined()
  })
})

describe('POST /api/onboarding/provision — school track founding-admin membership', () => {
  // Regression for the Chepstow class (2026-08-06): this path creates a school
  // with schools.admin_user_id = the founding admin, but never wrote her the
  // user_tags SCHOOL: row every staff-keyed number is derived from — so she was
  // invisible in her own school (76 min of practice, a headline reading 7m, and
  // no row of her own in the Teachers list).
  let handler: typeof import('./provision').default

  beforeEach(async () => {
    vi.resetModules()
    writes = {}
    responders = {}
    responders.courses = (calls) =>
      calls.some((c) => c[0] === 'select')
        ? { data: { course_code: 'cym_for_eng', pricing_tier: 'free', new_app_status: 'live' }, error: null }
        : undefined
    responders.learners = (calls) =>
      calls.some((c) => c[0] === 'select')
        ? { data: { id: 'learner-a', display_name: 'Angharad', educational_role: null, platform_role: null }, error: null }
        : undefined
    handler = (await import('./provision')).default
  })

  function schoolTagWrites() {
    return (writes.user_tags || []).filter(
      (w: any) => w.op === 'insert' && w.payload?.tag_type === 'school',
    )
  }

  it('tags the founding admin as admin of the school it just created', async () => {
    responders.schools = (calls) =>
      calls.some((c) => c[0] === 'insert') ? { data: { id: 'school-new' }, error: null } : { data: null, error: null }

    const res = makeRes()
    await handler(makeReq({ body: { track: 'school', course_code: 'cym_for_eng' } }), res)

    expect(res._status).toBe(200)
    expect(schoolTagWrites()).toHaveLength(1)
    expect(schoolTagWrites()[0].payload).toMatchObject({
      user_id: 'auth-op-1',
      tag_type: 'school',
      tag_value: 'SCHOOL:school-new',
      role_in_context: 'admin',
    })
  })

  it('re-provisioning an EXISTING school still attempts exactly one tag write (23505 makes it a no-op)', async () => {
    // The partial unique index user_tags_active_natural_key turns the second
    // insert into a 23505 the writer swallows — so a re-provision heals a
    // pre-fix school without ever duplicating the row.
    responders.schools = () => ({ data: { id: 'school-existing', trial_course_code: null, platform_status: null }, error: null })

    const res = makeRes()
    await handler(makeReq({ body: { track: 'school', course_code: 'cym_for_eng' } }), res)

    expect(res._status).toBe(200)
    expect(schoolTagWrites()).toHaveLength(1)
    expect(schoolTagWrites()[0].payload.tag_value).toBe('SCHOOL:school-existing')
  })

  it('a failed tag write never fails the signup', async () => {
    responders.schools = (calls) =>
      calls.some((c) => c[0] === 'insert') ? { data: { id: 'school-new' }, error: null } : { data: null, error: null }
    responders.user_tags = () => ({ data: null, error: { code: '42501', message: 'permission denied' } })

    const res = makeRes()
    await handler(makeReq({ body: { track: 'school', course_code: 'cym_for_eng' } }), res)

    expect(res._status).toBe(200)
  })
})

describe('POST /api/onboarding/provision — org track', () => {
  let handler: typeof import('./provision').default

  beforeEach(async () => {
    vi.resetModules()
    writes = {}
    responders = {}
    responders.learners = (calls) =>
      calls.some((c) => c[0] === 'select')
        ? { data: { id: 'learner-org', display_name: 'Aran', educational_role: null, platform_role: null }, error: null }
        : undefined
    handler = (await import('./provision')).default
  })

  it('rejects a missing org_name', async () => {
    const res = makeRes()
    await handler(makeReq({ body: { track: 'org' } }), res)
    expect(res._status).toBe(400)
  })

  it('creates a root org + leader, sets educational_role, and redirects to /org/:id', async () => {
    responders.govt_admins = () => ({ data: null, error: null }) // leaderGroupId: no existing leadership
    responders.groups = (calls) => {
      if (calls.some((c) => c[0] === 'insert')) {
        return {
          data: { id: 'group-new', name: 'Cardiff Council', platform_status: 'trial', platform_expires_at: '2026-09-01T00:00:00.000Z' },
          error: null,
        }
      }
      return undefined
    }

    const res = makeRes()
    await handler(makeReq({ body: { track: 'org', org_name: 'Cardiff Council' } }), res)

    expect(res._status).toBe(200)
    expect(res._json.role).toBe('govt_admin')
    expect(res._json.redirect).toBe('/org/group-new')
    expect(res._json.existing).toBe(false)
    expect(res._json.platform_trial).toMatchObject({ track: 'org', kind: 'trial', days: 30 })
    expect(writes.groups[0].payload).toMatchObject({ name: 'Cardiff Council', type: 'organisation' })
    expect(writes.govt_admins[0].payload).toMatchObject({ user_id: 'auth-op-1', group_id: 'group-new' })
    expect(writes.learners.some((w) => w.op === 'update' && w.payload.educational_role === 'govt_admin')).toBe(true)
  })

  it('a caller who already leads a group is handed back their existing org, not re-provisioned', async () => {
    responders.govt_admins = () => ({ data: { group_id: 'group-existing' }, error: null })
    responders.groups = () => ({
      data: { platform_status: 'trial', platform_expires_at: '2026-09-01T00:00:00.000Z', seats: null },
      error: null,
    })

    const res = makeRes()
    await handler(makeReq({ body: { track: 'org', org_name: 'Cardiff Council' } }), res)

    expect(res._status).toBe(200)
    expect(res._json.existing).toBe(true)
    expect(res._json.redirect).toBe('/org/group-existing')
    expect(writes.groups).toBeUndefined()
  })
})
