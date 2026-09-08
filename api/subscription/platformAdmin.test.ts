/**
 * A PLATFORM ADMIN IS NEVER SOLD A PLAN, AND THE SERVER IS WHO SAYS SO.
 *
 * Tom, 2026-09-08, on his own Settings screen: "I'm being shown an upgrade
 * button, which I probably shouldn't be shown as I am a platform admin." He
 * holds no Paddle subscription, so he fell into the not-subscribed branch and
 * was offered £15 a month.
 *
 * The decision is made HERE rather than in the client, because this is the
 * money path and the client's own role cache is a localStorage key
 * (`ssi-user-role`) that any browser can write. What is asserted is that the
 * flag is read off the learner row this endpoint already fetches, that it is
 * true only for 'ssi_admin', and that it is present on every response shape —
 * including the ones that return no subscription at all, which is precisely
 * the shape a platform admin gets.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

process.env.SUPABASE_URL = 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'

let authUserId: string | null = 'auth-user-1'
vi.mock('../_utils/auth', () => ({
  getAuthUserId: vi.fn(async () => authUserId),
}))

vi.mock('../_utils/cors', () => ({ applyCors: () => false }))

let learnerRow: any = { id: 'learner-1', platform_role: null }
let effectiveSub: any = { sub: null, viaFamily: false, coverEndsAt: null }

vi.mock('../_utils/familyAccess', () => ({
  resolveEffectiveSubscription: vi.fn(async () => effectiveSub),
}))
vi.mock('../_utils/familyGrace', () => ({ familyCoverEndsAt: () => null }))

function makeChainable(table: string) {
  const builder: any = {
    select: () => builder,
    eq: () => builder,
    limit: () => builder,
    single: async () => (table === 'learners' ? { data: learnerRow, error: null } : { data: null, error: null }),
    maybeSingle: async () => ({ data: null, error: null }),
  }
  return builder
}
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: (table: string) => makeChainable(table) }),
}))

function makeReq(): VercelRequest {
  return { method: 'GET', query: {}, headers: { authorization: 'Bearer tok' } } as VercelRequest
}
function makeRes() {
  const res: any = {}
  res.status = vi.fn((code: number) => { res._status = code; return res })
  res.json = vi.fn((body: unknown) => { res._json = body; return res })
  return res as VercelResponse & { _status?: number; _json?: any }
}

describe('GET /api/subscription — the platform-admin flag', () => {
  let handler: typeof import('./index').default

  beforeEach(async () => {
    vi.resetModules()
    authUserId = 'auth-user-1'
    learnerRow = { id: 'learner-1', platform_role: null }
    effectiveSub = { sub: null, viaFamily: false, coverEndsAt: null }
    handler = (await import('./index')).default
  })

  it('reports an ssi_admin as a platform admin, with no subscription to sell', async () => {
    learnerRow = { id: 'learner-1', platform_role: 'ssi_admin' }
    const res = makeRes()
    await handler(makeReq(), res)
    expect(res._status).toBe(200)
    expect(res._json.isPlatformAdmin).toBe(true)
    expect(res._json.isSubscribed).toBe(false)
    expect(res._json.subscription).toBeNull()
  })

  it('carries the flag on a subscribed response too, not only the empty one', async () => {
    learnerRow = { id: 'learner-1', platform_role: 'ssi_admin' }
    effectiveSub = {
      sub: {
        id: 's1', learner_id: 'learner-1', status: 'active', plan_id: 'p', plan_name: 'SSi Premium',
        current_period_end: '2099-01-01T00:00:00Z', cancel_at_period_end: false, provider: 'paddle',
      },
      viaFamily: false,
      coverEndsAt: null,
    }
    const res = makeRes()
    await handler(makeReq(), res)
    expect(res._json.isPlatformAdmin).toBe(true)
    expect(res._json.isSubscribed).toBe(true)
  })

  it('is false for an ordinary learner', async () => {
    const res = makeRes()
    await handler(makeReq(), res)
    expect(res._json.isPlatformAdmin).toBe(false)
  })

  it('is false for a tester — this grant is ssi_admin only', async () => {
    learnerRow = { id: 'learner-1', platform_role: 'tester' }
    const res = makeRes()
    await handler(makeReq(), res)
    expect(res._json.isPlatformAdmin).toBe(false)
  })

  it('is false when the caller has no learner row at all', async () => {
    learnerRow = null
    const res = makeRes()
    await handler(makeReq(), res)
    expect(res._json.isPlatformAdmin).toBe(false)
  })
})
