/**
 * Change Plan - POST /api/subscription/change-plan
 *
 * Auth required. Moves the authenticated learner's OWN live subscription from
 * SSi Premium to SSi Family IN PLACE — the same Paddle subscription, a
 * different price. Paddle prorates: the unused remainder of the £15 period is
 * credited against the £25 and the difference is charged now, and the billing
 * anniversary is preserved. There is no cancel and no gap in access.
 *
 * WHY IN PLACE, NOT A SECOND CHECKOUT. Until this endpoint existed, a Premium
 * subscriber who tapped Family opened a SECOND, independent Paddle
 * subscription: £15 + £25 a month, two live subscriptions, and no Family plan
 * at all, because the webhook's wouldStealLiveSubscriptionRow() correctly
 * refuses to repoint a live row at a different subscription id (#255). The
 * in-app door was therefore closed with an "already subscribed" notice. This
 * is the door reopened as the right operation.
 *
 * The mechanic is the one the seat lanes already use (api/school/update-seats.ts,
 * api/org/update-seats.ts): read the live subscription, then
 * paddle.subscriptions.update with the new item and a prorationBillingMode.
 * Those two only ever vary quantity; this one varies the priceId.
 *
 * PRICE IDS ARE SERVER-SIDE ONLY. The browser may ask for monthly or annual;
 * it may never name a price. The family price ids come from the same env the
 * webhook's PRICE_CATALOG reads.
 *
 * The plan_name mirror written here is OPTIMISTIC so the UI reflects the new
 * plan at once; the subscription.updated webhook converges on the
 * authoritative value (same pattern as update-seats).
 *
 * THE DOWNGRADE, plan:'premium' (job #376·F, D2/D9; built by #383·F). Paddle
 * cannot schedule a price change for the period end — scheduled_change holds
 * only cancel, pause and resume — so the end-of-period change is held by US.
 * We write scheduled_plan_name='SSi Premium' and scheduled_plan_at=
 * current_period_end on the owner's row FIRST, then move Paddle's price onto
 * Premium with do_not_bill. Paddle's items change now, no money moves, the
 * next renewal bills £15, and our row keeps plan_name='SSi Family' until the
 * renewal webhook sees a billing period that starts on or after
 * scheduled_plan_at (paddle-webhook.ts, handlePlanChangeOnHeldSubscription).
 * Every member is covered for exactly what was paid; the delay is the window
 * in which every displaced person can act. do_not_bill never meets Paddle's
 * 55p refusal and there is no refund arithmetic to go wrong.
 *
 * Nobody is removed by a downgrade, ever (D5): this endpoint touches the
 * owner's row only. Displaced adults are told at confirm, by email, with
 * their own door in it (D6). "Keep Family" (D9) is plan:'family' on a row
 * with a pending schedule: clear the two columns, move Paddle back onto the
 * Family price with do_not_bill — the period was paid at £25 either way.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { verifyAuthToken } from '../_utils/auth'
import { paddle } from '../_utils/paddle'
import { applyCors } from '../_utils/cors'
import { liveFamilyRows } from '../_utils/familyMembership'
import { safeInviterName, sendFamilyEndsEmail } from '../_utils/familyInviteEmail'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

// Trailing newlines from a pasted env value are a known biter in this repo.
function familyPriceId(period: 'monthly' | 'annual'): string {
  const raw =
    period === 'annual'
      ? process.env.VITE_PADDLE_FAMILY_PRICE_ANNUAL
      : process.env.VITE_PADDLE_FAMILY_PRICE_MONTHLY
  return (raw || '').trim()
}

// The SSi Premium prices, the same two ids PRICE_CATALOG (paddle-webhook.ts)
// and the client (lib/paddle.ts) already carry; env first, in-repo fallback.
const SSI_PREMIUM_MONTHLY_PRICE_ID = 'pri_01kqq85gvncyasfmfvvpcv1xfg'
const SSI_PREMIUM_ANNUAL_PRICE_ID = 'pri_01kqq86ymc3yhm8be3w7f7kgr1'
function premiumPriceId(period: 'monthly' | 'annual'): string {
  const raw =
    period === 'annual'
      ? process.env.VITE_PADDLE_TEACHER_PRICE_ANNUAL
      : process.env.VITE_PADDLE_TEACHER_PRICE_MONTHLY
  return (raw || '').trim() || (period === 'annual' ? SSI_PREMIUM_ANNUAL_PRICE_ID : SSI_PREMIUM_MONTHLY_PRICE_ID)
}

// Only a plain Premium subscriber may take this door. The tutor bundle is a
// different product with a dashboard grant hanging off it, and a family MEMBER
// ('SSi Family (member)' — a virtual name, they own no row) has nothing to
// change. Both are refused rather than half-handled.
const UPGRADEABLE_PLAN_NAMES = new Set(['SSi Premium'])

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  if (applyCors(req, res, { methods: 'POST' })) return

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const authResult = await verifyAuthToken(req)
  if (!authResult.valid || !authResult.userId) {
    res.status(401).json({ error: authResult.error || 'Unauthorized' })
    return
  }

  const body = (typeof req.body === 'string' ? safeParse(req.body) : req.body) || {}
  const targetPlan = String(body.plan || 'family')
  if (targetPlan !== 'family' && targetPlan !== 'premium') {
    res.status(400).json({ error: 'Only a change to SSi Family or SSi Premium is supported' })
    return
  }
  const requestedPeriod =
    body.billingPeriod === 'annual' ? 'annual' : body.billingPeriod === 'monthly' ? 'monthly' : null

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  try {
    const { data: learner } = await supabase
      .from('learners')
      .select('id')
      .eq('user_id', authResult.userId)
      .maybeSingle()

    if (!learner) {
      res.status(404).json({ error: 'No active subscription' })
      return
    }

    // Own row only — resolved from the caller's own learner id, never from
    // anything the browser sent. This is what makes "only the owner may
    // change it" true by construction rather than by a check.
    const { data: sub } = await supabase
      .from('subscriptions')
      .select('id, provider_subscription_id, status, plan_name, current_period_end, cancel_at_period_end, scheduled_plan_name, scheduled_plan_at')
      .eq('learner_id', learner.id)
      .maybeSingle()

    if (!sub?.provider_subscription_id) {
      res.status(404).json({ error: 'No active subscription' })
      return
    }

    if (targetPlan === 'premium') {
      await scheduleDowngradeToPremium(supabase, learner.id, sub, requestedPeriod, res)
      return
    }

    // KEEP FAMILY (D9): a Family row with a pending change back to what it
    // already is. One tap, one Paddle write, no money.
    if (sub.plan_name === 'SSi Family' && sub.scheduled_plan_name) {
      await keepFamily(supabase, sub, res)
      return
    }

    if (sub.plan_name === 'SSi Family') {
      res.status(200).json({ ok: true, alreadyOnPlan: true, planName: 'SSi Family' })
      return
    }

    if (!UPGRADEABLE_PLAN_NAMES.has(sub.plan_name || '')) {
      res.status(409).json({ error: 'This subscription cannot be changed to SSi Family in the app' })
      return
    }

    if (sub.status !== 'active') {
      res.status(409).json({
        error:
          sub.status === 'past_due'
            ? 'Resolve the outstanding payment before changing your plan'
            : 'Your subscription is not active, so it cannot be changed',
      })
      return
    }

    // Read the live subscription so the billing period comes from Paddle
    // rather than from us guessing — an annual Premium payer must land on
    // annual Family, not be quietly moved onto a monthly cycle.
    const live = await paddle.subscriptions.get(sub.provider_subscription_id)
    const liveInterval = live.items?.[0]?.price?.billingCycle?.interval
    const period: 'monthly' | 'annual' =
      requestedPeriod || (liveInterval === 'year' ? 'annual' : 'monthly')

    const priceId = familyPriceId(period)
    if (!priceId) {
      console.error('[subscription/change-plan] Family price not configured for period:', period)
      res.status(503).json({ error: 'The Family plan is not available yet' })
      return
    }

    if (live.items?.[0]?.price?.id === priceId) {
      res.status(200).json({ ok: true, alreadyOnPlan: true, planName: 'SSi Family' })
      return
    }

    // A Paddle-managed trial cannot be prorated; an upgrade charges the delta
    // now. Same rules the seat lanes already run on.
    const prorationBillingMode = live.status === 'trialing' ? 'do_not_bill' : 'prorated_immediately'

    // THE LAST-FEW-DAYS CASE. Verified against the live Paddle API on
    // 2026-09-07, on a real Premium subscription two days from renewal: the
    // prorated £15 → £25 delta came to 53p, Paddle's minimum chargeable amount
    // is 55p, and it REFUSED the whole update with
    // subscription_update_transaction_balance_less_than_charge_limit. Not a
    // charge that fails — the plan change never happens at all, and the payer
    // sees a 500. prorated_next_billing_period fails identically; only
    // do_not_bill is accepted.
    //
    // So when, and only when, Paddle says the delta is too small to bill, we
    // ask again without billing it. The concession is bounded by construction:
    // it is at most Paddle's own minimum, well under a pound, and it buys a
    // £25/month conversion that would otherwise dead-end. Everything that
    // succeeds today is untouched — this branch runs only where the
    // alternative is an error.
    const { updated, prorationBillingModeUsed } = await updateWithSmallProrationFallback(
      sub.provider_subscription_id,
      priceId,
      prorationBillingMode
    )

    // Optimistic mirror; the subscription.updated webhook re-applies the same
    // absolute values (idempotent convergence).
    await supabase
      .from('subscriptions')
      .update({
        plan_name: 'SSi Family',
        plan_id: updated.items?.[0]?.price?.id || priceId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', sub.id)

    res.status(200).json({
      ok: true,
      planName: 'SSi Family',
      billingPeriod: period,
      status: updated.status,
      // What ACTUALLY ran, not what we asked for — the fallback below can
      // change it, and a money endpoint that misreports itself is a trap for
      // whoever reads the response next.
      prorationBillingMode: prorationBillingModeUsed,
    })
  } catch (err: any) {
    // Surface the common Paddle states in language the payer can act on.
    const code = err?.code || err?.error?.code || ''
    const message: string = err?.message || err?.detail || 'Failed to change plan'
    if (/past_due/i.test(code) || /past_due/i.test(message)) {
      res.status(409).json({ error: 'Resolve the outstanding payment before changing your plan' })
      return
    }
    console.error('[subscription/change-plan] Error:', err)
    res.status(500).json({ error: message })
  }
}

interface OwnSubRow {
  id: string
  provider_subscription_id: string
  status: string
  plan_name: string | null
  current_period_end: string | null
  cancel_at_period_end: boolean | null
  scheduled_plan_name: string | null
  scheduled_plan_at: string | null
}

/**
 * THE DOWNGRADE, scheduled for the end of the paid period (D2). Order matters
 * and is deliberate: the schedule is written BEFORE Paddle's price moves, so
 * a Premium-priced subscription.updated arriving a moment later finds the
 * schedule and HOLDS plan_name rather than flipping the family dark today.
 * If Paddle then refuses, the schedule is cleared again and nothing changed.
 */
