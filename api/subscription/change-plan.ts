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
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { verifyAuthToken } from '../_utils/auth'
import { paddle } from '../_utils/paddle'
import { applyCors } from '../_utils/cors'

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
  if (targetPlan !== 'family') {
    res.status(400).json({ error: 'Only an upgrade to SSi Family is supported' })
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
      .select('id, provider_subscription_id, status, plan_name')
      .eq('learner_id', learner.id)
      .maybeSingle()

    if (!sub?.provider_subscription_id) {
      res.status(404).json({ error: 'No active subscription' })
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

    const updated = await paddle.subscriptions.update(sub.provider_subscription_id, {
      items: [{ priceId, quantity: 1 }],
      prorationBillingMode,
    })

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
      prorationBillingMode,
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

function safeParse(raw: string): any {
  try {
    return JSON.parse(raw)
  } catch {
    return {}
  }
}
