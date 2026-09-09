/**
 * POST /api/org/enrol — the failure modes of a cohort sign-up, named.
 *
 * Kai: "I have some memories of how things have exploded in the past with the
 * old system, so would appreciate running some specific tests on it once it's
 * operational." He has not yet said what exploded, so each test below is
 * named for a specific way this shape of flow goes wrong rather than for the
 * code path it happens to exercise.
 *
 * The fake below enforces the REAL unique constraint — UNIQUE (group_id,
 * learner_id) on org_enrolments — because the endpoint's idempotency is
 * delegated to it. A fake that let a second row in would let a bug through.
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
  getClientIp: () => '1.2.3.4',
  hashIp: (ip: string) => `h:${ip}`,
  isIpOverLimit: async () => false,
  logAttempt: async () => {},
}))

type Row = Record<string, any>
let DB: Record<string, Row[]>

/** Enforced exactly where the live schema enforces it. */
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
    // `verified_emails` is a text[]; `.contains(col, [value])` is the array
    // containment the sibling-account lookup uses.
    contains(c: string, v: unknown[]) {
      rows = rows.filter((r) => Array.isArray(r[c]) && (v as any[]).every((x) => r[c].includes(x)))
      return b
    },
    gt(c: string, v: any) { rows = rows.filter((r) => r[c] > v); return b },
    gte(c: string, v: any) { rows = rows.filter((r) => r[c] >= v); return b },
    lte(c: string, v: any) { rows = rows.filter((r) => r[c] <= v); return b },
    order(c: string, o?: { ascending?: boolean }) {
      rows = [...rows].sort((x, y) => (x[c] < y[c] ? -1 : x[c] > y[c] ? 1 : 0))
      if (o && o.ascending === false) rows.reverse()
      return b
    },
    range(from: number, to: number) { rows = rows.slice(from, to + 1); return b },
    limit(n: number) { rows = rows.slice(0, n); return b },
    insert(payload: Row | Row[]) {
      const list = Array.isArray(payload) ? payload : [payload]
      const key = UNIQUE[table]
      const store = (DB[table] ??= [])
      for (const r of list) {
        if (key && store.some((e) => key.every((k) => e[k] === r[k]))) {
          const err = { code: '23505', message: `duplicate key value violates unique constraint on ${table}` }
          return { select: () => ({ maybeSingle: async () => ({ data: null, error: err }), single: async () => ({ data: null, error: err }) }), then: (f: any) => Promise.resolve({ data: null, error: err }).then(f) }
        }
      }
      const written = list.map((r) => ({ id: r.id ?? `${table}-${store.length + 1}`, ...r }))
      store.push(...written)
      return {
        select: () => ({
          maybeSingle: async () => ({ data: written[0], error: null }),
          single: async () => ({ data: written[0], error: null }),
        }),
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
        then: (f: any) => {
          for (const r of target) Object.assign(r, patch)
          return Promise.resolve({ data: null, error: null }).then(f)
        },
      }
    },
    async maybeSingle() { return { data: rows[0] ?? null, error: null } },
    async single() { return { data: rows[0] ?? null, error: null } },
    then(f: any, r: any) { return Promise.resolve({ data: rows, error: null }).then(f, r) },
  }
  return b
}

