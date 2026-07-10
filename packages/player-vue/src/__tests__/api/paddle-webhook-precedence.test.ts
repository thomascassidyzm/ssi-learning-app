/**
 * Tests for the plan-precedence guard in api/teacher/paddle-webhook.ts
 * (worklist 07-02 decision C): `subscriptions` is UNIQUE(learner_id) and all
 * three purchase kinds upsert it, so an upsert must never DOWNGRADE a
 * higher-ranked row (tutor bundle > premium > student access).
 */

import { describe, it, expect, vi } from 'vitest'

process.env.SUPABASE_URL = 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key'

const { wouldDowngradePlan, PLAN_PRECEDENCE } = await import('../../../../../api/teacher/paddle-webhook')

function fakeSupabase(existingPlanName: string | null, existingStatus: string = 'active') {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve(
              existingPlanName
                ? { data: { plan_name: existingPlanName, status: existingStatus }, error: null }
                : { data: null, error: null },
            ),
        }),
      }),
    }),
  }
}

describe('paddle-webhook plan precedence guard', () => {
  it('ranks Family top, then tutor bundle > premium > student access', () => {
    expect(PLAN_PRECEDENCE['SSi Family']).toBeGreaterThan(PLAN_PRECEDENCE['SSi Premium (tutor bundle)'])
    expect(PLAN_PRECEDENCE['SSi Premium (tutor bundle)']).toBeGreaterThan(PLAN_PRECEDENCE['SSi Premium'])
    expect(PLAN_PRECEDENCE['SSi Premium']).toBeGreaterThan(PLAN_PRECEDENCE['SSi Student Access'])
  })

  it('a tutor (rank 3) buying Family (rank 4) is never blocked — the owner row becomes Family', async () => {
    // The tension case FAMILY-PLAN-SPEC.md §2.4 calls out by name: if Family
    // ranked below the tutor bundle, this write would be silently skipped
    // (webhook 200s, Paddle collected, family gets nothing).
    const supabase = fakeSupabase('SSi Premium (tutor bundle)')
    const skip = await wouldDowngradePlan(supabase as any, 'learner-1', 'SSi Family')
    expect(skip).toBe(false)
  })

  it('blocks any lower-ranked plan from clobbering an existing active Family row', async () => {
    const supabase = fakeSupabase('SSi Family')
    expect(await wouldDowngradePlan(supabase as any, 'learner-1', 'SSi Premium (tutor bundle)')).toBe(true)
    expect(await wouldDowngradePlan(supabase as any, 'learner-1', 'SSi Premium')).toBe(true)
    expect(await wouldDowngradePlan(supabase as any, 'learner-1', 'SSi Student Access')).toBe(true)
  })

  it('allows a same-plan Family renewal/status update', async () => {
    const supabase = fakeSupabase('SSi Family')
    expect(await wouldDowngradePlan(supabase as any, 'learner-1', 'SSi Family')).toBe(false)
  })

  it('blocks a student-access upsert from clobbering an existing tutor-bundle row', async () => {
    const supabase = fakeSupabase('SSi Premium (tutor bundle)')
    const skip = await wouldDowngradePlan(supabase as any, 'learner-1', 'SSi Student Access')
    expect(skip).toBe(true)
  })

  it('blocks a plain-premium upsert from clobbering an existing tutor-bundle row', async () => {
    const supabase = fakeSupabase('SSi Premium (tutor bundle)')
    const skip = await wouldDowngradePlan(supabase as any, 'learner-1', 'SSi Premium')
    expect(skip).toBe(true)
  })

  it('allows an upgrade (student access existing → tutor bundle incoming)', async () => {
    const supabase = fakeSupabase('SSi Student Access')
    const skip = await wouldDowngradePlan(supabase as any, 'learner-1', 'SSi Premium (tutor bundle)')
    expect(skip).toBe(false)
  })

  it('allows a same-kind update (renewal / status change)', async () => {
    const supabase = fakeSupabase('SSi Student Access')
    const skip = await wouldDowngradePlan(supabase as any, 'learner-1', 'SSi Student Access')
    expect(skip).toBe(false)
  })

  it('allows the first-ever purchase (no existing row)', async () => {
    const supabase = fakeSupabase(null)
    const skip = await wouldDowngradePlan(supabase as any, 'learner-1', 'SSi Student Access')
    expect(skip).toBe(false)
  })

  it('allows a new paid plan to apply when the higher-ranked existing row is cancelled', async () => {
    // Regression: a cancelled tutor-bundle row (rank 3) must not silently
    // block a new paid Premium (rank 2) purchase — payment taken, no
    // entitlement, webhook 200s.
    const supabase = fakeSupabase('SSi Premium (tutor bundle)', 'cancelled')
    const skip = await wouldDowngradePlan(supabase as any, 'learner-1', 'SSi Premium')
    expect(skip).toBe(false)
  })

  it('allows a new paid plan to apply when the higher-ranked existing row has no active status', async () => {
    const supabase = fakeSupabase('SSi Premium (tutor bundle)', 'none')
    const skip = await wouldDowngradePlan(supabase as any, 'learner-1', 'SSi Student Access')
    expect(skip).toBe(false)
  })

  it('still blocks a downgrade when the higher-ranked existing row is past_due (still entitled during dunning)', async () => {
    const supabase = fakeSupabase('SSi Premium (tutor bundle)', 'past_due')
    const skip = await wouldDowngradePlan(supabase as any, 'learner-1', 'SSi Premium')
    expect(skip).toBe(true)
  })
})
