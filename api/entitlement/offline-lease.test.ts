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