/** Records every rpc the endpoint fires, so the counter's atomicity is visible. */
let RPCS: Array<{ name: string; args: any }>
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (t: string) => makeChainable(t),
    rpc: async (name: string, args: any) => {
      RPCS.push({ name, args })
      // claim_invite_code_use increments atomically in the live DB; model that.
      if (name === 'claim_invite_code_use') {
        const row = (DB.invite_codes ?? []).find((c) => c.id === args.p_id)
        if (row) row.use_count = (row.use_count ?? 0) + 1
        return { data: args.p_id, error: null }
      }
      return { data: null, error: null }
    },
    auth: { admin: { getUserById: async () => ({ data: { user: { email: 'new@example.com', user_metadata: {} } } }) } },
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
  RPCS = []
  DB = {
    invite_codes: [{ id: 'inv-1', code: 'CYM-001', code_normalized: 'CYM001', code_type: 'student', grants_group_id: 'g-canolfan', is_active: true, expires_at: null, max_uses: null, use_count: 0 }],
    org_enrolment_policies: [{
      group_id: 'g-canolfan', org_display_name: 'Dysgu Cymraeg', consent_statement: 'I agree my anonymous usage data is shared with the National Centre for Learning Welsh.',
      consent_version: 'v1', ask_age_band: true, age_band_label: 'I am aged 16 to 24', free_months: 12,
      granted_courses: ['cym_s_for_eng', 'cym_n_for_eng'], is_active: true,
    }],
    groups: [{ id: 'g-canolfan', path: 'dysgu-cymraeg', parent_id: null }],
    learners: [{ id: 'L1', user_id: 'auth-1', display_name: 'Sian' }],
    org_enrolments: [],
    subscriptions: [],
    user_tags: [],
    user_entitlements: [],
    schools: [],
  }
})

describe('the consent tick is the gate', () => {
  it('FAILURE MODE: free access handed out without the data-sharing agreement', async () => {
    const res = makeRes()
    await handler(post({ code: 'CYM-001', dataSharingConsent: false, ageBand16to24: true }), res)
    expect(res.body.success).toBe(false)
    expect(res.body.needsConsent).toBe(true)
    // Nothing written at all — not an enrolment, not an entitlement, not a tag.
    expect(DB.org_enrolments).toHaveLength(0)
    expect(DB.user_entitlements).toHaveLength(0)
    expect(DB.user_tags).toHaveLength(0)
  })

  it('a missing tick is refused the same way as an explicit false', async () => {
    const res = makeRes()
    await handler(post({ code: 'CYM-001' }), res)
    expect(res.body.success).toBe(false)
    expect(DB.org_enrolments).toHaveLength(0)
  })
})

describe('duplicate enrolment', () => {
  it('FAILURE MODE: the same person enrolling twice creating two rows', async () => {
    const first = makeRes()
    await handler(post({ code: 'CYM-001', dataSharingConsent: true, ageBand16to24: true }), first)
    expect(first.body.success).toBe(true)
    expect(first.body.alreadyEnrolled).toBe(false)

    const second = makeRes()
    await handler(post({ code: 'CYM-001', dataSharingConsent: true, ageBand16to24: true }), second)
    expect(second.body.success).toBe(true)
    expect(second.body.alreadyEnrolled).toBe(true)
    // One row, and the same free-year end date both times — a replay must not
    // silently restart somebody's year.
    expect(DB.org_enrolments).toHaveLength(1)
    expect(second.body.freeAccessUntil).toBe(first.body.freeAccessUntil)
  })

  it('FAILURE MODE: an existing account holder re-enrolling and being treated as new', async () => {
    // Same learner, already has years of history and a live account.
    DB.org_enrolments.push({
      id: 'e-old', group_id: 'g-canolfan', learner_id: 'L1', enrolled_at: '2026-05-01T00:00:00Z',
      reporting_from: '2026-05-01', free_access_until: '2027-05-01T00:00:00Z',
      age_band_16_24: false, cancellation_state: 'not_needed',
    })
    const res = makeRes()
    await handler(post({ code: 'CYM-001', dataSharingConsent: true, ageBand16to24: true }), res)
    expect(res.body.alreadyEnrolled).toBe(true)
    expect(res.body.freeAccessUntil).toBe('2027-05-01T00:00:00Z')
    expect(DB.org_enrolments).toHaveLength(1)
  })

  it('FAILURE MODE: one learner in an old AND a new cohort of the same org at once', async () => {
    // Two cohorts, one org — they share the first segment of the slug path.
    DB.groups.push({ id: 'g-cohort-2', path: 'dysgu-cymraeg/cohort-2', parent_id: 'g-canolfan' })
    DB.invite_codes.push({ id: 'inv-2', code: 'CYM-002', code_normalized: 'CYM002', code_type: 'student', grants_group_id: 'g-cohort-2', is_active: true, expires_at: null, max_uses: null, use_count: 0 })
    DB.org_enrolment_policies.push({ ...DB.org_enrolment_policies[0], group_id: 'g-cohort-2' })

    await handler(post({ code: 'CYM-001', dataSharingConsent: true }), makeRes())
    const res = makeRes()
    await handler(post({ code: 'CYM-002', dataSharingConsent: true }), res)

    expect(res.body.alreadyEnrolled).toBe(true)
    // They stay in the cohort they first joined; no second enrolment is
    // created, so no export can count them twice.
    expect(DB.org_enrolments).toHaveLength(1)
    expect(DB.org_enrolments[0].group_id).toBe('g-canolfan')
  })
})

