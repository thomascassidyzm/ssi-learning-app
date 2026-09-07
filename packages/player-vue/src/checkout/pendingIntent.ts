/**
 * THE PLAN SOMEBODY CHOSE, KEPT SAFE ACROSS THE EMAIL ROUND-TRIP.
 *
 * WHY THIS EXISTS (Tom, 2026-09-07, ruling on the purchase flow):
 *
 *   "the payment thing was designed to not make it a ball ache to force people
 *    to sign up and verify before they paid ... once they then verify their
 *    account by emailed code, it should take them straight back to the payment
 *    page they previously clicked on"
 *
 * THE BALL-ACHE HE WAS AVOIDING WAS LOSING YOUR PLACE, not the verification.
 * So the verification can come back, as long as the plan comes back with it.
 *
 * Until this file, the chosen plan lived only in module-level `ref`s in
 * useCheckout — in memory. That survives typing a code into a modal in the same
 * tab, and NOTHING ELSE. It does not survive a reload, and on a phone it does
 * not reliably survive switching to the mail app and back, because a
 * backgrounded PWA is routinely torn down and re-launched. That is precisely
 * the moment this flow now depends on, so the intent is written down.
 *
 * localStorage rather than sessionStorage, deliberately: sessionStorage is
 * per-tab, and reading your mail can easily mean a new tab.
 *
 * IT EXPIRES. A plan chosen last week is not an intention, it is litter — and
 * silently opening a checkout somebody forgot they started is worse than
 * showing them the plans again. An hour is generous for "go and read an email"
 * and short enough that it never surprises anybody.
 */

/** One key, one shape, one place that knows the name. */
const KEY = 'ssi_checkout_intent_v1'

/** Long enough to go and find an email, short enough never to surprise. */
export const INTENT_TTL_MS = 60 * 60 * 1000

export interface CheckoutIntent {
  plan: 'premium' | 'family'
  billingPeriod: 'monthly' | 'annual'
  /** The course they were unlocking, carried through for attribution. */
  courseCode: string | null
  /** The address the code was sent to, so the verify step survives a reload too. */
  email: string | null
  /** Epoch ms. The freshness clock. */
  savedAt: number
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
 * Remember what they chose. Called the moment a signed-out person picks a
 * price — BEFORE anything can go wrong, because the whole point is that it
 * survives whatever happens next.
 */
export function savePendingIntent(
  intent: Omit<CheckoutIntent, 'savedAt'>,
  now: number = Date.now(),
): void {
  const s = storage()
  if (!s) return
  try {
    s.setItem(KEY, JSON.stringify({ ...intent, savedAt: now }))
  } catch {
    // A full or refusing store must never break a purchase. The in-memory refs
    // still carry the intent for anyone who stays in the tab.
  }
}

/** Update just the address, once we know where the code went. */
export function rememberIntentEmail(email: string, now: number = Date.now()): void {
  const existing = readPendingIntent(now)
  if (!existing) return
  savePendingIntent({ ...existing, email }, existing.savedAt)
}

/**
 * What they chose, or null if there is nothing fresh to act on.
 *
 * Refuses on any doubt — absent, unparseable, wrong shape, or stale. A
 * half-read intent must never open a checkout: opening the WRONG plan takes
 * real money for the wrong thing, so anything less than a clean read is
 * treated as no intent at all.
 */
export function readPendingIntent(now: number = Date.now()): CheckoutIntent | null {
  const s = storage()
  if (!s) return null
  try {
    const raw = s.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<CheckoutIntent>
    if (parsed?.plan !== 'premium' && parsed?.plan !== 'family') return null
    if (parsed?.billingPeriod !== 'monthly' && parsed?.billingPeriod !== 'annual') return null
    if (typeof parsed.savedAt !== 'number' || !Number.isFinite(parsed.savedAt)) return null
    const age = now - parsed.savedAt
    // A future-dated intent is a moved clock, not an intention. Refuse it.
    if (age < 0 || age > INTENT_TTL_MS) return null
    return {
      plan: parsed.plan,
      billingPeriod: parsed.billingPeriod,
      courseCode: typeof parsed.courseCode === 'string' ? parsed.courseCode : null,
      email: typeof parsed.email === 'string' ? parsed.email : null,
      savedAt: parsed.savedAt,
    }
  } catch {
    return null
  }
}

/** Spend it. Called once the checkout has actually opened, so a resume can
 *  never fire twice for one decision. */
export function clearPendingIntent(): void {
  const s = storage()
  if (!s) return
  try {
    s.removeItem(KEY)
  } catch {
    /* nothing to do and nothing worth breaking a purchase over */
  }
}
