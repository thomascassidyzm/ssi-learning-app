/**
 * POST /api/admin/org-enrolment-setup — the switchover, run twice.
 *
 * The test that matters here is idempotency, because the person running this
 * on switchover morning will not be certain whether it already ran, and the
 * failure it prevents — a second sign-up link — is precisely the one Kai named
 * from the old system.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-key'

let isAdmin = true
vi.mock('../_utils/auth', () => ({
  verifyAdmin: vi.fn(async () => (isAdmin ? { userId: 'admin-1' } : { error: 'Forbidden', status: 403 })),
}))

type Row = Record<string, any>
let DB: Record<string, Row[]>
function makeChainable(table: string) {
  let rows: Row[] = [...(DB[table] ?? [])]
  const b: any = {
    select() { return b },
    eq(c: string, v: unknown) { rows = rows.filter((r) => r[c] === v); return b },
    insert(payload: Row) {
      const store = (DB[table] ??= [])
      const written = { id: payload.id ?? `${table}-${store.length + 1}`, ...payload }
      store.push(written)
      return { select: () => ({ single: async () => ({ data: written, error: null }), maybeSingle: async () => ({ data: written, error: null }) }) }
    },
    upsert(payload: Row, opts: { onConflict: string }) {
      const store = (DB[table] ??= [])
      const key = opts.onConflict
      const found = store.find((r) => r[key] === payload[key])
      if (found) Object.assign(found, payload)
      else store.push({ ...payload })
      return Promise.resolve({ data: null, error: null })
    },
    async maybeSingle() { return { data: rows[0] ?? null, error: null } },
    async single() { return { data: rows[0] ?? null, error: null } },
    then(f: any, r: any) { return Promise.resolve({ data: rows, error: null }).then(f, r) },
  }
  return b
}
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: (t: string) => makeChainable(t) }) }))

function makeRes(): VercelResponse & { statusCode?: number; body?: any } {
  const res: any = {}
  res.status = vi.fn((c: number) => { res.statusCode = c; return res })
  res.json = vi.fn((b: any) => { res.body = b; return res })
  res.setHeader = vi.fn()
  return res
}
const post = (body: Record<string, unknown>): VercelRequest =>
  ({ method: 'POST', query: {}, body, headers: { authorization: 'Bearer t' } }) as any
const get = (query: Record<string, unknown>): VercelRequest =>
  ({ method: 'GET', query, body: undefined, headers: { authorization: 'Bearer t' } }) as any

const ASK = {
  orgName: 'Dysgu Cymraeg',
  consentStatement: 'I agree my anonymous usage data is shared with the National Centre for Learning Welsh.',
}

let handler: typeof import('./org-enrolment-setup').default

beforeEach(async () => {
  vi.resetModules()
  handler = (await import('./org-enrolment-setup')).default
  isAdmin = true
  DB = { groups: [], invite_codes: [], org_enrolment_policies: [] }
})

describe('standing the org up', () => {
  it('creates the org node, ONE link and the policy', async () => {
    const res = makeRes()
    await handler(post(ASK), res)
    expect(res.body.success).toBe(true)
    expect(DB.groups).toHaveLength(1)
    expect(DB.groups[0]).toMatchObject({ name: 'Dysgu Cymraeg', type: 'organisation' })
    expect(DB.invite_codes).toHaveLength(1)
    expect(DB.invite_codes[0]).toMatchObject({ code_type: 'student', max_uses: null, expires_at: null })
    expect(DB.org_enrolment_policies).toHaveLength(1)
    expect(res.body.signupUrl).toContain('/enrol/')
  })

  it('FAILURE MODE: run twice, and a second sign-up link appears', async () => {
    const first = makeRes()
    await handler(post(ASK), first)
    const second = makeRes()
    await handler(post(ASK), second)
    expect(DB.groups).toHaveLength(1)
    expect(DB.invite_codes).toHaveLength(1)
    expect(DB.org_enrolment_policies).toHaveLength(1)
    // The SAME link both times — the whole point.
    expect(second.body.code).toBe(first.body.code)
    expect(second.body.groupId).toBe(first.body.groupId)
  })

  it('defaults the dialect families so Northern and Southern are one learner apiece', async () => {
    const res = makeRes()
    await handler(post(ASK), res)
    const map = DB.org_enrolment_policies[0].course_family_map
    expect(map.cym_s_for_eng).toBe('welsh_south')
    expect(map.cym_n_for_eng).toBe('welsh_north')
    // The Northern rebuild and the stray legacy code both join a real family
    // rather than becoming a third one that loses the max.
    expect(map.cym_nnew_for_eng).toBe('welsh_north')
    expect(map.cym_for_eng_north).toBe('welsh_north')
  })

  it('takes the free period and the warning lead time as parameters, with sane defaults', async () => {
    await handler(post(ASK), makeRes())
    expect(DB.org_enrolment_policies[0]).toMatchObject({ free_months: 12, warn_days_before: 21 })
    DB = { groups: [], invite_codes: [], org_enrolment_policies: [] }
    await handler(post({ ...ASK, freeMonths: 6, warnDaysBefore: 30 }), makeRes())
    expect(DB.org_enrolment_policies[0]).toMatchObject({ free_months: 6, warn_days_before: 30 })
  })

  it('refuses a non-admin, and refuses an ask with no consent wording', async () => {
    isAdmin = false
    const forbidden = makeRes()
    await handler(post(ASK), forbidden)
    expect(forbidden.statusCode).toBe(403)
    expect(DB.groups).toHaveLength(0)

    isAdmin = true
    const bad = makeRes()
    await handler(post({ orgName: 'Dysgu Cymraeg' }), bad)
    expect(bad.statusCode).toBe(400)
    expect(DB.groups).toHaveLength(0)
  })
})

// Kai, 2026-09-08: the admin Courses panel showed the Canolfan granting no
// courses, because it reads entitlement_grants and this org grants through its
// policy row instead. The policy table is revoked from `authenticated`, so the
// panel needs a server read — this one.
describe('reading the policy back', () => {
  it('returns the granted courses for a group that has a policy', async () => {
    await handler(post(ASK), makeRes())
    const groupId = DB.groups[0].id

    const res = makeRes()
    await handler(get({ groupId }), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.policy).toMatchObject({
      group_id: groupId,
      org_display_name: 'Dysgu Cymraeg',
      free_months: 12,
      granted_courses: ['cym_n_for_eng', 'cym_s_for_eng'],
      is_active: true,
    })
  })

  it('returns null for a group with no policy', async () => {
    const res = makeRes()
    await handler(get({ groupId: 'nobody' }), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.policy).toBeNull()
  })

  it('needs a groupId', async () => {
    const res = makeRes()
    await handler(get({}), res)
    expect(res.statusCode).toBe(400)
  })

  it('is ssi_admin only', async () => {
    isAdmin = false
    const res = makeRes()
    await handler(get({ groupId: 'g1' }), res)
    expect(res.statusCode).toBe(403)
  })
})