describe('the account-creation race', () => {
  it('FAILURE MODE: enrolling before the learners row exists', async () => {
    // Brand-new sign-up: the OTP is verified but useAuth.ts has not yet
    // inserted the learners row. The enrolment must still land.
    DB.learners = []
    authUserId = 'auth-brand-new'
    const res = makeRes()
    await handler(post({ code: 'CYM-001', dataSharingConsent: true, ageBand16to24: true }), res)
    expect(res.body.success).toBe(true)
    expect(DB.learners).toHaveLength(1)
    expect(DB.org_enrolments).toHaveLength(1)
  })

  it('FAILURE MODE: back/refresh mid-flow creating a second learner or a second enrolment', async () => {
    DB.learners = []
    authUserId = 'auth-racer'
    // Two submits from the same person, sequentially — the shape a
    // double-tapped button or a back-then-resubmit produces.
    await handler(post({ code: 'CYM-001', dataSharingConsent: true }), makeRes())
    const second = makeRes()
    await handler(post({ code: 'CYM-001', dataSharingConsent: true }), second)
    expect(DB.learners.filter((l) => l.user_id === 'auth-racer')).toHaveLength(1)
    expect(DB.org_enrolments).toHaveLength(1)
    expect(second.body.success).toBe(true)
  })
})

describe('the paying learner', () => {
  it('is TOLD to cancel and nothing is cancelled for them', async () => {
    DB.subscriptions.push({ id: 'sub-1', learner_id: 'L1', status: 'active', plan_name: 'Yearly', current_period_end: '2027-01-01T00:00:00Z', cancel_at_period_end: false })
    const res = makeRes()
    await handler(post({ code: 'CYM-001', dataSharingConsent: true }), res)
    expect(res.body.cancellationNeeded).toBe(true)
    expect(res.body.priorPlanName).toBe('Yearly')
    expect(DB.org_enrolments[0].cancellation_state).toBe('needed')
    // THE LINE. The subscription row is untouched: same status, and no
    // cancel_at_period_end flipped behind their back.
    expect(DB.subscriptions[0].status).toBe('active')
    expect(DB.subscriptions[0].cancel_at_period_end).toBe(false)
  })

  it('a subscription already set to lapse does not raise the notice', async () => {
    DB.subscriptions.push({ id: 'sub-2', learner_id: 'L1', status: 'active', plan_name: 'Monthly', current_period_end: '2026-10-01T00:00:00Z', cancel_at_period_end: true })
    const res = makeRes()
    await handler(post({ code: 'CYM-001', dataSharingConsent: true }), res)
    expect(res.body.cancellationNeeded).toBe(false)
    expect(DB.org_enrolments[0].cancellation_state).toBe('not_needed')
  })
})

