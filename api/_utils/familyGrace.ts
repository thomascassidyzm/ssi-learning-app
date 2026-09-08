/**
 * WHEN A FAMILY MEMBER'S COVER ACTUALLY ENDS — the one place the arithmetic
 * happens (Tom's family identity model, 2026-09-08 01:50):
 *
 *   "Full access continues to the end of the paid period, PLUS 30 DAYS.
 *    Applies to every member individually, not just the owner."
 *
 * This supersedes #376·F D8 ("no grace discount, the end-of-period window is
 * the grace"), which the first build followed: the moment the renewal webhook
 * flipped plan_name away from 'SSi Family', every member went dark with no
 * tail at all.
 *
 * ONE DATE, DERIVED, NEVER STORED TWICE. The paid period's end is already on
 * the owner's row as `scheduled_plan_at` — written by change-plan when the
 * owner confirms, and (since this change) NOT cleared when the webhook applies
 * the flip, so it stays as the record of when Family cover ended. Everything
 * that needs the member's cutoff — the resolver that grants access, the
 * /api/subscription and /api/family responses, the dialog copy, the member
 * banner, the email — calls this function on that same date. Nothing else
 * anywhere adds 30 days to anything.
 */

/** Tom's ruling, 2026-09-08. The tail every displaced member gets. */
export const FAMILY_GRACE_DAYS = 30

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * The instant a member's cover ends, given the instant the paid Family period
 * ends (or ended). Null in, null out — nothing is ending, so there is no date
 * to show.
 */
export function familyCoverEndsAt(planEndsAt: string | null | undefined): string | null {
  if (!planEndsAt) return null
  const t = new Date(planEndsAt).getTime()
  if (!Number.isFinite(t)) return null
  return new Date(t + FAMILY_GRACE_DAYS * DAY_MS).toISOString()
}

/** True while `now` is still inside the grace that follows `planEndsAt`. */
export function withinFamilyGrace(planEndsAt: string | null | undefined, now: number = Date.now()): boolean {
  const ends = familyCoverEndsAt(planEndsAt)
  return !!ends && now < new Date(ends).getTime()
}
