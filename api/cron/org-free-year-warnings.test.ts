/**
 * /api/cron/org-free-year-warnings — warn weeks ahead, once, never on the day.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-key'
process.env.CRON_SECRET = 'cron-secret'
process.env.RESEND_API_KEY = 'resend-key'

const sends: any[] = []
vi.mock('../_utils/resendMail', () => ({
  postResendEmail: vi.fn(async (_k: string, m: any) => { sends.push(m); return { sent: true, id: 'm1' } }),
}))

type Row = Record<string, any>
let DB: Record<string, Row[]>
function makeChainable(table: string) {
  let rows: Row[] = [...(DB[table] ?? [])]
  const b: any = {
    select() { return b },
    eq(c: string, v: unknown) { rows = rows.filter((r) => r[c] === v); return b },
    is(c: string, v: unknown) { rows = rows.filter((r) => (r[c] ?? null) === v); return b },
    gt(c: string, v: any) { rows = rows.filter((r) => r[c] > v); return b },
    lte(c: string, v: any) { rows = rows.filter((r) => r[c] <= v); return b },
    limit(n: number) { rows = rows.slice(0, n); return b },
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
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: (t: string) => makeChainable(t) }) }))

function makeRes(): VercelResponse & { statusCode?: number; body?: any } {
  const res: any = {}
  res.status = vi.fn((c: number) => { res.statusCode = c; return res })
  res.json = vi.fn((b: any) => { res.body = b; return res })
  return res
}
const req = (auth = 'Bearer cron-secret'): VercelRequest => ({ method: 'GET', query: {}, headers: { authorization: auth } }) as any

const inDays = (n: number) => new Date(Date.now() + n * 86400000).toISOString()

let handler: typeof import('./org-free-year-warnings').default

beforeEach(async () => {
  vi.resetModules()
  sends.length = 0
  handler = (await import('./org-free-year-warnings')).default
  DB = {
    org_enrolment_policies: [{ group_id: 'g-org', org_display_name: 'Dysgu Cymraeg', warn_days_before: 21 }],
    org_enrolments: [],
    learners: [{ id: 'L1', verified_emails: ['sian@example.com'] }],
  }
})

describe('who gets warned', () => {
  it('warns somebody three weeks out, and nobody six months out', async () => {
    DB.org_enrolments.push(
      { id: 'e-soon', group_id: 'g-org', learner_id: 'L1', free_access_until: inDays(14), expiry_warned_at: null },
      { id: 'e-later', group_id: 'g-org', learner_id: 'L1', free_access_until: inDays(180), expiry_warned_at: null },
    )
    const res = makeRes()
    await handler(req(), res)
    expect(res.body).toMatchObject({ considered: 1, warned: 1 })
    expect(sends[0].subject).toMatch(/free year .* ends on/i)
    expect(DB.org_enrolments[0].expiry_warned_at).toBeTruthy()
    expect(DB.org_enrolments[1].expiry_warned_at).toBeNull()
  })

  it('FAILURE MODE: the same person warned twice', async () => {
    DB.org_enrolments.push({ id: 'e-1', group_id: 'g-org', learner_id: 'L1', free_access_until: inDays(10), expiry_warned_at: null })
    await handler(req(), makeRes())
    const second = makeRes()
    await handler(req(), second)
    expect(sends).toHaveLength(1)
    expect(second.body.considered).toBe(0)
  })

  it('FAILURE MODE: warning on the day, or after the year has already ended', async () => {
    DB.org_enrolments.push({ id: 'e-past', group_id: 'g-org', learner_id: 'L1', free_access_until: inDays(-1), expiry_warned_at: null })
    const res = makeRes()
    await handler(req(), res)
    expect(res.body.considered).toBe(0)
    expect(sends).toHaveLength(0)
  })

  it('honours each org\'s own lead time rather than one global constant', async () => {
    DB.org_enrolment_policies.push({ group_id: 'g-other', org_display_name: 'Other', warn_days_before: 60 })
    DB.org_enrolments.push(
      { id: 'e-a', group_id: 'g-org', learner_id: 'L1', free_access_until: inDays(40), expiry_warned_at: null },
      { id: 'e-b', group_id: 'g-other', learner_id: 'L1', free_access_until: inDays(40), expiry_warned_at: null },
    )
    const res = makeRes()
    await handler(req(), res)
    // 40 days out: inside the 60-day org's window, outside the 21-day one's.
    expect(res.body.considered).toBe(1)
    expect(sends).toHaveLength(1)
  })

  it('ignores an enrolment whose group has no policy at all', async () => {
    DB.org_enrolments.push({ id: 'e-orphan', group_id: 'g-unknown', learner_id: 'L1', free_access_until: inDays(5), expiry_warned_at: null })
    const res = makeRes()
    await handler(req(), res)
    expect(res.body.considered).toBe(0)
  })
})

describe('the door', () => {
  it('refuses a wrong secret on a DEPLOYED environment and sends nothing', async () => {
    // checkCronAuth deliberately lets a local run through with a warning, so
    // the refusal only exists to be tested where it matters: deployed.
    const prev = process.env.VERCEL_ENV
    process.env.VERCEL_ENV = 'production'
    try {
      DB.org_enrolments.push({ id: 'e-1', group_id: 'g-org', learner_id: 'L1', free_access_until: inDays(10), expiry_warned_at: null })
      const res = makeRes()
      await handler(req('Bearer wrong'), res)
      expect(res.statusCode).toBe(401)
      expect(sends).toHaveLength(0)
    } finally {
      if (prev === undefined) delete process.env.VERCEL_ENV
      else process.env.VERCEL_ENV = prev
    }
  })
})

describe('the words', () => {
  it('names the org, gives a real date, and threatens nobody', async () => {
    const { warningCopy } = await import('./org-free-year-warnings')
    const copy = warningCopy('Dysgu Cymraeg', '1 October 2027')
    expect(copy.subject).toContain('1 October 2027')
    expect(copy.text).toContain('Dysgu Cymraeg')
    expect(copy.text).toMatch(/everything you have learned stays/i)
    expect(copy.text).not.toMatch(/expire|lose access|act now|urgent/i)
  })

  it('isDue is a window, not an anniversary', async () => {
    const { isDue } = await import('./org-free-year-warnings')
    const now = new Date('2026-09-08T00:00:00Z')
    expect(isDue('2026-09-20T00:00:00Z', 21, now)).toBe(true)
    expect(isDue('2026-11-20T00:00:00Z', 21, now)).toBe(false)
    expect(isDue('2026-09-07T00:00:00Z', 21, now)).toBe(false)
  })
})