describe('what the enrolment records', () => {
  it('stamps the age tick, and stamps nothing when it is not ticked', async () => {
    await handler(post({ code: 'CYM-001', dataSharingConsent: true, ageBand16to24: true }), makeRes())
    expect(DB.org_enrolments[0].age_band_16_24).toBe(true)
    expect(DB.org_enrolments[0].age_ticked_at).toBeTruthy()

    DB.org_enrolments = []
    DB.learners.push({ id: 'L2', user_id: 'auth-2', display_name: 'Rhys' })
    authUserId = 'auth-2'
    await handler(post({ code: 'CYM-001', dataSharingConsent: true, ageBand16to24: false }), makeRes())
    expect(DB.org_enrolments[0].age_band_16_24).toBe(false)
    expect(DB.org_enrolments[0].age_ticked_at).toBeNull()
  })

  it('FAILURE MODE: the age tick becoming a date of birth by the back door', async () => {
    await handler(post({ code: 'CYM-001', dataSharingConsent: true, ageBand16to24: true, dateOfBirth: '2004-03-01' }), makeRes())
    const row = DB.org_enrolments[0]
    // The endpoint reads exactly two ticks off the body and nothing else. A
    // client that posts a birth date gets it dropped on the floor.
    expect(JSON.stringify(row)).not.toContain('2004-03-01')
    expect(Object.keys(row)).not.toContain('dateOfBirth')
    expect(Object.keys(row)).not.toContain('date_of_birth')
  })

  it('sets the reporting baseline to today, not to any earlier history', async () => {
    await handler(post({ code: 'CYM-001', dataSharingConsent: true }), makeRes())
    expect(DB.org_enrolments[0].reporting_from).toBe(new Date().toISOString().slice(0, 10))
  })

  it('grants the free period as a per-learner entitlement with a real end date', async () => {
    await handler(post({ code: 'CYM-001', dataSharingConsent: true }), makeRes())
    expect(DB.user_entitlements).toHaveLength(1)
    expect(DB.user_entitlements[0].granted_courses).toEqual(['cym_s_for_eng', 'cym_n_for_eng'])
    expect(new Date(DB.user_entitlements[0].expires_at).getTime()).toBeGreaterThan(Date.now())
  })

  it('writes group membership by the same tag rule as every other join path', async () => {
    await handler(post({ code: 'CYM-001', dataSharingConsent: true }), makeRes())
    expect(DB.user_tags).toContainEqual(expect.objectContaining({ tag_type: 'group', tag_value: 'GROUP:g-canolfan', role_in_context: 'student' }))
  })
})

describe('bad doors', () => {
  it('refuses an unauthenticated caller before reading anything', async () => {
    authUserId = null
    const res = makeRes()
    await handler(post({ code: 'CYM-001', dataSharingConsent: true }), res)
    expect(res.statusCode).toBe(401)
    expect(DB.org_enrolments).toHaveLength(0)
  })

  it('refuses an expired link, and a code with no enrolment policy behind it', async () => {
    DB.invite_codes[0].expires_at = '2020-01-01T00:00:00Z'
    const expired = makeRes()
    await handler(post({ code: 'CYM-001', dataSharingConsent: true }), expired)
    expect(expired.body.success).toBe(false)

    DB.invite_codes[0].expires_at = null
    DB.org_enrolment_policies = []
    const nopolicy = makeRes()
    await handler(post({ code: 'CYM-001', dataSharingConsent: true }), nopolicy)
    expect(nopolicy.body.success).toBe(false)
    expect(DB.org_enrolments).toHaveLength(0)
  })

  it('accepts the code however it was typed', async () => {
    const res = makeRes()
    await handler(post({ code: ' cym 001 ', dataSharingConsent: true }), res)
    expect(res.body.success).toBe(true)
  })
})

describe('freeAccessUntil', () => {
  it('lands on the same day one year on, and never overflows a short month', async () => {
    const { freeAccessUntil } = await import('./enrol')
    expect(freeAccessUntil(new Date('2026-09-15T10:00:00Z'), 12)).toBe('2027-09-15T10:00:00.000Z')
    // 29 Feb + 12 months is 28 Feb, not 1 March.
    expect(freeAccessUntil(new Date('2028-02-29T10:00:00Z'), 12).slice(0, 10)).toBe('2029-02-28')
    expect(freeAccessUntil(new Date('2026-01-31T10:00:00Z'), 1).slice(0, 10)).toBe('2026-02-28')
  })
})
