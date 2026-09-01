/**
 * SEC0901-B — api/_utils/schoolSeats.ts, money-adjacent seat counting.
 *
 * isSchoolSeatCapReached is called from api/code/redeem.ts with a schoolId
 * that is ALWAYS resolved server-side (inviteRow.grants_school_id, or a
 * class row's school_id looked up by inviteRow.grants_class_id — never
 * req.body directly; see redeem.ts around the ADMIN-ENT-05 comment). This
 * file pins: the cap only bites a genuinely seat-billed school (never the
 * DEFAULT 1 a free/trial school carries), fails open on a DB error (revenue
 * protection, not an access boundary — by design, per the file's own
 * docstring), and cannot be under- or over-counted by a caller-controlled
 * schoolId shape (null/undefined/empty handled before any query).
 *
 * All SECURE-ASSERTION. One PLAUSIBLE, not proven here (see the finding in
 * the report): isSchoolSeatCapReached is read-then-decide with no advisory
 * lock or unique constraint backing it, so concurrent redemptions at the
 * exact seat boundary could both read "not full" and both insert — a TOCTOU
 * over-provisioning race. That is a property of the CALLER (redeem.ts's
 * insert timing), not of this pure function, so it is not asserted here;
 * proving it needs a concurrency harness against redeem.ts, out of scope for
 * this file's unit-level coverage.
 */
import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { isSchoolSeatCapReached, seatCapMessage } from './schoolSeats'

function fakeSupabase(opts: {
  school?: Record<string, unknown> | null
  schoolError?: unknown
  teacherIds?: string[]
}): SupabaseClient {
  return {
    from: (table: string) => {
      if (table === 'schools') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: opts.school ?? null, error: opts.schoolError ?? null }),
            }),
          }),
        }
      }
      if (table === 'user_tags') {
        return { select: () => ({ eq: () => ({ eq: () => ({ in: () => ({ is: async () => ({ data: [], error: null }) }) }) }) }) }
      }
      if (table === 'classes') {
        return { select: () => ({ eq: () => ({ eq: async () => ({ data: [], error: null }) }) }) }
      }
      return { select: () => ({ eq: async () => ({ data: [], error: null }) }) }
    },
  } as unknown as SupabaseClient
}

describe('SEC0901-B — isSchoolSeatCapReached: only bites a genuinely seat-billed school', () => {
  it('returns open (no cap) for a school with no provider_subscription_id — the DEFAULT 1 is not a purchase', async () => {
    const svc = fakeSupabase({
      school: { teacher_seats: 1, platform_status: 'active', provider_subscription_id: null },
    })
    const state = await isSchoolSeatCapReached(svc, 'school-1')
    expect(state).toEqual({ full: false, seats: null, used: null })
  })

  it('returns open for a school with a subscription id but a non-billed platform_status (e.g. canceled)', async () => {
    const svc = fakeSupabase({
      school: { teacher_seats: 1, platform_status: 'canceled', provider_subscription_id: 'sub_123' },
    })
    const state = await isSchoolSeatCapReached(svc, 'school-1')
    expect(state).toEqual({ full: false, seats: null, used: null })
  })

  it('caps a genuinely billed, active school once staff count reaches teacher_seats', async () => {
    // admin_user_id is the one staff member resolveSchoolTeacherUserIds finds
    // with no user_tags/classes rows present — full at exactly 1 used of 1 seat.
    const svcAtCap = fakeSupabase({
      school: { teacher_seats: 1, platform_status: 'active', provider_subscription_id: 'sub_123', admin_user_id: 'admin-1' },
    })
    const state = await isSchoolSeatCapReached(svcAtCap, 'school-1')
    expect(state.full).toBe(true)
    expect(state.seats).toBe(1)
    expect(state.used).toBe(1)
  })

  it('does not cap a billed school with headroom left', async () => {
    const svc = fakeSupabase({
      school: { teacher_seats: 5, platform_status: 'past_due', provider_subscription_id: 'sub_123', admin_user_id: 'admin-1' },
    })
    const state = await isSchoolSeatCapReached(svc, 'school-1')
    expect(state.full).toBe(false)
    expect(state.used).toBe(1)
    expect(state.seats).toBe(5)
  })
})

describe('SEC0901-B — fails OPEN, never traps a legitimate teacher out on a blip', () => {
  it('a DB read error returns open, not full', async () => {
    const svc = fakeSupabase({ school: null, schoolError: { message: 'connection reset' } })
    const state = await isSchoolSeatCapReached(svc, 'school-1')
    expect(state.full).toBe(false)
  })

  it('a missing school row (maybeSingle -> null, no error) returns open', async () => {
    const svc = fakeSupabase({ school: null })
    const state = await isSchoolSeatCapReached(svc, 'school-1')
    expect(state.full).toBe(false)
  })

  it('a thrown exception inside the try block is swallowed to open, not propagated', async () => {
    const throwing = {
      from: () => {
        throw new Error('boom')
      },
    } as unknown as SupabaseClient
    const state = await isSchoolSeatCapReached(throwing, 'school-1')
    expect(state).toEqual({ full: false, seats: null, used: null })
  })
})

describe('SEC0901-B — schoolId edge cases never reach a query', () => {
  it('null/undefined/empty schoolId short-circuits to open without calling supabase', async () => {
    let called = false
    const svc = {
      from: () => {
        called = true
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }
      },
    } as unknown as SupabaseClient

    for (const bad of [null, undefined, '']) {
      called = false
      const state = await isSchoolSeatCapReached(svc, bad as any)
      expect(state.full).toBe(false)
      expect(called).toBe(false)
    }
  })
})

describe('SEC0901-B — the refusal message never overstates what happened', () => {
  it('names the exact seat count, not a vague "school is full"', () => {
    const msg = seatCapMessage({ full: true, seats: 3, used: 3 })
    expect(msg).toContain('3')
    expect(msg).toMatch(/teacher seats/)
  })
})
