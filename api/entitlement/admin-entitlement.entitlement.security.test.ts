/**
 * Security audit 2026-08-11 — area 4 (admin-entitlement).
 * See docs/security-audit-2026-08-11/admin-entitlement.md
 *
 * Locks the entitlement surface's real controls (server-derived durations, the
 * privileged-code bound, own-token learner resolution) and characterizes
 * ADMIN-ENT-07 (unbounded courses[] on the offline-lease endpoint).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { boundPrivilegedCodeLimits } from '../_utils/codeGuard'

process.env.SUPABASE_URL = 'https://example.supabase.co'
process.env.VITE_SUPABASE_ANON_KEY = 'anon-key'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'

let authResult: { valid: boolean; userId?: string; error?: string } = { valid: true, userId: 'uid-1' }
let adminOk = true
vi.mock('../_utils/auth', () => ({
  verifyAuthToken: vi.fn(async () => authResult),
  getAuthUserId: vi.fn(async () => (authResult.valid ? authResult.userId ?? null : null)),
  verifyAdmin: vi.fn(async () =>
    adminOk && authResult.valid && authResult.userId
      ? { userId: authResult.userId }
      : { error: 'Requires SSi admin access', status: 403 },
  ),
}))

vi.mock('../_utils/familyAccess', () => ({
  resolveEffectiveSubscription: vi.fn(async () => ({ sub: null, viaFamily: false })),
}))

let writes: Record<string, Array<{ op: string; payload: any }>> = {}
let responders: Record<string, (calls: any[][]) => any> = {}

function makeChainable(table: string) {
  const calls: any[][] = []
  const builder: any = {
    select: (c?: string) => { calls.push(['select', c]); return builder },
    insert: (o: unknown) => { calls.push(['insert', o]); writes[table] = writes[table] || []; writes[table].push({ op: 'insert', payload: o }); return builder },
    update: (o: unknown) => { calls.push(['update', o]); writes[table] = writes[table] || []; writes[table].push({ op: 'update', payload: o }); return builder },
    upsert: (o: unknown, opts?: unknown) => { calls.push(['upsert', o, opts]); writes[table] = writes[table] || []; writes[table].push({ op: 'upsert', payload: o }); return builder },
    eq: (col: string, val: unknown) => { calls.push(['eq', col, val]); return builder },
    in: (col: string, val: unknown) => { calls.push(['in', col, val]); return builder },
    is: () => { calls.push(['is']); return builder },
    not: () => { calls.push(['not']); return builder },
    gte: () => { calls.push(['gte']); return builder },
    contains: () => { calls.push(['contains']); return builder },
    order: () => { calls.push(['order']); return builder },
    resolve: () => {
      const respond = responders[table]
      if (respond) { const r = respond(calls); if (r !== undefined) return r }
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
    rpc: () => Promise.resolve({ data: null, error: null }),
  }),
}))

function makeReq(body: unknown = {}, method = 'POST', query: Record<string, unknown> = {}): VercelRequest {
  return { method, headers: { authorization: 'Bearer t' }, body, query } as unknown as VercelRequest
}

function makeRes() {
  const res: any = {}
  res.setHeader = vi.fn()
  res.end = vi.fn(() => res)
  res.status = vi.fn((code: number) => { res._status = code; return res })
  res.json = vi.fn((body: unknown) => { res._json = body; return res })
  return res as VercelResponse & { _status?: number; _json?: any }
}

beforeEach(() => {
  vi.resetModules()
  writes = {}
  responders = {}
  authResult = { valid: true, userId: 'uid-1' }
  adminOk = true
})

describe('CONTROL — boundPrivilegedCodeLimits (api/_utils/codeGuard.ts)', () => {
  it('forces a use cap and an expiry when the caller supplies neither', () => {
    const b = boundPrivilegedCodeLimits(undefined, undefined)
    expect(b.max_uses).toBe(1)
    expect(new Date(b.expires_at).getTime()).toBeGreaterThan(Date.now())
  })

  it('caps an over-broad request rather than honouring it', () => {
    const farFuture = new Date(Date.now() + 3650 * 86400_000).toISOString()
    const b = boundPrivilegedCodeLimits(farFuture, 1_000_000)
    expect(b.max_uses).toBe(50)
    // Never more than 90 days out.
    expect(new Date(b.expires_at).getTime()).toBeLessThanOrEqual(Date.now() + 91 * 86400_000)
  })

  it('refuses an already-past expiry (the SSI-GOD-2026 never-expiring class)', () => {
    const b = boundPrivilegedCodeLimits('2020-01-01T00:00:00Z', 0)
    expect(new Date(b.expires_at).getTime()).toBeGreaterThan(Date.now())
    expect(b.max_uses).toBe(1)
  })
})

describe('POST /api/entitlement/create — privileged codes are bounded', () => {
  async function load() { return (await import('./create')).default }

  it('403s a non-admin', async () => {
    adminOk = false
    const res = makeRes()
    await (await load())(
      makeReq({ access_type: 'full', duration_type: 'lifetime', label: 'x' }),
      res,
    )
    expect(res._status).toBe(403)
    expect(writes.entitlement_codes).toBeUndefined()
  })

  it('CONTROL: clamps an unlimited-use, never-expiring ssi_admin-granting code', async () => {
    responders.player_events = () => ({ count: 0, error: null, data: null })
    responders.invite_codes = () => ({ data: null, error: null })
    responders.entitlement_codes = (calls) =>
      calls.some((c) => c[0] === 'insert')
        ? { data: { id: 'ec-1', code: 'ABC-123' }, error: null }
        : { data: null, error: null }

    const res = makeRes()
    await (await load())(
      makeReq({
        access_type: 'full',
        duration_type: 'lifetime',
        label: 'backdoor',
        grants_platform_role: 'ssi_admin',
        max_uses: 999999,
        expires_at: null,
      }),
      res,
    )

    expect(res._status).toBe(201)
    const insert = writes.entitlement_codes?.find((w) => w.op === 'insert')
    expect(insert).toBeDefined()
    expect(insert!.payload.max_uses).toBe(50)
    expect(new Date(insert!.payload.expires_at).getTime()).toBeGreaterThan(Date.now())
    expect(new Date(insert!.payload.expires_at).getTime()).toBeLessThanOrEqual(Date.now() + 91 * 86400_000)
  })
})

describe('POST /api/entitlement/grant — duration is server-derived', () => {
  async function load() { return (await import('./grant')).default }

  it('403s a non-admin', async () => {
    adminOk = false
    const res = makeRes()
    await (await load())(makeReq({ school_id: 's1', state: 'paid' }), res)
    expect(res._status).toBe(403)
    expect(writes.entitlement_grants).toBeUndefined()
  })

  it('CONTROL: ignores any client-supplied expiry/course list on a paid grant', async () => {
    responders.courses = () => ({ data: [{ course_code: 'cym_s_for_eng' }], error: null })
    responders.entitlement_grants = (calls) =>
      calls.some((c) => c[0] === 'insert')
        ? { data: { id: 'g-1' }, error: null }
        : { data: null, error: null }

    const res = makeRes()
    await (await load())(
      makeReq({
        school_id: 's1',
        state: 'paid',
        // Attempted smuggling — none of these are read by the handler.
        expires_at: '2099-01-01T00:00:00Z',
        granted_courses: ['everything'],
        duration_days: 100000,
      }),
      res,
    )

    expect(res._status).toBe(201)
    const insert = writes.entitlement_grants?.find((w) => w.op === 'insert')
    expect(insert!.payload.expires_at).toBeNull()
    expect(insert!.payload.granted_courses).toEqual(['cym_s_for_eng'])
  })

  it('CONTROL: refuses a trial on a course that is not live/beta', async () => {
    responders.courses = () => ({ data: null, error: null })
    const res = makeRes()
    await (await load())(
      makeReq({ school_id: 's1', state: 'trial', course_code: 'not_a_course' }),
      res,
    )
    expect(res._status).toBe(400)
    expect(writes.entitlement_grants).toBeUndefined()
  })
})

describe('GET /api/entitlement/user — target derived from the token', () => {
  async function load() { return (await import('./user')).default }

  it('401s an unauthenticated caller', async () => {
    authResult = { valid: false, error: 'Empty token' }
    const res = makeRes()
    await (await load())(makeReq({}, 'GET'), res)
    expect(res._status).toBe(401)
  })

  it('CONTROL: resolves the learner from the verified uid, never from the query string', async () => {
    let learnerCalls: any[][] = []
    responders.learners = (calls) => { learnerCalls = calls; return { data: { id: 'my-learner' }, error: null } }
    responders.user_entitlements = () => ({ data: [], error: null })

    const res = makeRes()
    await (await load())(makeReq({}, 'GET', { learner_id: 'someone-elses-learner' }), res)

    expect(res._status).toBe(200)
    expect(learnerCalls).toContainEqual(['eq', 'user_id', 'uid-1'])
  })
})

describe('POST /api/entitlement/offline-lease — ADMIN-ENT-07', () => {
  async function load() { return (await import('./offline-lease')).default }

  it('401s an unauthenticated caller', async () => {
    authResult = { valid: false, error: 'Empty token' }
    const res = makeRes()
    await (await load())(makeReq({ courses: ['a'] }), res)
    expect(res._status).toBe(401)
  })

  // SECURITY FINDING ADMIN-ENT-07: readCourses (offline-lease.ts:59-70) applies
  // no length cap and no check that a submitted string is a real course_code,
  // and every entry becomes a row in the upsert at :265. An authenticated
  // learner can force arbitrarily many offline_leases rows in one request.
  // SHOULD BE: cap the list, and intersect it against live/beta courses the way
  // api/entitlement/grant.ts:85-94 already does.
  it('ADMIN-ENT-07: upserts one row per submitted string, unbounded and unvalidated', async () => {
    responders.learners = () => ({ data: { id: 'l-1', platform_role: null, educational_role: null }, error: null })
    responders.user_entitlements = () => ({ data: [], error: null })
    responders.offline_leases = () => ({ data: [], error: null })

    const bogus = Array.from({ length: 500 }, (_, i) => `not-a-course-${i}`)
    const res = makeRes()
    await (await load())(makeReq({ courses: bogus }), res)

    expect(res._status).toBe(200)
    const upsert = writes.offline_leases?.find((w) => w.op === 'upsert')
    expect(upsert).toBeDefined()
    expect(Array.isArray(upsert!.payload)).toBe(true)
    expect(upsert!.payload).toHaveLength(500)
    // None of these course codes exist, yet each got a lease row.
    expect(upsert!.payload[0].course_code).toBe('not-a-course-0')
  })

  it.todo(
    'ADMIN-ENT-07: offline-lease should cap the courses[] length and reject codes that are not live/beta courses',
  )

  // The one free taste is recorded server-side and must NOT slide on re-request.
  it('CONTROL: a non-payer with an existing trial lease does not get a fresh window', async () => {
    const priorExpiry = new Date(Date.now() + 3 * 86400_000).toISOString()
    responders.learners = () => ({ data: { id: 'l-1', platform_role: null, educational_role: null }, error: null })
    responders.user_entitlements = () => ({ data: [], error: null })
    responders.offline_leases = (calls) =>
      calls.some((c) => c[0] === 'upsert')
        ? { data: null, error: null }
        : { data: [{ course_code: 'cym_s_for_eng', expires_at: priorExpiry, is_trial: true, revoked_at: null }], error: null }

    const res = makeRes()
    await (await load())(makeReq({ courses: ['cym_s_for_eng'] }), res)

    expect(res._status).toBe(200)
    const course = res._json.courses[0]
    expect(course.isTrial).toBe(true)
    // Honours the RECORDED expiry — no sliding +30d for a non-payer.
    expect(course.leaseExpiresAt).toBe(new Date(priorExpiry).getTime())
  })

  it('CONTROL: a server revocation locks the course mid-window', async () => {
    responders.learners = () => ({ data: { id: 'l-1', platform_role: null, educational_role: null }, error: null })
    responders.user_entitlements = () => ({ data: [], error: null })
    responders.offline_leases = () => ({
      data: [{ course_code: 'cym_s_for_eng', expires_at: new Date(Date.now() + 86400_000).toISOString(), is_trial: false, revoked_at: '2026-08-01T00:00:00Z' }],
      error: null,
    })

    const res = makeRes()
    await (await load())(makeReq({ courses: ['cym_s_for_eng'] }), res)
    expect(res._json.courses[0].revoked).toBe(true)
  })
})
