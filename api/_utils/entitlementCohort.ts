/**
 * The money-side fact — api/_utils/entitlementCohort.ts
 * =====================================================
 *
 * Tom's ruling of 2026-09-10 separates two facts that were being carried on one
 * flag: **did they pay** and **are they a real person learning**. The second
 * lives in api/_utils/realLearnerPopulation.ts and decides who counts. This file
 * is the first one, and it decides NOTHING about counting — it exists so that
 * gifted learners are VISIBLE as a cohort, which is intelligence Tom asked for:
 * how comped and pilot learners behave is a real question, and the answer is
 * only available if they are in the numbers in the first place.
 *
 *   paying  — a live subscription. The money side expects money and gets it.
 *   gifted  — no live subscription, but they hold live access: an admin gift, an
 *             entitlement code, an org's free year, a school's cover. The money
 *             side expects nothing, deliberately.
 *   free    — neither. On the free preview, or a trial, or simply not paying.
 *
 * WHY THIS NEEDS NO MIGRATION AND NO NEW COLUMN. Both facts are already in the
 * database: `subscriptions` is the money side, `user_entitlements` is the access
 * side. Deriving the cohort from them costs one read each, covers every gift
 * ever made rather than only ones minted after today, and cannot drift from the
 * truth the way a hand-set status column would.
 *
 * WHAT IT DOES NOT SEE, stated rather than papered over: the DERIVED
 * entitlement layers in api/_utils/resolveEntitlements.ts — the cascade RPC,
 * class coverage, org coverage, school-staff coverage — have no row in
 * `user_entitlements` at all. A learner whose access comes only from their
 * school's cover reads here as `free`. That is an undercount of `gifted`, never
 * an overcount, and resolving four derived layers per learner across a whole
 * population is a per-person query, not a cohort read. When the cohort matters
 * more than it costs, the fix is to widen this file, not to filter in a page.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export type MoneyStanding = 'paying' | 'gifted' | 'free'

/** Subscription statuses that mean the money side is expecting payment. */
const PAYING_STATUSES = ['active', 'past_due'] as const

export function isPayingStatus(status: string | null | undefined): boolean {
  if (!status) return false
  return (PAYING_STATUSES as readonly string[]).includes(status)
}

/**
 * The rule itself, as one pure function. Paying wins over gifted: somebody who
 * pays AND holds an old comp is a paying learner, because that is what the
 * money side sees.
 */
export function classifyStanding(paying: boolean, holdsLiveEntitlement: boolean): MoneyStanding {
  if (paying) return 'paying'
  if (holdsLiveEntitlement) return 'gifted'
  return 'free'
}

export interface StandingCounts {
  paying: number
  gifted: number
  free: number
}

export function countStandings(standings: Iterable<MoneyStanding>): StandingCounts {
  const counts: StandingCounts = { paying: 0, gifted: 0, free: 0 }
  for (const s of standings) counts[s] += 1
  return counts
}

/**
 * Resolve the standing of every learner named. Takes a service-role client.
 *
 * Fail-soft in the honest direction: a read that fails leaves that side of the
 * question unanswered, which reads as `free` — it never invents a gift and
 * never invents a payment.
 */
export async function resolveMoneyStandings(
  svc: SupabaseClient,
  learnerIds: Iterable<string>,
  now: Date = new Date(),
): Promise<Map<string, MoneyStanding>> {
  const ids = [...new Set(learnerIds)]
  const standings = new Map<string, MoneyStanding>()
  if (!ids.length) return standings

  const [{ data: subs }, { data: ents }] = await Promise.all([
    svc.from('subscriptions').select('learner_id, status').in('learner_id', ids),
    svc.from('user_entitlements').select('learner_id, expires_at').in('learner_id', ids),
  ])

  const paying = new Set<string>()
  for (const s of (subs ?? []) as { learner_id: string; status: string | null }[]) {
    if (isPayingStatus(s.status)) paying.add(s.learner_id)
  }

  const entitled = new Set<string>()
  for (const e of (ents ?? []) as { learner_id: string; expires_at: string | null }[]) {
    // An expired entitlement unlocks nothing — the same reading
    // api/_utils/resolveEntitlements.ts does, kept deliberately identical.
    if (e.expires_at && new Date(e.expires_at) <= now) continue
    entitled.add(e.learner_id)
  }

  for (const id of ids) standings.set(id, classifyStanding(paying.has(id), entitled.has(id)))
  return standings
}
