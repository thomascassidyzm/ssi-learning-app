/**
 * A PURCHASE IN FLIGHT, WRITTEN DOWN.
 *
 * WHY THIS EXISTS (Tom, 2026-09-07, walked live with his own £25):
 *
 *   "its a shitty process, race condition, looks like nothing has happened,
 *    then spins endlessly"
 *
 * He bought SSi Family on staging. Paddle took the money and emailed him a
 * confirmation. For several minutes the app showed him NOTHING — Settings still
 * offered him the Upgrade row, as though he had no subscription at all — and a
 * second attempt put him in an endless spinner. It then resolved on its own.
 *
 * So the money path works. What was missing is any record, anywhere in the
 * client, that a purchase had HAPPENED but not yet LANDED. Without one there
 * are only two states — subscribed and not-subscribed — and a person who has
 * just paid spends the gap in the second one, being sold the thing they have
 * already bought. That inversion is the whole defect.
 *
 * This file is the third state. It is deliberately the smallest possible
 * thing: a JSON record in localStorage saying what was bought, when, and with
 * which Paddle transaction id.
 *
 * localStorage, not memory and not sessionStorage:
 *   • memory dies on the Paddle success redirect, which is a full page load;
 *   • sessionStorage is per-tab, and a phone killing a backgrounded PWA is
 *     exactly the case Tom's "survive a reload" requirement is about.
 * Same reasoning, and the same shape, as pendingIntent.ts next door — that one
 * carries a purchase somebody has DECIDED on, this one carries a purchase
 * somebody has PAID for. Two different moments, two different records.
 *
 * IT EXPIRES. A day is far longer than any webhook has ever taken and short
 * enough that a record orphaned by some failure we have not thought of cannot
 * hold a learner in a waiting screen forever. On expiry the app simply returns
 * to what it can prove: whatever /api/subscription says.
 */

/** One key, one shape, one place that knows the name. */
const KEY = 'ssi_pending_purchase_v1'

/** Far longer than any webhook, short enough that an orphan cannot trap anybody. */
export const PENDING_PURCHASE_TTL_MS = 24 * 60 * 60 * 1000

export interface PendingPurchase {
  plan: 'premium' | 'family'
  billingPeriod: 'monthly' | 'annual'
  /** Paddle's own id for the payment, when we have it. Shown to the buyer in
   *  the slow case so a support message carries the one fact we need. */
  transactionId: string | null
  /** Epoch ms — the moment the money was taken. The clock the waiting state
   *  counts from, so it stays honest across a reload. */
  paidAt: number
}

function storage(): Storage | null {
  try {
    // Private-mode Safari throws on access, not on use. Touch it here so every
    // caller below can assume a usable object or null.
    const s = window.localStorage
    const probe = '__ssi_probe__'
    s.setItem(probe, '1')
    s.removeItem(probe)
    return s
  } catch {
    return null
  }
}

/**
 * The money has been taken. Write it down BEFORE anything else happens —
 * Paddle's success redirect tears the page down within moments of the event
 * that calls this, and the record is what greets the buyer on the other side.
 *
 * Idempotent by design: called from Paddle's own checkout.completed event AND
 * again on the success landing, because either one may be the only one we get.
 * A second call with no transaction id must never erase the id the first call
 * captured, and must never restart the clock.
 */
export function savePendingPurchase(
  purchase: Omit<PendingPurchase, 'paidAt'> & { paidAt?: number },
  now: number = Date.now(),
): void {
  const s = storage()
  if (!s) return
  const existing = readPendingPurchase(now)
  const record: PendingPurchase = {
    plan: purchase.plan,
    billingPeriod: purchase.billingPeriod,
    transactionId: purchase.transactionId ?? existing?.transactionId ?? null,
    paidAt: purchase.paidAt ?? existing?.paidAt ?? now,
  }
  try {
    s.setItem(KEY, JSON.stringify(record))
  } catch {
    // A full or refusing store must never break the moment after a payment.
    // The in-memory state in usePendingPurchase still carries this session.
  }
}

/**
 * What is in flight, or null if there is nothing fresh.
 *
 * Refuses on any doubt — absent, unparseable, wrong shape, stale, or dated in
 * the future. A half-read record must never hold somebody in a waiting screen,
 * because the waiting screen deliberately hides the ordinary app.
 */
export function readPendingPurchase(now: number = Date.now()): PendingPurchase | null {
  const s = storage()
  if (!s) return null
  try {
    const raw = s.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<PendingPurchase>
    if (parsed?.plan !== 'premium' && parsed?.plan !== 'family') return null
    if (parsed?.billingPeriod !== 'monthly' && parsed?.billingPeriod !== 'annual') return null
    if (typeof parsed.paidAt !== 'number' || !Number.isFinite(parsed.paidAt)) return null
    const age = now - parsed.paidAt
    if (age < 0 || age > PENDING_PURCHASE_TTL_MS) return null
    return {
      plan: parsed.plan,
      billingPeriod: parsed.billingPeriod,
      transactionId: typeof parsed.transactionId === 'string' ? parsed.transactionId : null,
      paidAt: parsed.paidAt,
    }
  } catch {
    return null
  }
}

/** The subscription arrived, or the buyer dismissed the waiting state. Either
 *  way the purchase is no longer in flight. */
export function clearPendingPurchase(): void {
  const s = storage()
  if (!s) return
  try {
    s.removeItem(KEY)
  } catch {
    /* nothing to do and nothing worth breaking anything over */
  }
}
