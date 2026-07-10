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
 */

import type { SupabaseClient } from '@supabase/supabase-js'

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
}

export interface EffectiveSubscriptionResult {
  /** The resolved row — the learner's own, or (viaFamily) the family owner's. */
  sub: SubscriptionRow | null
  /** True when `sub` is the owner's row, resolved via family membership. */
  viaFamily: boolean
}

/**
 * Resolve the effective subscription for `learnerId`: their own subscriptions
 * row if one exists (any status — callers apply their own active/expiry
 * check, unchanged); otherwise, if they're a live ('active', not removed)
 * member of a family whose owner currently holds an active, unexpired
 * 'SSi Family' plan, the owner's row.
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

  if (own) return { sub: own as unknown as SubscriptionRow, viaFamily: false }

  const { data: membership } = await supabase
    .from('family_members')
    .select('owner_learner_id')
    .eq('member_learner_id', learnerId)
    .eq('status', 'active')
    .is('removed_at', null)
    .maybeSingle()

  if (!membership?.owner_learner_id) return { sub: null, viaFamily: false }

  // The plan_name predicate matters (spec §3): if the owner's row later
  // becomes something else (downgrade to plain Premium), members correctly
  // stop resolving via family — they'd need their own subscription.
  const { data: ownerSub } = await supabase
    .from('subscriptions')
    .select(columns)
    .eq('learner_id', membership.owner_learner_id)
    .eq('plan_name', 'SSi Family')
    .eq('status', 'active')
    .maybeSingle()

  if (!ownerSub) return { sub: null, viaFamily: false }

  const row = ownerSub as any
  if (row.current_period_end && new Date(row.current_period_end).getTime() <= Date.now()) {
    return { sub: null, viaFamily: false } // owner's period has lapsed — grants nothing
  }

  return { sub: ownerSub as unknown as SubscriptionRow, viaFamily: true }
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
