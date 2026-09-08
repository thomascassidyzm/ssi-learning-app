/**
 * Effective-subscription resolver — FAMILY-PLAN-SPEC.md §3.
 *
 * "Own row first; else the family join." A member of a live SSi Family gets
 * the OWNER's subscription treated as their own for entitlement purposes —
 * with zero fan-out writes, so an owner's lapse/refund/re-buy composes
 * automatically through every call site with no extra plumbing.
 *
 * Own row takes priority whenever it exists, whatever its status — this
 * preserves today's exact behaviour for every non-family learner (each
 * caller already does its own isActive-style check on the returned row) and
 * matches the additive rule for a member who ALSO holds their own individual
 * Premium (spec §2.4): their own row is what resolves, family membership
 * changes nothing for them technically until they choose to cancel it.
 *
 * Two indexed point-lookups rather than one PostgREST embedded join: there's
 * no direct FK from family_members to subscriptions (both reference
 * learners.id independently), and the two queries hit the two indexes this
 * table already has (family_members_one_family on member_learner_id;
 * subscriptions' own learner_id uniqueness) — simpler and just as cheap as
 * fighting an embed hint for a table with no natural join path.
 *
 * THE 30-DAY GRACE (Tom, 2026-09-08). When the owner changes to Premium, a
 * member's cover does NOT end when the plan name flips: it runs for the rest
 * of the paid period and then 30 days more, per member, individually. That
 * tail is computed in one place — familyGrace.ts — and every consumer, from
 * this resolver to the dialog copy and the email, reads that one date.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { familyCoverEndsAt, withinFamilyGrace } from './familyGrace'

export interface SubscriptionRow {
  id: string
  learner_id: string
  status: string
  plan_id: string | null
  plan_name: string | null
  current_period_end: string | null
  cancel_at_period_end: boolean
  provider: string
  provider_subscription_id?: string | null
  scheduled_plan_name?: string | null
  scheduled_plan_at?: string | null
}

export interface EffectiveSubscriptionResult {
  /** The resolved row — the learner's own, or (viaFamily) the family owner's. */
  sub: SubscriptionRow | null
  /** True when `sub` is the owner's row, resolved via family membership. */
  viaFamily: boolean
  /**
   * When the FAMILY cover ends, computed once here so nothing downstream does
   * its own arithmetic (familyGrace.ts). For a member: the day their access
   * actually stops — the paid period plus the 30-day grace when the owner has
   * changed to Premium, or the paid period itself when the owner has
   * cancelled outright and nobody is left paying. Null while nothing is
   * ending, and always null for a learner on their own row.
   */
  coverEndsAt: string | null
}

/**
 * The fields this resolver needs on the OWNER's row whatever a caller asked
 * for — the plan name and the schedule are what decide whether a member is
 * covered at all, so they are read even when the caller only wanted a status.
 */
const OWNER_REQUIRED_COLUMNS = [
  'plan_name',
  'status',
  'current_period_end',
  'cancel_at_period_end',
  'scheduled_plan_name',
  'scheduled_plan_at',
]

function ownerColumns(columns: string): string {
  if (columns.trim() === '*') return '*'
  const asked = columns.split(',').map((c) => c.trim()).filter(Boolean)
  for (const needed of OWNER_REQUIRED_COLUMNS) if (!asked.includes(needed)) asked.push(needed)
  return asked.join(', ')
}

/**
 * Resolve the effective subscription for `learnerId`: their own subscriptions
 * row if one exists (any status — callers apply their own active/expiry
 * check, unchanged); otherwise, if they're a live ('active', not removed)
 * member of a family whose owner currently holds an active, unexpired
 * 'SSi Family' plan — or held one within the last FAMILY_GRACE_DAYS — the
 * owner's row.
 *
 * `columns` lets callers request only the fields they need (matches the
 * existing per-endpoint `.select(...)` shape at each call site) — pass '*'
 * for the full row.
 */
export async function resolveEffectiveSubscription(
  supabase: SupabaseClient,
  learnerId: string,
  columns: string = '*',
): Promise<EffectiveSubscriptionResult> {
  const { data: own } = await supabase
    .from('subscriptions')
    .select(columns)
    .eq('learner_id', learnerId)
    .maybeSingle()

  if (own) return { sub: own as unknown as SubscriptionRow, viaFamily: false, coverEndsAt: null }

  const { data: membership } = await supabase
    .from('family_members')
    .select('owner_learner_id')
    .eq('member_learner_id', learnerId)
    .eq('status', 'active')
    .is('removed_at', null)
    .maybeSingle()

  if (!membership?.owner_learner_id) return { sub: null, viaFamily: false, coverEndsAt: null }

  // NO plan_name PREDICATE ANY MORE, and that is the whole of the 30-day
  // grace (Tom, 2026-09-08). The query used to require 'SSi Family', so the
  // instant the renewal webhook wrote 'SSi Premium' every member went dark
  // with no tail. The plan name is now READ rather than filtered on, and a
  // row that has left Family still covers its members until the paid period
  // plus FAMILY_GRACE_DAYS — the date the copy shows them, from the same
  // function.
  const { data: ownerSub } = await supabase
    .from('subscriptions')
    .select(ownerColumns(columns))
    .eq('learner_id', membership.owner_learner_id)
    .eq('status', 'active')
    .maybeSingle()

  if (!ownerSub) return { sub: null, viaFamily: false, coverEndsAt: null }

  const row = ownerSub as any
  if (row.current_period_end && new Date(row.current_period_end).getTime() <= Date.now()) {
    return { sub: null, viaFamily: false, coverEndsAt: null } // owner's period has lapsed — grants nothing
  }

  const sub = ownerSub as unknown as SubscriptionRow

  if (row.plan_name === 'SSi Family') {
    // Live family. Something may still be ending: a scheduled change to
    // Premium ends the member's cover 30 days after the paid period, and an
    // outright cancellation ends it AT the paid period — there, nobody is
    // paying for anything afterwards, so there is no grace to give.
    const coverEndsAt =
      row.scheduled_plan_name && row.scheduled_plan_at
        ? familyCoverEndsAt(row.scheduled_plan_at)
        : row.cancel_at_period_end
          ? (row.current_period_end as string | null)
          : null
    return { sub, viaFamily: true, coverEndsAt }
  }

  // THE GRACE. The owner's row has left Family — the webhook applied the
  // scheduled change and, deliberately, left scheduled_plan_at behind as the
  // record of when the paid Family period ended. Members ride on for 30 days
  // from that date, then stop.
  if (withinFamilyGrace(row.scheduled_plan_at)) {
    return { sub, viaFamily: true, coverEndsAt: familyCoverEndsAt(row.scheduled_plan_at) }
  }

  return { sub: null, viaFamily: false, coverEndsAt: null }
}

/**
 * Convenience boolean for the common "is this learner covered right now?"
 * check — own row active, or covered via an active family.
 */
export async function isEffectivelySubscribed(
  supabase: SupabaseClient,
  learnerId: string,
): Promise<boolean> {
  const { sub } = await resolveEffectiveSubscription(supabase, learnerId, 'status, current_period_end')
  if (!sub) return false
  return (
    sub.status === 'active' &&
    (!sub.current_period_end || new Date(sub.current_period_end) > new Date())
  )
}
