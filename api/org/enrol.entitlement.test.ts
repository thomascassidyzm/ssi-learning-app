/**
 * POST /api/org/enrol — the free period is a promise, so the row must exist.
 *
 * The failure these tests are named for: an enrolment that reports success,
 * with a date on it, while the learner holds no entitlement at all — and a
 * retry that cheerfully says "already enrolled" and heals nothing. The
 * downstream reader (api/_utils/orgFreeAccess.ts) intersects policy with
 * entitlement, so an empty intersection is invisible and simply sells the
 * learner a course their funder had already paid for.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-key'

let authUserId: string | null
vi.mock('../_utils/auth', () => ({
  verifyAuthToken: vi.fn(async () =>
    authUserId ? { valid: true, userId: authUserId } : { valid: false, error: 'Unauthorized' },
  ),
}))
vi.mock('../_utils/codeAttemptThrottle', () => ({
  PER_IP_LIMIT: 10,
  REDEEM_PER_IP_LIMIT: 120,
  getClientIp: () => '1.2.3.4',
  hashIp: (ip: string) => `h:${ip}`,
  isIpOverLimit: async () => false,
  logAttempt: async () => {},
}))

type Row = Record<string, any>
let DB: Record<string, Row[]>
/** Set to make the entitlement write fail the way a real outage would. */
let failEntitlementInsert: boolean

const UNIQUE: Record<string, string[]> = {
  org_enrolments: ['group_id', 'learner_id'],
  learners: ['user_id'],
  // The primary key, which api/_utils/orgEntitlementGrant.ts computes rather
  // than letting the database invent one — that is what makes the free-period
  // grant idempotent under a genuine burst.
  user_entitlements: ['id'],
  user_tags: ['user_id', 'tag_type', 'tag_value'],
}

function makeChainable(table: string) {
  let rows: Row[] = [...(DB[table] ?? [])]
  const b: any = {
    select() { return b },
    eq(c: string, v: unknown) { rows = rows.filter((r) => r[c] === v); return b },
    is(c: string, v: unknown) { rows = rows.filter((r) => (r[c] ?? null) === v); return b },
    in(c: string, v: unknown[]) { rows = rows.filter((r) => v.includes(r[c])); return b },
    contains(c: string, v: unknown[]) {
      rows = rows.filter((r) => Array.isArray(r[c]) && (v as any[]).every((x) => r[c].includes(x)))
      return b
    },
    gt(c: string, v: any) { rows = rows.filter((r) => r[c] > v); return b },
    limit(n: number) { rows = rows.slice(0, n); return b },
    insert(payload: Row | Row[]) {
      if (table === 'user_entitlements' && failEntitlementInsert) {
        const err = { code: '42501', message: 'permission denied for table user_entitlements' }
        return {
          select: () => ({ maybeSingle: async () => ({ data: null, error: err }), single: async () => ({ data: null, error: err }) }),
          then: (f: any) => Promise.resolve({ data: null, error: err }).then(f),
        }
      }
      const list = Array.isArray(payload) ? payload : [payload]
      const key = UNIQUE[table]
      const store = (DB[table] ??= [])
      for (const r of list) {
        if (key && store.some((e) => key.every((k) => e[k] === r[k]))) {
          const err = { code: '23505', message: `duplicate key on ${table}` }
          return {
            select: () => ({ maybeSingle: async () => ({ data: null, error: err }), single: async () => ({ data: null, error: err }) }),
            then: (f: any) => Promise.resolve({ data: null, error: err }).then(f),
          }
        }
      }
      const written = list.map((r) => ({ id: r.id ?? `${table}-${store.length + 1}`, ...r }))
      store.push(...written)
      return {
        select: () => ({ maybeSingle: async () => ({ data: written[0], error: null }), single: async () => ({ data: written[0], error: null }) }),
        then: (f: any) => Promise.resolve({ data: written, error: null }).then(f),
      }
    },
    update(patch: Row) {
      const target = rows
      return {
        eq(c: string, v: unknown) {
          for (const r of target.filter((x) => x[c] === v)) Object.assign(r, patch)
          return Promise.resolve({ data: null, error: null })
        },
        then: (f: any) => { for (const r of target) Object.assign(r, patch); return Promise.resolve({ data: null, error: null }).then(f) },
      }
    },
    async maybeSingle() { return { data: rows[0] ?? null, error: null } },
    async single() { return { data: rows[0] ?? null, error: null } },
    then(f: any, r: any) { return Promise.resolve({ data: rows, error: null }).then(f, r) },
  }
  return b
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (t: string) => makeChainable(t),
    rpc: async () => ({ data: null, error: null }),
    auth: { admin: { getUserById: async () => ({ data: { user: { email: 'sian@example.com', user_metadata: {} } } }) } },
  }),
}))

function makeRes(): VercelResponse & { statusCode?: number; body?: any } {
  const res: any = {}
  res.status = vi.fn((c: number) => { res.statusCode = c; return res })
  res.json = vi.fn((b: any) => { res.body = b; return res })
  res.send = vi.fn((b: any) => { res.body = b; return res })
  res.setHeader = vi.fn()
  return res
}
const post = (body: Record<string, unknown>): VercelRequest =>
  ({ method: 'POST', query: {}, body, headers: { authorization: 'Bearer t' } }) as any