async function scheduleDowngradeToPremium(
  supabase: any,
  learnerId: string,
  sub: OwnSubRow,
  requestedPeriod: 'monthly' | 'annual' | null,
  res: VercelResponse
): Promise<void> {
  if (sub.plan_name !== 'SSi Family') {
    res.status(409).json({ error: 'Only an SSi Family subscription can be changed to SSi Premium' })
    return
  }
  if (sub.status !== 'active') {
    res.status(409).json({
      error:
        sub.status === 'past_due'
          ? 'Resolve the outstanding payment before changing your plan'
          : 'Your subscription is not active, so it cannot be changed',
    })
    return
  }
  // CANCEL WINS (D4). A subscription already set to end has nothing to
  // downgrade to; the door is hidden in the app and refused here.
  if (sub.cancel_at_period_end) {
    res.status(409).json({ error: 'Your subscription is already set to end, so there is nothing to change it to' })
    return
  }
  if (sub.scheduled_plan_name === 'SSi Premium' && sub.scheduled_plan_at) {
    res.status(200).json({
      ok: true,
      alreadyScheduled: true,
      planName: 'SSi Family',
      scheduledPlanName: 'SSi Premium',
      scheduledPlanAt: sub.scheduled_plan_at,
    })
    return
  }
  // No date to hold the change for = nothing we can promise the family.
  // Fail closed rather than flip anyone dark today.
  if (!sub.current_period_end) {
    res.status(409).json({ error: 'We could not find when your current period ends, so the change was not made' })
    return
  }

  const live = await paddle.subscriptions.get(sub.provider_subscription_id)
  const liveInterval = live.items?.[0]?.price?.billingCycle?.interval
  // Annual Family goes to annual Premium; the interval is preserved as on the upgrade.
  const period: 'monthly' | 'annual' = requestedPeriod || (liveInterval === 'year' ? 'annual' : 'monthly')
  const priceId = premiumPriceId(period)
  const scheduledPlanAt = sub.current_period_end

  // 1. The schedule, first.
  const { error: schedErr } = await supabase
    .from('subscriptions')
    .update({
      scheduled_plan_name: 'SSi Premium',
      scheduled_plan_at: scheduledPlanAt,
      updated_at: new Date().toISOString(),
    })
    .eq('id', sub.id)
  if (schedErr) {
    console.error('[subscription/change-plan] could not write the scheduled change:', schedErr)
    res.status(500).json({ error: 'Could not schedule the change' })
    return
  }

  // 2. Paddle's price, unbilled. Already on Premium (a hand swap in the
  // dashboard) means there is nothing to move; the schedule alone does the job.
  if (live.items?.[0]?.price?.id !== priceId) {
    try {
      await paddle.subscriptions.update(sub.provider_subscription_id, {
        items: [{ priceId, quantity: 1 }],
        prorationBillingMode: 'do_not_bill',
      })
    } catch (err) {
      // Paddle refused: undo the schedule so the row says what Paddle says.
      await supabase
        .from('subscriptions')
        .update({ scheduled_plan_name: null, scheduled_plan_at: null, updated_at: new Date().toISOString() })
        .eq('id', sub.id)
      throw err
    }
  }

  // 3. Tell every displaced adult now, with their own door in it (D6).
  // Best-effort: the change is made and true whether or not a mail sends.
  const emailed = await tellDisplacedAdults(supabase, learnerId, scheduledPlanAt)

  res.status(200).json({
    ok: true,
    planName: 'SSi Family',
    scheduledPlanName: 'SSi Premium',
    scheduledPlanAt,
    billingPeriod: period,
    prorationBillingMode: 'do_not_bill',
    emailed,
  })
}

