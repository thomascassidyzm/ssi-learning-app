/**
 * /api/cron/org-entitlement-reconcile — the backstop for a promise unkept.
 *
 * An enrolment without an entitlement is a learner entitled to nothing,
 * permanently, and nothing else in the system looks for it. These tests are
 * named for the ways a repair job goes wrong: not repairing, repairing twice,
 * repairing the wrong rows, and extending somebody's year while it repairs.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-key'
process.env.CRON_SECRET = 'cron-secret'

type Row = Record<string, any>
let DB: Record<string, Row[]>
let failEntitlementInsert: boolean

/** The real primary key, which the grant helper computes rather than invents. */
const UNIQUE: Record<string, string[]> = { user_entitlements: ['id'] }

function makeChainable(table: string) {
  let rows: Row[] = [...(DB[table] ?? [])]
  const b: any = {
    select() { return b },
    eq(c: string, v: unknown) { rows = rows.filter((r) => r[c] === v); return b },
    limit(n: number) { rows = rows.slice(0, n); return b },
    insert(payload: Row) {
      if (table === 'user_entitlements' && failEntitlementInsert) {
        const err = { code: '42501', message: 'permission denied' }
        return { then: (f: any) => Promise.resolve({ data: null, error: err }).then(f) }
      }
      const store = (DB[table] ??= [])
      const key = UNIQUE[table]
      if (key && store.some((e) => key.every((k) => e[k] === payload[k]))) {
        const err = { code: '23505', message: `duplicate key on ${table}` }
        return { then: (f: any) => Promise.resolve({ data: null, error: err }).then(f) }
      }
      store.push({ id: payload.id ?? `${table}-${store.length + 1}`, ...payload })
      return { then: (f: any) => Promise.resolve({ data: null, error: null }).then(f) }
    },
    async maybeSingle() { return { data: rows[0] ?? null, error: null } },
    then(f: any, r: any) { return Promise.resolve({ data: rows, error: null }).then(f, r) },
  }
  return b
}
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: (t: string) => makeChainable(t) }) }))

function makeRes(): VercelResponse & { statusCode?: number; body?: any } {
  const res: any = {}
  res.status = vi.fn((c: number) => { res.statusCode = c; return res })
  res.json = vi.fn((b: any) => { res.body = b; return res })
  return res
}
const req = (auth = 'Bearer cron-secret'): VercelRequest =>
  ({ method: 'GET', query: {}, headers: { authorization: auth } }) as any

let handler: typeof import('./org-entitlement-reconcile').default

beforeEach(async () => {
  vi.resetModules()
  failEntitlementInsert = false
  handler = (await import('./org-entitlement-reconcile')).default
  DB = {
    org_enrolment_policies: [
      { group_id: 'g-canolfan', org_display_name: 'Dysgu Cymraeg', granted_courses: ['cym_s_for_eng', 'cym_n_for_eng'] },
    ],
    org_enrolments: [
      { id: 'e-1', learner_id: 'L1', group_id: 'g-canolfan', free_access_until: '2027-05-01T00:00:00Z' },
    ],
    user_entitlements: [],
  }
})

describe('the repair', () => {
  it('FAILURE MODE: an enrolment with no entitlement sitting there for ever', async () => {
    const res = makeRes()
    await handler(req(), res)
    expect(res.body).toEqual({ considered: 1, repaired: 1, failed: 0 })
    expect(DB.user_entitlements).toHaveLength(1)
    expect(DB.user_entitlements[0].granted_courses).toEqual(['cym_s_for_eng', 'cym_n_for_eng'])
  })

  it('FAILURE MODE: a daily job that quietly extends everybody\'s free year', async () => {
    await handler(req(), makeRes())
    // The enrolment's own date, not today plus twelve months.
    expect(DB.user_entitlements[0].expires_at).toBe('2027-05-01T00:00:00Z')
  })

  it('FAILURE MODE: running daily and stacking up a grant every night', async () => {
    await handler(req(), makeRes())
    const second = makeRes()
    await handler(req(), second)
    expect(DB.user_entitlements).toHaveLength(1)
    expect(second.body).toEqual({ considered: 1, repaired: 0, failed: 0 })
  })

  it('an enrolment under a policy granting nothing is not broken and is not counted', async () => {
    DB.org_enrolment_policies[0].granted_courses = []
    const res = makeRes()
    await handler(req(), res)
    expect(res.body).toEqual({ considered: 0, repaired: 0, failed: 0 })
    expect(DB.user_entitlements).toHaveLength(0)
  })

  it('a healthy enrolment is left alone', async () => {
    DB.user_entitlements.push({
      id: 'ent-1', learner_id: 'L1', access_type: 'courses',
      granted_courses: ['cym_s_for_eng', 'cym_n_for_eng'], expires_at: '2027-05-01T00:00:00Z',
    })
    const res = makeRes()
    await handler(req(), res)
    expect(res.body).toEqual({ considered: 1, repaired: 0, failed: 0 })
    expect(DB.user_entitlements).toHaveLength(1)
  })

  it('a repair that cannot be written is COUNTED, not swallowed', async () => {
    failEntitlementInsert = true
    const res = makeRes()
    await handler(req(), res)
    expect(res.body).toEqual({ considered: 1, repaired: 0, failed: 1 })
  })
})

describe('the door', () => {
  it('refuses without the cron bearer, on a deployed environment', async () => {
    // checkCronAuth only fails closed where it matters — a local run with a
    // wrong secret is waved through with a warning, deliberately.
    const prev = process.env.VERCEL_ENV
    process.env.VERCEL_ENV = 'production'
    try {
      const res = makeRes()
      await handler(req('Bearer wrong'), res)
      expect(res.statusCode).toBe(401)
      expect(DB.user_entitlements).toHaveLength(0)
    } finally {
      if (prev === undefined) delete process.env.VERCEL_ENV
      else process.env.VERCEL_ENV = prev
    }
  })
})
