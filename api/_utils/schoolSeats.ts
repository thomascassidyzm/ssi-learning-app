/**
 * schoolSeats — is this school out of PAID teacher seats?
 *
 * ADMIN-ENT-05 (2026-08-25): `schools.teacher_seats` is the Paddle quantity on
 * the £15/teacher/mo per-seat price. Billing wrote it, the dashboard displayed
 * it, and NO join path ever compared against it — so a school paying for one
 * seat could onboard unlimited teachers through its join code. The family plan
 * has always enforced its cap server-side (api/family/invite.ts's
 * `Family is full`); this is the same enforcement for the school lane.
 *
 * WHAT IT DELIBERATELY DOES NOT DO — and why:
 *
 *   `teacher_seats` is `integer DEFAULT 1 NOT NULL`, so EVERY school row carries
 *   a 1 whether or not anyone ever bought a seat. Enforcing on the bare column
 *   would lock the second teacher out of every trial school, every free-track
 *   school and every pre-billing school in the estate — which is a product
 *   change, not a security fix. So the cap only bites where the number means
 *   what its column comment says: a school with a live per-seat subscription
 *   (`provider_subscription_id` set, `platform_status` active or in dunning).
 *   Everywhere else the seat count is a default, and this returns "not full".
 *
 * Fails OPEN on a read error: a DB blip must never wedge a legitimate teacher
 * out of a school they were invited to. The cap is revenue protection, not an
 * access-control boundary.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { countSchoolTeachers } from './schoolTeachers'

/** Platform statuses under which the billed seat count is authoritative. */
const BILLED_STATUSES = ['active', 'past_due']

export interface SchoolSeatState {
  /** True when one more staff member would exceed the paid seat count. */
  full: boolean
  /** Paid seats, when the cap applies; null when the school isn't seat-billed. */
  seats: number | null
  /** Current staff count, when the cap applies. */
  used: number | null
}

/**
 * Would adding ONE more staff member to this school exceed its paid seats?
 *
 * `schoolId` must already have been resolved from a trusted source (an invite
 * row, a class row) — never straight from a request body.
 */
export async function isSchoolSeatCapReached(
  svc: SupabaseClient,
  schoolId: string | null | undefined,
): Promise<SchoolSeatState> {
  const open: SchoolSeatState = { full: false, seats: null, used: null }
  if (!schoolId) return open

  try {
    const { data, error } = await svc
      .from('schools')
      .select('teacher_seats, platform_status, provider_subscription_id')
      .eq('id', schoolId)
      .maybeSingle()
    if (error || !data) return open

    const school = data as unknown as {
      teacher_seats?: number | null
      platform_status?: string | null
      provider_subscription_id?: string | null
    }

    // Not seat-billed → the DEFAULT 1 is not a purchase. No cap.
    if (!school.provider_subscription_id) return open
    if (!BILLED_STATUSES.includes(school.platform_status || '')) return open

    const seats = typeof school.teacher_seats === 'number' ? school.teacher_seats : 0
    if (seats <= 0) return open

    const used = await countSchoolTeachers(svc, schoolId)
    return { full: used >= seats, seats, used }
  } catch {
    return open
  }
}

/** The learner-facing refusal, so both call sites word it identically. */
export function seatCapMessage(state: SchoolSeatState): string {
  return `This school has used all ${state.seats} of its teacher seats. Ask the school admin to add a seat.`
}
