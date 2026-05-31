/**
 * Cancel Subscription - POST /api/subscription/cancel
 *
 * Auth required. Cancels the authenticated learner's own (Premium) subscription
 * at the end of the current billing period — they keep access until then (and
 * the 7-day trial still ends without a charge). Used by the in-app Settings ->
 * "Cancel subscription" flow so cancelling never leaves the app.
 *
 * Paddle remains the source of truth: this schedules the cancellation and the
 * paddle-webhook flips cancel_at_period_end when Paddle confirms. We also set
 * cancel_at_period_end optimistically here so the UI reflects it immediately
 * even before the webhook lands.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { verifyAuthToken } from '../_utils/auth'
import { paddle } from '../_utils/paddle'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const authResult = await verifyAuthToken(req)
  if (!authResult.valid || !authResult.userId) {
    res.status(401).json({ error: authResult.error || 'Unauthorized' })
    return
  }

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

    const { data: sub } = await supabase
      .from('subscriptions')
      .select('id, provider_subscription_id, status')
      .eq('learner_id', learner.id)
      .maybeSingle()

    if (!sub?.provider_subscription_id) {
      res.status(404).json({ error: 'No active subscription' })
      return
    }

    if (sub.status === 'cancelled') {
      res.status(200).json({ ok: true, alreadyCancelled: true })
      return
    }

    // Schedule cancellation for the end of the current period — keeps access
    // until then and avoids an immediate prorated outcome.
    const result = await paddle.subscriptions.cancel(sub.provider_subscription_id, {
      effectiveFrom: 'next_billing_period',
    })

    const effectiveAt =
      result.scheduledChange?.effectiveAt ||
      result.currentBillingPeriod?.endsAt ||
      result.nextBilledAt ||
      null

    // Optimistic local mirror so the UI updates before the webhook confirms.
    await supabase
      .from('subscriptions')
      .update({ cancel_at_period_end: true, updated_at: new Date().toISOString() })
      .eq('id', sub.id)

    res.status(200).json({ ok: true, effectiveAt })
  } catch (err: any) {
    console.error('[subscription/cancel] Error:', err)
    res.status(500).json({ error: err?.message || 'Internal server error' })
  }
}
