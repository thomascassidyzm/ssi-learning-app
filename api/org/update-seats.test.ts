/**
 * Tests for POST /api/org/update-seats — org lane mirror of
 * api/school/update-seats.test.ts. The org is derived from the caller's OWN
 * govt_admins row (leaderGroupId), never the request body.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-key'

let authUserId: string
vi.mock('../_utils/auth', () => ({
  verifyAuthToken: vi.fn(async () => ({ valid: true, userId: authUserId })),
}))

const paddleGet = vi.fn()
const paddleUpdate = vi.fn()
vi.mock('../_utils/paddle', () => ({
  paddle: { subscriptions: { get: (...a: any[]) => paddleGet(...a), update: (...a: any[]) => paddleUpdate(...a) } },
}))

let DB: {
  govt_admins: Array<{ user_id: string; group_id: string | null }>
  groups: Array<{ id: string; provider_subscription_id: string | null; platform_status: string | null; seats: number | null }>
}

function makeChainable(table: string) {
  let rows: any[] = [...((DB as any)[table] ?? [])]
  const builder: any = {
    select() { return builder },
    eq(col: string, val: unknown) { rows = rows.filter((r) => r[col] === val); return builder },
    update() { return { eq: async () => ({ data: null, error: null }) } },
    async maybeSingle() {
      return { data: rows[0] ?? null, error: null }
    },
  }
  return builder
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: (table: string) => makeChainable(table) }),
}))

function makeReq(body: any): VercelRequest {
  return { method: 'POST', body, headers: { authorization: 'Bearer tok' } } as any
}

function makeRes(): VercelResponse & { statusCode?: number; body?: any } {
  const res: any = {}
  res.status = vi.fn((code: number) => { res.statusCode = code; return res })
  res.json = vi.fn((body: any) => { res.body = body; return res })
  return res
}

let handler: typeof import('./update-seats').default

beforeEach(async () => {
  vi.resetModules()
  paddleGet.mockClear()
  paddleUpdate.mockClear()
  handler = (await import('./update-seats')).default
  DB = {
    govt_admins: [{ user_id: 'leader-a', group_id: 'org-1' }],
    groups: [{ id: 'org-1', provider_subscription_id: null, platform_status: 'active', seats: 5 }],
  }
})

describe('POST /api/org/update-seats', () => {
  it('404s a caller who leads no org', async () => {
    authUserId = 'nobody'
    const res = makeRes()
    await handler(makeReq({ seats: 10 }), res)
    expect(res.statusCode).toBe(404)
    expect(paddleGet).not.toHaveBeenCalled()
  })

  it('409s with requires_checkout when the org has no live subscription yet', async () => {
    authUserId = 'leader-a'
    const res = makeRes()
    await handler(makeReq({ seats: 10 }), res)
    expect(res.statusCode).toBe(409)
    expect(res.body.requires_checkout).toBe(true)
  })

  it('increases seats with prorated_immediately and writes the new quantity', async () => {
    authUserId = 'leader-a'
    DB.groups[0].provider_subscription_id = 'psub_org_1'
    paddleGet.mockResolvedValue({ status: 'active', items: [{ price: { id: 'pri_org_seat' }, quantity: 5 }] })
    paddleUpdate.mockResolvedValue({ status: 'active', items: [{ quantity: 10 }] })
    const res = makeRes()
    await handler(makeReq({ seats: 10 }), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.seats).toBe(10)
    expect(paddleUpdate).toHaveBeenCalledWith('psub_org_1', expect.objectContaining({
      items: [{ priceId: 'pri_org_seat', quantity: 10 }],
      prorationBillingMode: 'prorated_immediately',
    }))
  })

  it('decreases seats with prorated_next_billing_period', async () => {
    authUserId = 'leader-a'
    DB.groups[0].provider_subscription_id = 'psub_org_1'
    paddleGet.mockResolvedValue({ status: 'active', items: [{ price: { id: 'pri_org_seat' }, quantity: 5 }] })
    paddleUpdate.mockResolvedValue({ status: 'active', items: [{ quantity: 2 }] })
    const res = makeRes()
    await handler(makeReq({ seats: 2 }), res)
    expect(res.statusCode).toBe(200)
    expect(paddleUpdate).toHaveBeenCalledWith('psub_org_1', expect.objectContaining({ prorationBillingMode: 'prorated_next_billing_period' }))
  })

  it('never trusts a body group_id — always resolves via the caller\'s own leader row', async () => {
    authUserId = 'leader-a'
    DB.groups.push({ id: 'org-999', provider_subscription_id: 'psub_other', platform_status: 'active', seats: 1 })
    const res = makeRes()
    await handler(makeReq({ seats: 10, group_id: 'org-999' } as any), res)
    // Still resolves org-1 (no live subscription) not org-999.
    expect(res.statusCode).toBe(409)
  })
})