let handler: typeof import('./enrol').default

beforeEach(async () => {
  vi.resetModules()
  handler = (await import('./enrol')).default
  authUserId = 'auth-1'
  failEntitlementInsert = false
  DB = {
    invite_codes: [{ id: 'inv-1', code: 'CYM-001', code_normalized: 'CYM001', code_type: 'student', grants_group_id: 'g-canolfan', is_active: true, expires_at: null, max_uses: null, use_count: 0 }],
    org_enrolment_policies: [{
      group_id: 'g-canolfan', org_display_name: 'Dysgu Cymraeg', consent_statement: 'I agree.',
      consent_version: 'v1', ask_age_band: false, age_band_label: '', free_months: 12,
      granted_courses: ['cym_s_for_eng', 'cym_n_for_eng'], is_active: true, link_expires_at: null,
    }],
    groups: [{ id: 'g-canolfan', path: 'dysgu-cymraeg', parent_id: null }],
    learners: [{ id: 'L1', user_id: 'auth-1', display_name: 'Sian', verified_emails: ['sian@example.com'] }],
    org_enrolments: [],
    subscriptions: [],
    user_tags: [],
    user_entitlements: [],
  }
})

describe('the entitlement write cannot half-succeed', () => {
  it('FAILURE MODE: told their free year runs to a date, holding no entitlement', async () => {
    failEntitlementInsert = true
    const res = makeRes()
    await handler(post({ code: 'CYM-001', dataSharingConsent: true }), res)

    // Honest error rather than a cheerful lie.
    expect(res.statusCode).toBe(500)
    expect(res.body?.success).toBeUndefined()
    expect(DB.user_entitlements).toHaveLength(0)
    // The enrolment row STAYS: it carries the consent record and the reporting
    // date, and deleting it would be the worse loss. The retry heals it.
    expect(DB.org_enrolments).toHaveLength(1)
  })

  it('the happy path still writes exactly one grant, for the policy courses', async () => {
    const res = makeRes()
    await handler(post({ code: 'CYM-001', dataSharingConsent: true }), res)
    expect(res.body.success).toBe(true)
    expect(DB.user_entitlements).toHaveLength(1)
    expect(DB.user_entitlements[0].granted_courses).toEqual(['cym_s_for_eng', 'cym_n_for_eng'])
    expect(DB.user_entitlements[0].expires_at).toBe(res.body.freeAccessUntil)
  })
})

describe('the retry heals instead of returning early', () => {
  it('FAILURE MODE: coming back after a failure and being told "already enrolled" with nothing', async () => {
    failEntitlementInsert = true
    await handler(post({ code: 'CYM-001', dataSharingConsent: true }), makeRes())
    expect(DB.user_entitlements).toHaveLength(0)

    // The locked-out learner taps the link again. The outage is over.
    failEntitlementInsert = false
    const res = makeRes()
    await handler(post({ code: 'CYM-001', dataSharingConsent: true }), res)

    expect(res.body.alreadyEnrolled).toBe(true)
    expect(DB.user_entitlements).toHaveLength(1)
    // Their year runs from THEIR enrolment date, not from the retry.
    expect(DB.user_entitlements[0].expires_at).toBe(DB.org_enrolments[0].free_access_until)
  })

  it('five refreshes leave exactly one grant', async () => {
    await handler(post({ code: 'CYM-001', dataSharingConsent: true }), makeRes())
    for (let i = 0; i < 4; i++) await handler(post({ code: 'CYM-001', dataSharingConsent: true }), makeRes())
    expect(DB.org_enrolments).toHaveLength(1)
    expect(DB.user_entitlements).toHaveLength(1)
  })

  it('an entitlement already covering the courses is left alone, not duplicated', async () => {
    DB.org_enrolments.push({
      id: 'e-old', group_id: 'g-canolfan', learner_id: 'L1', enrolled_at: '2026-05-01T00:00:00Z',
      reporting_from: '2026-05-01', free_access_until: '2027-05-01T00:00:00Z', cancellation_state: 'not_needed',
    })
    DB.user_entitlements.push({
      id: 'ent-existing', learner_id: 'L1', access_type: 'full', granted_courses: null, expires_at: '2027-05-01T00:00:00Z',
    })
    const res = makeRes()
    await handler(post({ code: 'CYM-001', dataSharingConsent: true }), res)
    expect(res.body.alreadyEnrolled).toBe(true)
    expect(DB.user_entitlements).toHaveLength(1)
  })

  it('FAILURE MODE: ten simultaneous taps healing into ten grants', async () => {
    // The read-then-write window is real: all ten read "no entitlement" before
    // any of them writes. The computed primary key is what stops nine of them.
    DB.org_enrolments.push({
      id: 'e-old', group_id: 'g-canolfan', learner_id: 'L1', enrolled_at: '2026-05-01T00:00:00Z',
      reporting_from: '2026-05-01', free_access_until: '2027-05-01T00:00:00Z', cancellation_state: 'not_needed',
    })
    await Promise.all(
      Array.from({ length: 10 }, () => handler(post({ code: 'CYM-001', dataSharingConsent: true }), makeRes())),
    )
    expect(DB.user_entitlements).toHaveLength(1)
  })
})
