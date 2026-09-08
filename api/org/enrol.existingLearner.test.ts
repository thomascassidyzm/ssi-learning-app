/**
 * AN EXISTING LEARNER — the third failure the old system actually had, and the
 * one still costing people money today.
 * ==========================================================================
 *
 * Kai, 2026-09-08: the old system "sometimes did not recognise existing
 * learners during enrolment, and consequently never cancelled their old
 * subscriptions" — and some of those subscriptions are STILL running, a year
 * on, charging people who believe they are on a free Canolfan year.
 *
 * That is two failures wearing one coat, and they need separating:
 *
 *   1. NOT RECOGNISING the person. Every test in the first block below is a
 *      way somebody can arrive already known to us.
 *   2. NEVER TELLING THEM. Recognition is worthless if the answer goes
 *      nowhere, so the second block asserts the flag actually comes back.
 *
 * And a third thing this build does NOT do, which the tests state rather than
 * hide: it does not cancel anything. Recognition raises a flag and fills a
 * queue for a human. The historical harm was silence, not the absence of an
 * automatic cancel.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-key'

let authUserId: string
let authEmail: string | undefined
vi.mock('../_utils/auth', () => ({
  verifyAuthToken: vi.fn(async () => ({ valid: true, userId: authUserId })),
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
const UNIQUE: Record<string, string[]> = {
  org_enrolments: ['group_id', 'learner_id'],
  learners: ['user_id'],
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
    order() { return b },
    insert(payload: Row) {
      const store = (DB[table] ??= [])
      const key = UNIQUE[table]
      if (key && store.some((e) => key.every((k) => e[k] === payload[k]))) {
        const err = { code: '23505', message: 'duplicate key' }
        return { select: () => ({ maybeSingle: async () => ({ data: null, error: err }) }), then: (f: any) => Promise.resolve({ data: null, error: err }).then(f) }
      }
      const written = { id: payload.id ?? `${table}-${store.length + 1}`, ...payload }
      store.push(written)
      return {
        select: () => ({ maybeSingle: async () => ({ data: written, error: null }), single: async () => ({ data: written, error: null }) }),
        then: (f: any) => Promise.resolve({ data: [written], error: null }).then(f),
      }
    },
    update(patch: Row) {
      const target = rows
      return {
        eq(c: string, v: unknown) {
          for (const r of target.filter((x) => x[c] === v)) Object.assign(r, patch)
          return Promise.resolve({ data: null, error: null })
        },
      }
    },
    async maybeSingle() { return { data: rows[0] ?? null, error: null } },
    then(f: any, r: any) { return Promise.resolve({ data: rows, error: null }).then(f, r) },
  }
  return b
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (t: string) => makeChainable(t),
    rpc: async () => ({ data: null, error: null }),
    auth: { admin: { getUserById: async () => ({ data: { user: { email: authEmail, user_metadata: {} } } }) } },
  }),
}))

function makeRes(): VercelResponse & { statusCode?: number; body?: any } {
  const res: any = {}
  res.status = vi.fn((c: number) => { res.statusCode = c; return res })
  res.json = vi.fn((b: any) => { res.body = b; return res })
  res.setHeader = vi.fn()
  return res
}
const post = (body: Record<string, unknown>): VercelRequest =>
  ({ method: 'POST', query: {}, body, headers: { authorization: 'Bearer t' } }) as any

const enrol = async () => {
  const res = makeRes()
  await handler(post({ code: 'CYM-001', dataSharingConsent: true }), res)
  return res
}

let handler: typeof import('./enrol').default

beforeEach(async () => {
  vi.resetModules()
  handler = (await import('./enrol')).default
  authUserId = 'auth-sian'
  authEmail = 'sian@example.com'
  DB = {
    invite_codes: [{ id: 'inv-1', code: 'CYM-001', code_normalized: 'CYM001', code_type: 'student', grants_group_id: 'g-canolfan', is_active: true, expires_at: null, max_uses: null, use_count: 0 }],
    org_enrolment_policies: [{
      group_id: 'g-canolfan', org_display_name: 'Dysgu Cymraeg', consent_statement: 'I agree.',
      consent_version: 'v1', ask_age_band: true, age_band_label: 'I am aged 16 to 24', free_months: 12,
      granted_courses: ['cym_n_for_eng', 'cym_s_for_eng'], is_active: true, link_expires_at: null,
    }],
    groups: [{ id: 'g-canolfan', path: 'dysgu-cymraeg', parent_id: null }],
    learners: [],
    org_enrolments: [],
    subscriptions: [],
    user_tags: [],
    user_entitlements: [],
    schools: [],
  }
})

describe('recognising somebody we already have', () => {
  it('FAILURE MODE: a three-year learner treated as brand new', async () => {
    DB.learners.push({ id: 'L-sian', user_id: 'auth-sian', display_name: 'Sian', verified_emails: ['sian@example.com'] })
    const res = await enrol()
    expect(res.body.success).toBe(true)
    // No second account. Their learner id is the one they already had, so
    // every minute, belt and enrolment they own still points at them.
    expect(DB.learners).toHaveLength(1)
    expect(DB.org_enrolments[0].learner_id).toBe('L-sian')
  })

  it('FAILURE MODE: their live subscription invisible because it sits on a SIBLING account', async () => {
    // The live database really has this shape: 24 addresses across more than
    // one learner row. A lookup keyed only on "this session's learner" walks
    // straight past the subscription — which is precisely how a year-old
    // subscription keeps running while its owner believes they are on a free
    // year.
    DB.learners.push(
      { id: 'L-sian', user_id: 'auth-sian', display_name: 'Sian', verified_emails: ['sian@example.com'] },
      { id: 'L-sian-old', user_id: 'auth-sian-old', display_name: 'Sian (old)', verified_emails: ['sian@example.com'] },
    )
    DB.subscriptions.push({ id: 'sub-old', learner_id: 'L-sian-old', status: 'active', plan_name: 'Yearly', current_period_end: '2027-06-01T00:00:00Z', cancel_at_period_end: false })

    const res = await enrol()
    expect(res.body.cancellationNeeded).toBe(true)
    expect(res.body.priorPlanName).toBe('Yearly')
    // And we tell them WHERE it is, because "cancel your subscription" is
    // useless advice while they are looking at an account that has none.
    expect(res.body.payingOnAnotherAccount).toBe(true)
    expect(DB.org_enrolments[0].cancellation_state).toBe('needed')
    expect(DB.org_enrolments[0].prior_subscription_id).toBe('sub-old')
  })

  it('prefers the LIVE subscription over a dead one on this account', async () => {
    DB.learners.push(
      { id: 'L-sian', user_id: 'auth-sian', display_name: 'Sian', verified_emails: ['sian@example.com'] },
      { id: 'L-sian-old', user_id: 'auth-sian-old', display_name: 'Sian (old)', verified_emails: ['sian@example.com'] },
    )
    DB.subscriptions.push(
      { id: 'sub-dead', learner_id: 'L-sian', status: 'cancelled', plan_name: 'Monthly', current_period_end: '2025-01-01T00:00:00Z', cancel_at_period_end: true },
      { id: 'sub-live', learner_id: 'L-sian-old', status: 'active', plan_name: 'Yearly', current_period_end: '2027-06-01T00:00:00Z', cancel_at_period_end: false },
    )
    const res = await enrol()
    expect(res.body.cancellationNeeded).toBe(true)
    expect(DB.org_enrolments[0].prior_subscription_id).toBe('sub-live')
  })

  it('matches the email however it was cased or spaced', async () => {
    DB.learners.push({ id: 'L-sian', user_id: 'auth-sian', display_name: 'Sian', verified_emails: ['sian@example.com'] })
    DB.learners.push({ id: 'L-sib', user_id: 'auth-sib', display_name: 'Sian b', verified_emails: ['sian@example.com'] })
    DB.subscriptions.push({ id: 'sub-1', learner_id: 'L-sib', status: 'active', plan_name: 'Yearly', current_period_end: '2027-06-01T00:00:00Z', cancel_at_period_end: false })
    authEmail = '  Sian@Example.COM  '
    const res = await enrol()
    expect(res.body.cancellationNeeded).toBe(true)
    expect(res.body.recognisedBy).toBe('email')
  })

  it('the clean break applies to a veteran too — recognised, but counted from today', async () => {
    DB.learners.push({ id: 'L-sian', user_id: 'auth-sian', display_name: 'Sian', verified_emails: ['sian@example.com'] })
    const res = await enrol()
    expect(res.body.success).toBe(true)
    // Their identity is old; this cohort's reporting is not.
    expect(DB.org_enrolments[0].reporting_from).toBe(new Date().toISOString().slice(0, 10))
  })

  it('says plainly when it could only check the account in front of it', async () => {
    // A link-auth or placeholder account with no readable address: we did not
    // check by email, and the answer says so rather than implying we did.
    DB.learners.push({ id: 'L-x', user_id: 'auth-sian', display_name: 'X', verified_emails: [] })
    authEmail = undefined
    const res = await enrol()
    expect(res.body.success).toBe(true)
    expect(res.body.recognisedBy).toBe('account')
  })
})

describe('recognition has to reach the learner', () => {
  it('FAILURE MODE: recognised, recorded, and never mentioned to anybody', async () => {
    DB.learners.push({ id: 'L-sian', user_id: 'auth-sian', display_name: 'Sian', verified_emails: ['sian@example.com'] })
    DB.subscriptions.push({ id: 'sub-1', learner_id: 'L-sian', status: 'active', plan_name: 'Yearly', current_period_end: '2027-06-01T00:00:00Z', cancel_at_period_end: false })
    const res = await enrol()

    // Three places, and it must be in all of them: the answer the page renders
    // from, the row a human's queue is built from, and the plan name so the
    // learner can find the thing we are asking them to cancel.
    expect(res.body.cancellationNeeded).toBe(true)
    expect(res.body.priorPlanName).toBe('Yearly')
    expect(DB.org_enrolments[0].cancellation_state).toBe('needed')

    // And STILL nothing was cancelled. The historical harm was silence, not
    // the absence of an automatic cancel.
    expect(DB.subscriptions[0].status).toBe('active')
    expect(DB.subscriptions[0].cancel_at_period_end).toBe(false)
  })

  it('somebody with no subscription anywhere is not nagged about one', async () => {
    DB.learners.push({ id: 'L-sian', user_id: 'auth-sian', display_name: 'Sian', verified_emails: ['sian@example.com'] })
    const res = await enrol()
    expect(res.body.cancellationNeeded).toBe(false)
    expect(res.body.payingOnAnotherAccount).toBe(false)
    expect(DB.org_enrolments[0].cancellation_state).toBe('not_needed')
  })
})
