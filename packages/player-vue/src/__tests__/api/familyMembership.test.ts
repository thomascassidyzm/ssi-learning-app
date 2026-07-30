/**
 * Tests for api/_utils/familyMembership.ts — the shared core behind every
 * /api/family/* endpoint and the claim-on-signin fold-in (FAMILY-PLAN-SPEC.md
 * §1, §4). Covers: seat counting (invited counts as a used seat), the
 * no-silent-steal rule, and idempotent attach.
 */

import { describe, it, expect } from 'vitest'
import {
  FAMILY_SEAT_CAP,
  countUsedSeats,
  isInAnyLiveFamily,
  attachPendingInvitesForEmail,
} from '../../../../../api/_utils/familyMembership'

/** Minimal fake Supabase: routes .from(table) to a scripted response queue. */
function fakeSupabase(routes: Record<string, Array<{ data: any; error: any }>>) {
  const cursors: Record<string, number> = {}
  const calls: Array<{ table: string; method: string; args: any[] }> = []
  return {
    calls,
    from(table: string) {
      const chain: any = {
        select: (...a: any[]) => { calls.push({ table, method: 'select', args: a }); return chain },
        eq: (...a: any[]) => { calls.push({ table, method: 'eq', args: a }); return chain },
        is: (...a: any[]) => { calls.push({ table, method: 'is', args: a }); return chain },
        update: (...a: any[]) => { calls.push({ table, method: 'update', args: a }); return chain },
        maybeSingle: () => {
          const queue = routes[table] || []
          const i = cursors[table] ?? 0
          cursors[table] = i + 1
          return Promise.resolve(queue[i] ?? { data: null, error: null })
        },
        then: (resolve: any) => {
          const queue = routes[table] || []
          const i = cursors[table] ?? 0
          cursors[table] = i + 1
          return resolve(queue[i] ?? { data: null, error: null })
        },
      }
      return chain
    },
  }
}

describe('FAMILY_SEAT_CAP', () => {
  it('is 6, including the payer (D1, confirmed 2026-07-10)', () => {
    expect(FAMILY_SEAT_CAP).toBe(6)
  })
})

describe('countUsedSeats', () => {
  it('counts 1 (owner) + zero live members for a fresh family', async () => {
    const supabase = fakeSupabase({ family_members: [{ data: [], error: null }] })
    expect(await countUsedSeats(supabase as any, 'owner-1')).toBe(1)
  })

  it('counts an INVITED (unclaimed) row as a used seat — matches the spec\'s own worked example', async () => {
    const supabase = fakeSupabase({
      family_members: [{ data: [{ id: 'm1', status: 'invited' }, { id: 'm2', status: 'active' }], error: null }],
    })
    expect(await countUsedSeats(supabase as any, 'owner-1')).toBe(3) // owner + invited + active
  })
})

describe('isInAnyLiveFamily', () => {
  it('true when the learner has a live membership row anywhere', async () => {
    const supabase = fakeSupabase({ family_members: [{ data: { id: 'm1' }, error: null }] })
    expect(await isInAnyLiveFamily(supabase as any, 'learner-1')).toBe(true)
  })

  it('false when there is no live row', async () => {
    const supabase = fakeSupabase({ family_members: [{ data: null, error: null }] })
    expect(await isInAnyLiveFamily(supabase as any, 'learner-1')).toBe(false)
  })
})

describe('attachPendingInvitesForEmail', () => {
  it('attaches a pending invite and stamps status active', async () => {
    const supabase = fakeSupabase({
      family_members: [
        { data: [{ id: 'invite-1', owner_learner_id: 'owner-1' }], error: null }, // pending lookup
        { data: null, error: null }, // isInAnyLiveFamily → not in any family
        { data: [], error: null }, // countUsedSeats: liveFamilyRows for owner-1 (just this invite doesn't show here since query re-reads fresh — see below)
        { data: { id: 'invite-1' }, error: null }, // update result
      ],
    })
    const result = await attachPendingInvitesForEmail(supabase as any, 'grandpa-1', 'grandpa@example.com')
    expect(result.attached).toBe(1)
    const updateCall = supabase.calls.find((c) => c.table === 'family_members' && c.method === 'update')
    expect(updateCall?.args[0]).toMatchObject({ member_learner_id: 'grandpa-1', status: 'active' })
  })

  it('is a no-op when there is no pending invite for this email', async () => {
    const supabase = fakeSupabase({ family_members: [{ data: [], error: null }] })
    const result = await attachPendingInvitesForEmail(supabase as any, 'nobody-1', 'nobody@example.com')
    expect(result.attached).toBe(0)
    expect(supabase.calls.some((c) => c.method === 'update')).toBe(false)
  })

  it('no silent steal: skips attaching when the learner is already a live member of another family', async () => {
    const supabase = fakeSupabase({
      family_members: [
        { data: [{ id: 'invite-1', owner_learner_id: 'owner-1' }], error: null }, // pending lookup
        { data: { id: 'existing-membership' }, error: null }, // isInAnyLiveFamily → TRUE, already in a family
      ],
    })
    const result = await attachPendingInvitesForEmail(supabase as any, 'already-in-family-1', 'x@example.com')
    expect(result.attached).toBe(0)
    expect(supabase.calls.some((c) => c.method === 'update')).toBe(false)
  })

  it('belt + braces: skips attaching when the owner\'s family is already at/over the seat cap', async () => {
    const supabase = fakeSupabase({
      family_members: [
        { data: [{ id: 'invite-1', owner_learner_id: 'owner-1' }], error: null }, // pending lookup
        { data: null, error: null }, // isInAnyLiveFamily → false
        // countUsedSeats → liveFamilyRows returns 6 rows → 1 + 6 = 7 > cap
        { data: Array.from({ length: 6 }, (_, i) => ({ id: `m${i}` })), error: null },
      ],
    })
    const result = await attachPendingInvitesForEmail(supabase as any, 'member-x', 'x@example.com')
    expect(result.attached).toBe(0)
    expect(supabase.calls.some((c) => c.method === 'update')).toBe(false)
  })
})
