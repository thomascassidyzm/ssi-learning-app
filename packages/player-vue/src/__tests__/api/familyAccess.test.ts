/**
 * Tests for the effective-subscription resolver (FAMILY-PLAN-SPEC.md §3):
 * own row first; else the family join, gated on the owner's row being an
 * ACTIVE, unexpired 'SSi Family' plan.
 */

import { describe, it, expect } from 'vitest'
import { resolveEffectiveSubscription, isEffectivelySubscribed } from '../../../../../api/_utils/familyAccess'

/**
 * Minimal fake Supabase client routed per table. Each table's response is a
 * queue — successive calls to the same table pop the next entry, so a test
 * can script "family_members row → then subscriptions row" for the two
 * queries the family-branch makes.
 */
function fakeSupabase(routes: Record<string, Array<{ data: any; error: any }>>) {
  const cursors: Record<string, number> = {}
  return {
    from(table: string) {
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        is: () => chain,
        maybeSingle: () => {
          const queue = routes[table] || []
          const i = cursors[table] ?? 0
          cursors[table] = i + 1
          return Promise.resolve(queue[i] ?? { data: null, error: null })
        },
      }
      return chain
    },
  }
}

const FUTURE = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
const PAST = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

describe('resolveEffectiveSubscription', () => {
  it('returns the own row when one exists, without checking family at all', async () => {
    const supabase = fakeSupabase({
      subscriptions: [{ data: { id: 'own-1', learner_id: 'me', status: 'active', plan_name: 'SSi Premium', current_period_end: FUTURE }, error: null }],
    })
    const result = await resolveEffectiveSubscription(supabase as any, 'me')
    expect(result.viaFamily).toBe(false)
    expect(result.sub?.id).toBe('own-1')
  })

  it('returns the own row even when its status is not active — own row always wins over family', async () => {
    const supabase = fakeSupabase({
      subscriptions: [{ data: { id: 'own-cancelled', learner_id: 'me', status: 'cancelled', plan_name: 'SSi Premium', current_period_end: PAST }, error: null }],
    })
    const result = await resolveEffectiveSubscription(supabase as any, 'me')
    expect(result.viaFamily).toBe(false)
    expect(result.sub?.id).toBe('own-cancelled')
  })

  it('resolves via the family owner\'s row when the learner has no own row and is an active member', async () => {
    const supabase = fakeSupabase({
      subscriptions: [
        { data: null, error: null }, // own row: none
        { data: { id: 'owner-sub-1', learner_id: 'owner-1', status: 'active', plan_name: 'SSi Family', current_period_end: FUTURE }, error: null },
      ],
      family_members: [{ data: { owner_learner_id: 'owner-1' }, error: null }],
    })
    const result = await resolveEffectiveSubscription(supabase as any, 'member-1')
    expect(result.viaFamily).toBe(true)
    expect(result.sub?.id).toBe('owner-sub-1')
  })

  it('is null when the learner has no own row and no family membership at all', async () => {
    const supabase = fakeSupabase({
      subscriptions: [{ data: null, error: null }],
      family_members: [{ data: null, error: null }],
    })
    const result = await resolveEffectiveSubscription(supabase as any, 'nobody')
    expect(result.sub).toBeNull()
    expect(result.viaFamily).toBe(false)
  })

  it('is null for a removed membership (the fake query already filters removed_at/status, this covers the not-found branch)', async () => {
    const supabase = fakeSupabase({
      subscriptions: [{ data: null, error: null }],
      family_members: [{ data: null, error: null }], // removed → the real query's .is('removed_at', null) excludes it
    })
    const result = await resolveEffectiveSubscription(supabase as any, 'removed-member')
    expect(result.sub).toBeNull()
  })

  it('is null when the owner\'s row is past_due (only ACTIVE owner rows grant family access)', async () => {
    const supabase = fakeSupabase({
      subscriptions: [
        { data: null, error: null },
        { data: null, error: null }, // the real query's .eq('status','active') excludes a past_due owner row
      ],
      family_members: [{ data: { owner_learner_id: 'owner-1' }, error: null }],
    })
    const result = await resolveEffectiveSubscription(supabase as any, 'member-1')
    expect(result.sub).toBeNull()
    expect(result.viaFamily).toBe(false)
  })

  it('is null when the owner downgraded away from SSi Family (plan_name changed — members correctly stop resolving)', async () => {
    const supabase = fakeSupabase({
      subscriptions: [
        { data: null, error: null },
        { data: null, error: null }, // the real query's .eq('plan_name','SSi Family') excludes a plain-Premium owner row
      ],
      family_members: [{ data: { owner_learner_id: 'owner-1' }, error: null }],
    })
    const result = await resolveEffectiveSubscription(supabase as any, 'member-1')
    expect(result.sub).toBeNull()
  })

  it('is null when the owner\'s active Family row has lapsed past its current_period_end', async () => {
    const supabase = fakeSupabase({
      subscriptions: [
        { data: null, error: null },
        { data: { id: 'owner-sub-1', learner_id: 'owner-1', status: 'active', plan_name: 'SSi Family', current_period_end: PAST }, error: null },
      ],
      family_members: [{ data: { owner_learner_id: 'owner-1' }, error: null }],
    })
    const result = await resolveEffectiveSubscription(supabase as any, 'member-1')
    expect(result.sub).toBeNull()
    expect(result.viaFamily).toBe(false)
  })

  it('a member who ALSO has their own active row is covered "both" ways but resolves to their own (additive, no arithmetic — spec §2.4)', async () => {
    const supabase = fakeSupabase({
      subscriptions: [{ data: { id: 'own-premium-1', learner_id: 'member-1', status: 'active', plan_name: 'SSi Premium', current_period_end: FUTURE }, error: null }],
      // family_members would resolve too, but must never be queried — own row short-circuits.
    })
    const result = await resolveEffectiveSubscription(supabase as any, 'member-1')
    expect(result.viaFamily).toBe(false)
    expect(result.sub?.id).toBe('own-premium-1')
  })
})

describe('isEffectivelySubscribed', () => {
  it('true for an own active row', async () => {
    const supabase = fakeSupabase({
      subscriptions: [{ data: { status: 'active', current_period_end: FUTURE }, error: null }],
    })
    expect(await isEffectivelySubscribed(supabase as any, 'me')).toBe(true)
  })

  it('true for a member covered via an active family', async () => {
    const supabase = fakeSupabase({
      subscriptions: [
        { data: null, error: null },
        { data: { status: 'active', current_period_end: FUTURE }, error: null },
      ],
      family_members: [{ data: { owner_learner_id: 'owner-1' }, error: null }],
    })
    expect(await isEffectivelySubscribed(supabase as any, 'member-1')).toBe(true)
  })

  it('false when nothing resolves', async () => {
    const supabase = fakeSupabase({
      subscriptions: [{ data: null, error: null }],
      family_members: [{ data: null, error: null }],
    })
    expect(await isEffectivelySubscribed(supabase as any, 'nobody')).toBe(false)
  })
})
