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

function fakeSupabase(existingPlanName: string | null) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve(
              existingPlanName ? { data: { plan_name: existingPlanName }, error: null } : { data: null, error: null },
            ),
        }),
      }),
    }),
  }
}

describe('paddle-webhook plan precedence guard', () => {
  it('ranks tutor bundle > premium > student access', () => {
    expect(PLAN_PRECEDENCE['SSi Premium (tutor bundle)']).toBeGreaterThan(PLAN_PRECEDENCE['SSi Premium'])
    expect(PLAN_PRECEDENCE['SSi Premium']).toBeGreaterThan(PLAN_PRECEDENCE['SSi Student Access'])
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
})
