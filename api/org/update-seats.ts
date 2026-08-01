/**
 * Change seats on the EXISTING org platform subscription —
 * POST /api/org/update-seats
 *
 * Sibling of api/school/update-seats.ts, same reasoning throughout: seats are
 * the `quantity` on the subscription's single per-seat item, and the ONLY
 * correct way to change them is an in-place Paddle update (PATCH
 * /subscriptions) — a fresh Checkout would auto-create a SECOND subscription
 * and double-bill the org.
 *
 * The org is derived from the SESSION via leaderGroupId() (the caller's own
 * govt_admins row), never from the request body — a body group_id would let
 * any caller mutate another org's billing.
 *
 * Proration matches the school lane's decided default: an INCREASE bills the
 * prorated delta immediately; a DECREASE defers to the next billing period.
 * A Paddle-managed trialing subscription uses do_not_bill.
 *
 * seats is written here from Paddle's AUTHORITATIVE update response, and the
 * resulting subscription.updated webhook (handleOrgPlatformSubscription)
 * re-applies the same absolute value — both converge, so a missed/delayed
 * webhook can't leave the count stale.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { verifyAuthToken } from '../_utils/auth'
import { paddle } from '../_utils/paddle'
import { leaderGroupId } from '../_utils/orgPlatform'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

// Guard rail so a typo can't request an absurd quantity — mirrors school/update-seats.
const MAX_SEATS = 1000

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const auth = await verifyAuthToken(req)
  if (!auth.valid || !auth.userId) {
    res.status(401).json({ error: auth.error || 'Unauthorized' })
    return
  }
  if (!supabaseUrl || !supabaseServiceKey) {
    console.error('[org/update-seats] Missing Supabase configuration')
    res.status(500).json({ error: 'Server configuration error' })
    return
  }

  const rawSeats = Number((req.body || {}).seats)
  if (!Number.isFinite(rawSeats)) {
    res.status(400).json({ error: 'seats must be a number' })
    return
  }
  const seats = Math.min(MAX_SEATS, Math.max(1, Math.floor(rawSeats)))

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  try {
    const groupId = await leaderGroupId(supabase, auth.userId)
    if (!groupId) {
      res.status(404).json({ error: 'No org for this account' })
      return
    }

    const { data: group, error: groupErr } = await supabase
      .from('groups')
      .select('provider_subscription_id, platform_status, seats')
      .eq('id', groupId)
      .maybeSingle()
    if (groupErr || !group) {
      res.status(404).json({ error: 'Org not found' })
      return
    }
    const subId = group.provider_subscription_id as string | null
    if (!subId) {
      // No live subscription yet → the caller wants the INITIAL checkout, not
      // a seat change. The client opens Paddle directly for this case.
      res.status(409).json({ error: 'No active subscription; start one first', requires_checkout: true })
      return
    }

    // --- Read the live subscription to get its per-seat price + current qty. ---
    const sub = await paddle.subscriptions.get(subId)
    const item = sub.items?.[0]
    const priceId = item?.price?.id
    if (!priceId) {
      console.error('[org/update-seats] Subscription has no price item:', subId)
      res.status(500).json({ error: 'Subscription is missing its seat price' })
      return
    }
    const currentQty = typeof item?.quantity === 'number' ? item.quantity : (group.seats as number) || 1
    if (seats === currentQty) {
      res.status(200).json({ seats, unchanged: true })
      return
    }

    // INCREASE → charge the delta now; DECREASE → apply at next renewal (no
    // un-withdrawable mid-cycle credit). A Paddle-managed trial can't be prorated.
    const prorationBillingMode =
      sub.status === 'trialing'
        ? 'do_not_bill'
        : seats > currentQty
          ? 'prorated_immediately'
          : 'prorated_next_billing_period'

    const updated = await paddle.subscriptions.update(subId, {
      items: [{ priceId, quantity: seats }],
      prorationBillingMode,
    })

    // Paddle's response is authoritative for the new quantity. Mirror it now
    // so the UI reflects the change immediately; the subscription.updated
    // webhook re-applies the same absolute value (idempotent convergence).
    const newQty = updated.items?.[0]?.quantity ?? seats
    await supabase.from('groups').update({ seats: newQty }).eq('id', groupId)

    res.status(200).json({ seats: newQty, status: updated.status, prorationBillingMode })
  } catch (err: any) {
    const code = err?.code || err?.error?.code || ''
    const message: string = err?.message || err?.detail || 'Failed to update seats'
    if (/past_due/i.test(code) || /past_due/i.test(message)) {
      res.status(409).json({ error: 'Resolve the outstanding payment before changing seats' })
      return
    }
    if (/quantity_out_of_range/i.test(code) || /quantity/i.test(message)) {
      res.status(400).json({ error: 'That seat count is outside the allowed range for this plan' })
      return
    }
    console.error('[org/update-seats] Error:', err)
    res.status(500).json({ error: message })
  }
}