/**
 * KEEP FAMILY (D9). Paddle first, then the columns: if Paddle refuses, the
 * schedule stands and the row still agrees with the price Paddle holds.
 */
async function keepFamily(supabase: any, sub: OwnSubRow, res: VercelResponse): Promise<void> {
  const live = await paddle.subscriptions.get(sub.provider_subscription_id)
  const liveInterval = live.items?.[0]?.price?.billingCycle?.interval
  const period: 'monthly' | 'annual' = liveInterval === 'year' ? 'annual' : 'monthly'
  const priceId = familyPriceId(period)
  if (!priceId) {
    console.error('[subscription/change-plan] Family price not configured for period:', period)
    res.status(503).json({ error: 'The Family plan is not available yet' })
    return
  }

  if (live.items?.[0]?.price?.id !== priceId) {
    await paddle.subscriptions.update(sub.provider_subscription_id, {
      items: [{ priceId, quantity: 1 }],
      prorationBillingMode: 'do_not_bill',
    })
  }

  const { error } = await supabase
    .from('subscriptions')
    .update({
      scheduled_plan_name: null,
      scheduled_plan_at: null,
      plan_name: 'SSi Family',
      plan_id: priceId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', sub.id)
  if (error) {
    console.error('[subscription/change-plan] could not clear the scheduled change:', error)
    res.status(500).json({ error: 'Could not keep the Family plan' })
    return
  }

  res.status(200).json({ ok: true, reverted: true, planName: 'SSi Family', billingPeriod: period, prorationBillingMode: 'do_not_bill' })
}

/**
 * One email to each live ADULT member: the date, that their progress is safe,
 * and the app as the door to their own Premium (D6, D8). A pending invitee
 * never joined and gets nothing; a child has no inbox. Returns how many were
 * handed to the mail sender.
 */
async function tellDisplacedAdults(supabase: any, ownerLearnerId: string, endsAt: string): Promise<number> {
  try {
    const rows = await liveFamilyRows(supabase, ownerLearnerId)
    const adults = rows.filter((r) => r.status === 'active' && !r.is_child_account && r.member_learner_id)
    if (adults.length === 0) return 0

    const { data: owner } = await supabase
      .from('learners')
      .select('display_name')
      .eq('id', ownerLearnerId)
      .maybeSingle()
    const inviterName = safeInviterName(owner?.display_name as string | null)

    // The address they joined on; failing that, the one their account has verified.
    const missing = adults.filter((r) => !r.invited_email).map((r) => r.member_learner_id as string)
    const verified = new Map<string, string>()
    if (missing.length > 0) {
      const { data: learners } = await supabase
        .from('learners')
        .select('id, verified_emails')
        .in('id', missing)
      for (const l of learners || []) {
        const first = Array.isArray(l.verified_emails) ? l.verified_emails[0] : null
        if (first) verified.set(l.id as string, first as string)
      }
    }

    let sent = 0
    for (const r of adults) {
      const address = r.invited_email || verified.get(r.member_learner_id as string)
      if (!address) continue
      const result = await sendFamilyEndsEmail({ address, inviterName, endsAt })
      if (result.sent) sent += 1
      else console.warn('[subscription/change-plan] family-ends mail not sent:', result.error)
    }
    return sent
  } catch (err) {
    console.warn('[subscription/change-plan] telling displaced adults failed (change stands):', err)
    return 0
  }
}

/**
 * Paddle refuses an update outright when the prorated balance is below its
 * minimum chargeable amount — see the call site. Retry once, unbilled, and
 * only for that one error.
 */
const PRORATION_BELOW_MINIMUM = 'subscription_update_transaction_balance_less_than_charge_limit'

async function updateWithSmallProrationFallback(
  subscriptionId: string,
  priceId: string,
  prorationBillingMode: 'do_not_bill' | 'prorated_immediately'
): Promise<{ updated: any; prorationBillingModeUsed: 'do_not_bill' | 'prorated_immediately' }> {
  try {
    const updated = await paddle.subscriptions.update(subscriptionId, {
      items: [{ priceId, quantity: 1 }],
      prorationBillingMode,
    })
    return { updated, prorationBillingModeUsed: prorationBillingMode }
  } catch (err: any) {
    const code = err?.code || err?.error?.code || ''
    const message = String(err?.message || err?.detail || '')
    const belowMinimum = code === PRORATION_BELOW_MINIMUM || message.includes(PRORATION_BELOW_MINIMUM)
    if (!belowMinimum || prorationBillingMode === 'do_not_bill') throw err
    console.warn('[subscription/change-plan] proration below Paddle minimum; changing plan unbilled')
    const updated = await paddle.subscriptions.update(subscriptionId, {
      items: [{ priceId, quantity: 1 }],
      prorationBillingMode: 'do_not_bill',
    })
    return { updated, prorationBillingModeUsed: 'do_not_bill' }
  }
}

function safeParse(raw: string): any {
  try {
    return JSON.parse(raw)
  } catch {
    return {}
  }
}
