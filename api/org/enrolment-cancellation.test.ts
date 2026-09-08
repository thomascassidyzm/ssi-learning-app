/**
 * /api/org/enrolment-cancellation — the queue, and the line it must not cross.
 *
 * The single most important assertion in this file is the last one: that the
 * module reaches nothing that could cancel a subscription. It is a source
 * assertion rather than a behavioural one on purpose — a behavioural test can
 * only prove that today's code path did not bill anybody, whereas this fails
 * the moment somebody imports a billing client into the file at all.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { VercelRequest, VercelResponse } from '@vercel/node'

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-key'

let caller: { userId: string; isAdmin: boolean; ownGroupId: string | null } | null
let canSee = true
vi.mock('../_utils/groupTreeAuth', () => ({
  resolveGroupTreeCaller: vi.fn(async (_req: any, res: any) => {
    if (!caller) { res.status(403).json({ error: 'no' }); return null }
    return caller
  }),
  callerCanSeeGroup: vi.fn(async () => canSee),
}))

type Row = Record<string, any>
let DB: Record<string, Row[]>
function makeChainable(table: string) {
  let rows: Row[] = [...(DB[table] ?? [])]
  const b: any = {
    select() { return b },
    eq(c: string, v: unknown) { rows = rows.filter((r) => r[c] === v); return b },
    in(c: string, v: unknown[]) { rows = rows.filter((r) => v.includes(r[c])); return b },
    order() { return b },
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
  res.setHeader = vi.fn()
  return res
}

let handler: typeof import('./enrolment-cancellation').default

beforeEach(async () => {
  vi.resetModules()
  handler = (await import('./enrolment-cancellation')).default
  caller = { userId: 'admin-1', isAdmin: true, ownGroupId: null }
  canSee = true
  DB = {
    groups: [{ id: 'g-org', name: 'Dysgu Cymraeg', type: 'organisation', parent_id: null, path: 'dysgu-cymraeg', is_demo: false, is_test: false, created_at: '2026-01-01' }],
    org_enrolments: [
      { id: 'e-1', group_id: 'g-org', learner_id: 'L1', enrolled_at: '2026-09-01T00:00:00Z', free_access_until: '2027-09-01T00:00:00Z', prior_subscription_status: 'active', cancellation_state: 'needed', cancellation_noted_at: null },
      { id: 'e-2', group_id: 'g-org', learner_id: 'L2', enrolled_at: '2026-09-02T00:00:00Z', free_access_until: '2027-09-02T00:00:00Z', prior_subscription_status: null, cancellation_state: 'not_needed', cancellation_noted_at: null },
    ],
    learners: [{ id: 'L1', display_name: 'Sian', user_id: 'auth-1' }],
    subscriptions: [{ id: 'sub-1', learner_id: 'L1', status: 'active', cancel_at_period_end: false }],
  }
})

describe('the queue', () => {
  it('lists only the people who actually need a cancellation', async () => {
    const res = makeRes()
    await handler({ method: 'GET', query: { groupId: 'g-org' }, headers: {} } as any, res)
    expect(res.statusCode).toBe(200)
    expect(res.body.queue).toHaveLength(1)
    expect(res.body.queue[0]).toMatchObject({ enrolmentId: 'e-1', displayName: 'Sian', state: 'needed' })
  })

  it("refuses another org's queue", async () => {
    canSee = false
    const res = makeRes()
    await handler({ method: 'GET', query: { groupId: 'g-org' }, headers: {} } as any, res)
    expect(res.statusCode).toBe(403)
  })
})

describe('recording a note', () => {
  it('records that a human did it, and does not touch the subscription', async () => {
    const res = makeRes()
    await handler({ method: 'POST', query: {}, body: { enrolmentId: 'e-1', state: 'verified_cancelled' }, headers: {} } as any, res)
    expect(res.body).toMatchObject({ success: true, billingActionTaken: false })
    expect(DB.org_enrolments[0].cancellation_state).toBe('verified_cancelled')
    expect(DB.org_enrolments[0].cancellation_noted_by).toBe('admin-1')
    // The subscription row is exactly as it was.
    expect(DB.subscriptions[0]).toEqual({ id: 'sub-1', learner_id: 'L1', status: 'active', cancel_at_period_end: false })
  })

  it('refuses a state that is not one of the two recordable notes', async () => {
    const res = makeRes()
    await handler({ method: 'POST', query: {}, body: { enrolmentId: 'e-1', state: 'cancelled' }, headers: {} } as any, res)
    expect(res.statusCode).toBe(400)
    expect(DB.org_enrolments[0].cancellation_state).toBe('needed')
  })

  it("refuses a note against an enrolment in somebody else's org", async () => {
    canSee = false
    const res = makeRes()
    await handler({ method: 'POST', query: {}, body: { enrolmentId: 'e-1', state: 'verified_cancelled' }, headers: {} } as any, res)
    expect(res.statusCode).toBe(403)
    expect(DB.org_enrolments[0].cancellation_state).toBe('needed')
  })
})

describe('THE LINE', () => {
  const SOURCES = ['org/enrolment-cancellation.ts', 'org/enrol.ts', 'views/OrgEnrolment.vue'] as const

  it('no part of the enrolment path can reach a billing cancellation', () => {
    const roots: Record<string, string> = {
      'org/enrolment-cancellation.ts': join(__dirname, 'enrolment-cancellation.ts'),
      'org/enrol.ts': join(__dirname, 'enrol.ts'),
      'views/OrgEnrolment.vue': join(__dirname, '../../packages/player-vue/src/views/OrgEnrolment.vue'),
    }
    for (const name of SOURCES) {
      // Comments are stripped first: these files TALK about not cancelling
      // subscriptions, at length and on purpose, and the prose must not be
      // what trips the test.
      const src = readFileSync(roots[name], 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')
        .replace(/<!--[\s\S]*?-->/g, '')
      // Nothing that reaches Paddle, and no call to the app's own cancel route.
      expect(src, `${name} must not import a billing client`).not.toMatch(/paddle/i)
      expect(src, `${name} must not call the cancel endpoint`).not.toMatch(/subscription\/cancel/)
      // The one thing it may NOT do to the subscriptions table is write to it.
      expect(src, `${name} must not write to subscriptions`).not.toMatch(/from\('subscriptions'\)[\s\S]{0,120}\.(update|insert|upsert|delete)\(/)
    }
  })
})
