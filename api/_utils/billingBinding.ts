/**
 * Shared predicates for the Paddle customer/subscription BINDING — the small
 * amount of logic that both the checkout-creation endpoint
 * (api/billing/bind-customer.ts) and the webhook (api/teacher/paddle-webhook.ts)
 * must agree on, kept in one place so they cannot drift.
 *
 * Everything here exists to serve one rule, which is Tom's binding condition on
 * A-123 (2026-08-16): **no legitimate node may lose access as a side effect of
 * closing the hijack.** So each predicate below is deliberately biased toward
 * "this node still holds something" — when we are unsure, we treat the node as
 * entitled and REFUSE to touch it, which costs a manual remediation rather than
 * somebody's dashboard.
 */

import { isPlatformActive } from './platformStatus'

/**
 * Does this school/org row currently hold a LIVE platform entitlement?
 *
 * Broader than `isPlatformActive` by exactly one state: `past_due`. A past-due
 * node is a live paying customer whose card is being retried — Paddle has not
 * finished with them, and neither should we. `isPlatformActive` correctly
 * returns false for past_due because it answers "may they use the dashboard
 * right now"; this answers the different question "would rebinding or
 * overwriting this row's billing take something away from someone", and for a
 * past-due row the honest answer is yes.
 *
 * NULL / absent status fails OPEN (entitled), exactly as `isPlatformActive`
 * does, so a legacy or pre-migration row is protected rather than exposed.
 */
export function holdsLivePlatformEntitlement(
  status: string | null | undefined,
  expiresAt: string | null | undefined,
): boolean {
  if (status === 'past_due') return true
  return isPlatformActive(status, expiresAt)
}

/**
 * Would binding `incomingSubscriptionId` to this row STEAL a live binding from
 * another subscription?
 *
 * True when the row already carries a DIFFERENT subscription id and is still
 * entitled through it. That is the exact shape of the SEC15-01 hijack — the
 * attacker's brand-new subscription id landing on a row that a legitimate
 * subscription already owns — and it is also the shape of an honest accident
 * (a school that double-buys). Both want the same answer: refuse the write,
 * log for manual remediation, change nothing.
 *
 * A row with no subscription id is NOT protected by this — that is a trial or
 * unsubscribed node taking out its first subscription, which is the normal
 * upgrade path and must keep working.
 */
export function wouldStealLiveBinding(params: {
  existingSubscriptionId: string | null | undefined
  incomingSubscriptionId: string | null | undefined
  status: string | null | undefined
  expiresAt: string | null | undefined
}): boolean {
  const existing = params.existingSubscriptionId || null
  const incoming = params.incomingSubscriptionId || null
  if (!existing) return false
  if (existing === incoming) return false
  return holdsLivePlatformEntitlement(params.status, params.expiresAt)
}
