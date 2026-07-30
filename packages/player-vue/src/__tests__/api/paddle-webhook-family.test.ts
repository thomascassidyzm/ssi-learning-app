/**
 * Tests for the SSi Family plan webhook path (FAMILY-PLAN-SPEC.md §2.3):
 * one absolute, idempotent write to the owner's `subscriptions` row —
 * plan_name 'SSi Family' — with NO membership side effects. Covers the
 * spoofed-price guard (PRICE_CATALOG tier check) and the product-not-yet-
 * configured tolerance (Tom hasn't created the Paddle product yet).
 */

import { describe, it, expect, vi } from 'vitest'

process.env.SUPABASE_URL = 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key'
// PRICE_CATALOG's family entries are built at module load from these env
// vars — set BEFORE the dynamic import so they're present in the catalog.
process.env.VITE_PADDLE_FAMILY_PRICE_MONTHLY = 'pri_family_monthly_test'
process.env.VITE_PADDLE_FAMILY_PRICE_ANNUAL = 'pri_family_annual_test'

const { handleFamilySubscription, handleSubscriptionEvent } = await import(
  '../../../../../api/teacher/paddle-webhook'
)

type Call = { table: string; method: string; args: any[] }

function makeSupabaseMock(responses: Record<string, any>) {
  const calls: Call[] = []
  function chainFor(table: string) {
    const response = responses[table] ?? { data: null, error: null }
    const chain: any = {
      select: (...a: any[]) => { calls.push({ table, method: 'select', args: a }); return chain },
      eq: (...a: any[]) => { calls.push({ table, method: 'eq', args: a }); return chain },
      is: (...a: any[]) => { calls.push({ table, method: 'is', args: a }); return chain },
      upsert: (...a: any[]) => { calls.push({ table, method: 'upsert', args: a }); return chain },
      insert: (...a: any[]) => { calls.push({ table, method: 'insert', args: a }); return chain },
      update: (...a: any[]) => { calls.push({ table, method: 'update', args: a }); return chain },
      maybeSingle: () => Promise.resolve(response),
      single: () => Promise.resolve(response),
      then: (resolve: any) => resolve(response),
    }
    return chain
  }
  return {
    from: (table: string) => chainFor(table),
    calls,
  }
}

const baseData = {
  id: 'sub_family_incoming',
  status: 'active',
  currentBillingPeriod: { endsAt: '2027-01-01T00:00:00Z' },
  items: [{ price: { id: 'pri_family_monthly_test' } }],
  scheduledChange: null,
  customerId: undefined,
}

describe('paddle-webhook: SSi Family subscription', () => {
  it('upserts the owner subscriptions row with plan_name SSi Family, no membership side effects', async () => {
    const supabase = makeSupabaseMock({
      learners: { data: { id: 'learner-owner-1' }, error: null },
      subscriptions: { data: null, error: null }, // no existing row → wouldDowngradePlan false
    })

    await handleFamilySubscription(supabase as any, baseData, { supabase_user_id: 'user-1' })

    const upsertCall = supabase.calls.find((c) => c.table === 'subscriptions' && c.method === 'upsert')
    expect(upsertCall).toBeDefined()
    expect(upsertCall?.args[0]).toMatchObject({
      learner_id: 'learner-owner-1',
      plan_name: 'SSi Family',
      status: 'active',
      provider_subscription_id: 'sub_family_incoming',
    })
    // No family_members writes — the webhook stays dumb, membership is managed
    // entirely by /api/family/* afterwards.
    expect(supabase.calls.some((c) => c.table === 'family_members')).toBe(false)
  })

  it('does nothing without supabase_user_id in customData', async () => {
    const supabase = makeSupabaseMock({})
    await handleFamilySubscription(supabase as any, baseData, {})
    expect(supabase.calls.some((c) => c.method === 'upsert')).toBe(false)
  })

  it('does nothing when the learner cannot be resolved', async () => {
    const supabase = makeSupabaseMock({
      learners: { data: null, error: { message: 'not found' } },
    })
    await handleFamilySubscription(supabase as any, baseData, { supabase_user_id: 'ghost-user' })
    expect(supabase.calls.some((c) => c.method === 'upsert')).toBe(false)
  })

  it('a tutor (rank 3) buying Family still gets the row write — the tension case from §2.4', async () => {
    const supabase = makeSupabaseMock({
      learners: { data: { id: 'learner-owner-1' }, error: null },
      subscriptions: { data: { plan_name: 'SSi Premium (tutor bundle)', status: 'active' }, error: null },
    })
    await handleFamilySubscription(supabase as any, baseData, { supabase_user_id: 'user-1' })
    const upsertCall = supabase.calls.find((c) => c.table === 'subscriptions' && c.method === 'upsert')
    expect(upsertCall?.args[0]).toMatchObject({ plan_name: 'SSi Family' })
  })

  it('handleSubscriptionEvent REJECTS kind:family_plan billed on a non-family price (spoof guard)', async () => {
    const supabase = makeSupabaseMock({
      learners: { data: { id: 'learner-owner-1' }, error: null },
      subscriptions: { data: null, error: null },
    })
    await handleSubscriptionEvent(supabase as any, {
      ...baseData,
      items: [{ price: { id: 'pri_01kv5wrc5cz17pwgeva4zk8s0r' } }], // the £5 student-school price
      customData: { kind: 'family_plan', supabase_user_id: 'user-1' },
    })
    expect(supabase.calls.some((c) => c.method === 'upsert')).toBe(false)
  })

  it('handleSubscriptionEvent accepts kind:family_plan billed on the real family price', async () => {
    const supabase = makeSupabaseMock({
      learners: { data: { id: 'learner-owner-1' }, error: null },
      subscriptions: { data: null, error: null },
    })
    await handleSubscriptionEvent(supabase as any, {
      ...baseData,
      customData: { kind: 'family_plan', supabase_user_id: 'user-1' },
    })
    expect(supabase.calls.some((c) => c.table === 'subscriptions' && c.method === 'upsert')).toBe(true)
  })
})

describe('paddle-webhook: SSi Family — product not yet configured (Tom has not created it)', () => {
  it('is tolerant: an unconfigured family price rejects cleanly, never throws', async () => {
    // Re-import with the env vars absent, simulating pre-Paddle-product state.
    delete process.env.VITE_PADDLE_FAMILY_PRICE_MONTHLY
    delete process.env.VITE_PADDLE_FAMILY_PRICE_ANNUAL
    vi.resetModules()
    const mod = await import('../../../../../api/teacher/paddle-webhook')
    const supabase = makeSupabaseMock({
      learners: { data: { id: 'learner-owner-1' }, error: null },
      subscriptions: { data: null, error: null },
    })
    await expect(
      mod.handleSubscriptionEvent(supabase as any, {
        ...baseData,
        customData: { kind: 'family_plan', supabase_user_id: 'user-1' },
      })
    ).resolves.toBeUndefined()
    expect(supabase.calls.some((c) => c.method === 'upsert')).toBe(false)
  })
})
