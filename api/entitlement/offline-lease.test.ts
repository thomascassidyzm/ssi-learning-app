/**
 * Characterization tests for /api/entitlement/offline-lease.
 *
 * Pins CURRENT behavior of the stateful 30-day offline-lease authority:
 *   - guard shapes (405 method, 401 auth, no_learner).
 *   - active-subscription (blanket) → every reported course renews to now+30d.
 *   - time-boxed course entitlement → lease clamped to the entitlement expiry
 *     (expiry boundary, fixed clock).
 *   - non-payer, no prior lease → single non-renewing free 30-day taste.
 *   - non-payer, prior taste → honoured, NOT slid (trial-used memory).
 *   - revocation kill-switch → locked, untouched.
 *   - stateless fallback when the offline_leases table read fails.
 *
 * And, since job #794, the DERIVED lanes — the whole point of routing this
 * endpoint through resolveActiveEntitlements: school-staff coverage, class
 * coverage, and the cap that stops a lease outliving the school's own window.
 *
 * Clock is pinned with vi.setSystemTime so leaseExpiresAt is exact.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

process.env.SUPABASE_URL = 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'

const NOW = new Date('2026-07-17T12:00:00.000Z').getTime()
const DAY = 24 * 60 * 60 * 1000
const LEASE_MS = 30 * DAY

let authResult: any = { valid: true, userId: 'auth-uid-1' }
vi.mock('../_utils/auth', () => ({
  verifyAuthToken: vi.fn(async () => authResult),
}))

let writes: Record<string, any[]> = {}
let responders: Record<string, (calls: any[][]) => any> = {}
let cascadeCourses: string[] = []

function recordWrite(table: string, op: string, payload: unknown) {
  writes[table] = writes[table] || []
  writes[table].push({ op, payload })
}

function makeChainable(table: string) {
  const calls: any[][] = []
  const builder: any = {
    select: (c: string) => { calls.push(['select', c]); return builder },
    insert: (o: unknown) => { calls.push(['insert', o]); recordWrite(table, 'insert', o); return builder },
    update: (o: unknown) => { calls.push(['update', o]); recordWrite(table, 'update', o); return builder },
    upsert: (o: unknown, opts: unknown) => { calls.push(['upsert', o, opts]); recordWrite(table, 'upsert', o); return builder },
    eq: (col: string, val: unknown) => { calls.push(['eq', col, val]); return builder },
    in: (col: string, vals: unknown) => { calls.push(['in', col, vals]); return builder },
    is: (col: string, val: unknown) => { calls.push(['is', col, val]); return builder },
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
    rpc: (name: string) => {
      if (name === 'get_cascade_courses') return Promise.resolve({ data: cascadeCourses, error: null })
      return Promise.resolve({ data: null, error: null })
    },
  }),
}))

function makeReq(courses: string[]): VercelRequest {
  return { method: 'POST', query: {}, headers: { authorization: 'Bearer tok' }, body: { courses } } as VercelRequest
}

function makeRes() {
  const res: any = {}
  res.status = vi.fn((code: number) => { res._status = code; return res })
  res.json = vi.fn((body: unknown) => { res._json = body; return res })
  res.end = vi.fn(() => res)
  res.setHeader = vi.fn(() => res)
  return res as VercelResponse & { _status?: number; _json?: any }
}

describe('/api/entitlement/offline-lease', () => {
  let handler: typeof import('./offline-lease').default

  beforeEach(async () => {
    vi.resetModules()
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    writes = {}
    responders = {}
    cascadeCourses = []
    authResult = { valid: true, userId: 'auth-uid-1' }
    handler = (await import('./offline-lease')).default
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('rejects an unsupported method', async () => {
    const res = makeRes()
    await handler({ method: 'DELETE', headers: {}, query: {} } as any, res)
    expect(res._status).toBe(405)
  })

  it('401s an unauthenticated caller (client fails open)', async () => {
    authResult = { valid: false, error: 'nope' }
    const res = makeRes()
    await handler(makeReq(['cym_for_eng']), res)
    expect(res._status).toBe(401)
  })

  it('returns no_learner when the auth user has no learner row', async () => {
    responders.learners = () => ({ data: null, error: null })
    const res = makeRes()
    await handler(makeReq(['cym_for_eng']), res)
    expect(res._status).toBe(200)
    expect(res._json).toMatchObject({ valid: false, blanket: false, stateful: false, reason: 'no_learner', courses: [] })
  })

  it('active subscription (blanket): each reported course renews to now+30d, non-trial', async () => {
    responders.learners = () => ({ data: { id: 'learner-1', platform_role: 'learner', educational_role: null }, error: null })
    responders.subscriptions = () => ({ data: { id: 'sub-1', status: 'active', current_period_end: null }, error: null })
    responders.user_entitlements = () => ({ data: [], error: null })
    responders.offline_leases = (calls) => {
      const isUpsert = calls.some((c) => c[0] === 'upsert')
      if (isUpsert) return { data: null, error: null }
      return { data: [], error: null } // no prior rows
    }
    const res = makeRes()
    await handler(makeReq(['cym_for_eng']), res)

    expect(res._status).toBe(200)
    expect(res._json.valid).toBe(true)
    expect(res._json.blanket).toBe(true)
    expect(res._json.stateful).toBe(true)
    expect(res._json.courses).toHaveLength(1)
    expect(res._json.courses[0]).toMatchObject({ courseCode: 'cym_for_eng', leaseExpiresAt: NOW + LEASE_MS, isTrial: false, revoked: false })
    // Renewal persisted.
    const up = writes.offline_leases.find((w) => w.op === 'upsert')!
    expect(up.payload[0]).toMatchObject({ course_code: 'cym_for_eng', is_trial: false, subscription_id: 'sub-1' })
  })

  it('time-boxed course entitlement: lease is CLAMPED to the entitlement expiry (boundary)', async () => {
    const clampExpiry = new Date(NOW + 10 * DAY).toISOString()
    responders.learners = () => ({ data: { id: 'learner-1', platform_role: 'learner', educational_role: null }, error: null })
    responders.subscriptions = () => ({ data: null, error: null }) // no sub
    responders.user_entitlements = () => ({ data: [{ access_type: 'courses', granted_courses: ['cym_for_eng'], expires_at: clampExpiry }], error: null })
    responders.offline_leases = (calls) => {
      const isUpsert = calls.some((c) => c[0] === 'upsert')
      if (isUpsert) return { data: null, error: null }
      return { data: [], error: null }
    }
    const res = makeRes()
    await handler(makeReq(['cym_for_eng']), res)

    expect(res._status).toBe(200)
    expect(res._json.valid).toBe(true)
    expect(res._json.blanket).toBe(false)
    // min(now+30d, now+10d) = now+10d
    expect(res._json.courses[0]).toMatchObject({ courseCode: 'cym_for_eng', leaseExpiresAt: NOW + 10 * DAY, entitlementExpiresAt: NOW + 10 * DAY, isTrial: false })
  })

  it('non-payer, no prior lease: mints a single non-renewing free 30-day taste', async () => {
    responders.learners = () => ({ data: { id: 'learner-1', platform_role: 'learner', educational_role: null }, error: null })
    responders.subscriptions = () => ({ data: null, error: null })
    responders.user_entitlements = () => ({ data: [], error: null })
    responders.offline_leases = (calls) => {
      const isUpsert = calls.some((c) => c[0] === 'upsert')
      if (isUpsert) return { data: null, error: null }
      return { data: [], error: null }
    }
    const res = makeRes()
    await handler(makeReq(['cym_for_eng']), res)

    expect(res._status).toBe(200)
    expect(res._json.valid).toBe(false)
    expect(res._json.reason).toBe('no_entitlement')
    expect(res._json.courses[0]).toMatchObject({ courseCode: 'cym_for_eng', leaseExpiresAt: NOW + LEASE_MS, isTrial: true, revoked: false })
    const up = writes.offline_leases.find((w) => w.op === 'upsert')!
    expect(up.payload[0]).toMatchObject({ course_code: 'cym_for_eng', is_trial: true })
  })

  it('non-payer, prior taste already recorded: honoured and NOT slid (trial-used memory)', async () => {
    const priorExpiry = NOW + 5 * DAY
    responders.learners = () => ({ data: { id: 'learner-1', platform_role: 'learner', educational_role: null }, error: null })
    responders.subscriptions = () => ({ data: null, error: null })
    responders.user_entitlements = () => ({ data: [], error: null })
    responders.offline_leases = (calls) => {
      const isUpsert = calls.some((c) => c[0] === 'upsert')
      if (isUpsert) return { data: null, error: null }
      return { data: [{ course_code: 'cym_for_eng', expires_at: new Date(priorExpiry).toISOString(), is_trial: true, revoked_at: null }], error: null }
    }
    const res = makeRes()
    await handler(makeReq(['cym_for_eng']), res)

    expect(res._status).toBe(200)
    // Lease still points at the ORIGINAL taste expiry — no fresh 30d minted.
    expect(res._json.courses[0]).toMatchObject({ courseCode: 'cym_for_eng', leaseExpiresAt: priorExpiry, isTrial: true })
    const up = writes.offline_leases.find((w) => w.op === 'upsert')!
    expect(up.payload[0].expires_at).toBe(new Date(priorExpiry).toISOString())
  })

  it('revocation kill-switch: a revoked prior lease is locked and left untouched', async () => {
    const priorExpiry = NOW + 20 * DAY
    responders.learners = () => ({ data: { id: 'learner-1', platform_role: 'learner', educational_role: null }, error: null })
    responders.subscriptions = () => ({ data: { id: 'sub-1', status: 'active', current_period_end: null }, error: null }) // even a payer stays locked
    responders.user_entitlements = () => ({ data: [], error: null })
    responders.offline_leases = (calls) => {
      const isUpsert = calls.some((c) => c[0] === 'upsert')
      if (isUpsert) return { data: null, error: null }
      return { data: [{ course_code: 'cym_for_eng', expires_at: new Date(priorExpiry).toISOString(), is_trial: false, revoked_at: new Date(NOW - DAY).toISOString() }], error: null }
    }
    const res = makeRes()
    await handler(makeReq(['cym_for_eng']), res)

    expect(res._status).toBe(200)
    expect(res._json.courses[0]).toMatchObject({ courseCode: 'cym_for_eng', revoked: true, leaseExpiresAt: priorExpiry })
    // Revoked rows are not re-upserted.
    expect(writes.offline_leases).toBeUndefined()
  })

  // ── Derived coverage (job #794) ────────────────────────────────────────
  //
  // The defect: this endpoint read stored `user_entitlements` rows and the
  // cascade RPC only, so somebody whose access is DERIVED could PLAY a course
  // and not DOWNLOAD it. It now asks resolveActiveEntitlements — the same
  // question play asks. These four tests fail on the pre-fix handler.

  /** Wire the user_tags/classes/schools rows a derived lane reads. */
  function withSchoolStaff(opts: { expiresAt?: string | null; trialCourse?: string | null } = {}) {
    responders.user_tags = (calls) => {
      const tagType = calls.find((c) => c[0] === 'eq' && c[1] === 'tag_type')?.[2]
      if (tagType === 'school') return { data: [{ tag_value: 'SCHOOL:school-1' }], error: null }
      return { data: [], error: null }
    }
    responders.schools = (calls) => {
      // staffSchoolIds' admin_user_id pointer lookup vs the row read.
      const byAdmin = calls.some((c) => c[0] === 'eq' && c[1] === 'admin_user_id')
      if (byAdmin) return { data: [], error: null }
      return {
        data: [{
          id: 'school-1',
          platform_status: 'trial',
          platform_expires_at: opts.expiresAt ?? new Date(NOW + 200 * DAY).toISOString(),
          trial_course_code: opts.trialCourse ?? 'cym_for_eng',
        }],
        error: null,
      }
    }
  }

  function withClassCoverage(expiresAt?: string) {
    responders.user_tags = (calls) => {
      const tagType = calls.find((c) => c[0] === 'eq' && c[1] === 'tag_type')?.[2]
      if (tagType === 'class') return { data: [{ tag_value: 'CLASS:class-1' }], error: null }
      return { data: [], error: null }
    }
    responders.classes = () => ({ data: [{ id: 'class-1', school_id: 'school-1', course_code: 'cym_for_eng' }], error: null })
    responders.schools = (calls) => {
      const byAdmin = calls.some((c) => c[0] === 'eq' && c[1] === 'admin_user_id')
      if (byAdmin) return { data: [], error: null }
      return {
        data: [{
          id: 'school-1',
          platform_status: 'trial',
          platform_expires_at: expiresAt ?? new Date(NOW + 200 * DAY).toISOString(),
          trial_course_code: null,
        }],
        error: null,
      }
    }
  }

  function plainNonPayer() {
    responders.learners = () => ({ data: { id: 'learner-1', platform_role: 'learner', educational_role: null }, error: null })
    responders.subscriptions = () => ({ data: null, error: null })
    responders.user_entitlements = () => ({ data: [], error: null })
    responders.offline_leases = (calls) => {
      const isUpsert = calls.some((c) => c[0] === 'upsert')
      if (isUpsert) return { data: null, error: null }
      return { data: [], error: null }
    }
  }

  it('school-STAFF coverage: a teacher with no row of her own gets a real lease for her school\'s course', async () => {
    plainNonPayer()
    withSchoolStaff()
    const res = makeRes()
    await handler(makeReq(['cym_for_eng']), res)

    expect(res._status).toBe(200)
    expect(res._json.valid).toBe(true)
    expect(res._json.blanket).toBe(false)
    // A real renewing lease, NOT the free one-shot taste a non-payer would get.
    expect(res._json.courses[0]).toMatchObject({ courseCode: 'cym_for_eng', isTrial: false, revoked: false })
    expect(res._json.courses[0].leaseExpiresAt).toBe(NOW + LEASE_MS)
  })

  it('school-STAFF coverage grants EXACTLY the school\'s courses, nothing else', async () => {
    plainNonPayer()
    withSchoolStaff({ trialCourse: 'cym_for_eng' })
    const res = makeRes()
    await handler(makeReq(['cym_for_eng', 'spa_for_eng']), res)

    const spa = res._json.courses.find((c: any) => c.courseCode === 'spa_for_eng')
    // Uncovered course falls through to the non-payer taste, not an entitlement.
    expect(spa).toMatchObject({ isTrial: true })
  })

  it('CLASS coverage: a learner covered by their class gets a lease for its course', async () => {
    plainNonPayer()
    withClassCoverage()
    const res = makeRes()
    await handler(makeReq(['cym_for_eng']), res)

    expect(res._json.valid).toBe(true)
    expect(res._json.courses[0]).toMatchObject({ courseCode: 'cym_for_eng', isTrial: false })
    expect(res._json.courses[0].leaseExpiresAt).toBe(NOW + LEASE_MS)
  })

  it('no coverage at all: still no entitlement — only the one-shot taste', async () => {
    plainNonPayer()
    responders.user_tags = () => ({ data: [], error: null })
    responders.schools = () => ({ data: [], error: null })
    const res = makeRes()
    await handler(makeReq(['cym_for_eng']), res)

    expect(res._json.valid).toBe(false)
    expect(res._json.reason).toBe('no_entitlement')
    expect(res._json.courses[0]).toMatchObject({ isTrial: true })
  })

  it('THE WINDOW: a lease is capped at the school\'s own expiry, not now+30d', async () => {
    const schoolEnds = NOW + 5 * DAY
    plainNonPayer()
    withSchoolStaff({ expiresAt: new Date(schoolEnds).toISOString() })
    const res = makeRes()
    await handler(makeReq(['cym_for_eng']), res)

    expect(res._json.valid).toBe(true)
    // min(now+30d, school's own boundary) — the download locks when the trial does.
    expect(res._json.courses[0]).toMatchObject({
      courseCode: 'cym_for_eng',
      leaseExpiresAt: schoolEnds,
      entitlementExpiresAt: schoolEnds,
      isTrial: false,
    })
    const up = writes.offline_leases.find((w) => w.op === 'upsert')!
    expect(up.payload[0].expires_at).toBe(new Date(schoolEnds).toISOString())
  })

  it('THE WINDOW, class lane: capped at the covering school\'s expiry too', async () => {
    const schoolEnds = NOW + 3 * DAY
    plainNonPayer()
    withClassCoverage(new Date(schoolEnds).toISOString())
    const res = makeRes()
    await handler(makeReq(['cym_for_eng']), res)

    expect(res._json.courses[0]).toMatchObject({ leaseExpiresAt: schoolEnds, entitlementExpiresAt: schoolEnds, isTrial: false })
  })

  it('stateless fallback: offline_leases read failure returns entitled courses with null lease expiry', async () => {
    responders.learners = () => ({ data: { id: 'learner-1', platform_role: 'learner', educational_role: null }, error: null })
    responders.subscriptions = () => ({ data: { id: 'sub-1', status: 'active', current_period_end: null }, error: null })
    responders.user_entitlements = () => ({ data: [], error: null })
    responders.offline_leases = () => ({ data: null, error: { message: 'relation "offline_leases" does not exist' } })
    const res = makeRes()
    await handler(makeReq(['cym_for_eng']), res)

    expect(res._status).toBe(200)
    expect(res._json.stateful).toBe(false)
    expect(res._json.valid).toBe(true)
    expect(res._json.courses[0]).toMatchObject({ courseCode: 'cym_for_eng', leaseExpiresAt: null })
  })
})
