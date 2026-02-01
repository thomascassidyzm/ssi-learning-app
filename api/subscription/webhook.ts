/**
 * Subscription Webhook API - Handle LemonSqueezy webhooks
 *
 * POST /api/subscription/webhook
 *
 * Receives webhook events from LemonSqueezy and updates subscription status in Supabase.
 * Events handled:
 * - subscription_created: New subscription
 * - subscription_updated: Status change, renewal, etc.
 * - subscription_cancelled: User cancelled
 * - subscription_expired: Subscription ended
 * - subscription_payment_failed: Payment failed
 * - subscription_payment_success: Payment succeeded
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import * as crypto from 'crypto'

// Environment variables
const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
const webhookSecret = (process.env.LEMONSQUEEZY_WEBHOOK_SECRET || '').trim()

// LemonSqueezy subscription status mapping
const STATUS_MAP: Record<string, string> = {
  active: 'active',
  on_trial: 'active',
  paused: 'cancelled',
  past_due: 'past_due',
  unpaid: 'past_due',
  cancelled: 'cancelled',
  expired: 'none',
}

interface LemonSqueezyWebhookPayload {
  meta: {
    event_name: string
    custom_data?: {
      learner_id?: string
      clerk_user_id?: string
    }
  }
  data: {
    id: string
    type: string
    attributes: {
      store_id: number
      customer_id: number
      order_id: number
      product_id: number
      variant_id: number
      product_name: string
      variant_name: string
      status: string
      status_formatted: string
      renews_at: string | null
      ends_at: string | null
      trial_ends_at: string | null
      created_at: string
      updated_at: string
    }
  }
}

/**
 * Verify webhook signature
 */
function verifyWebhookSignature(payload: string, signature: string): boolean {
  if (!webhookSecret) {
    console.warn('[webhook] No webhook secret configured, skipping verification')
    return true
  }

  const hmac = crypto.createHmac('sha256', webhookSecret)
  const digest = hmac.update(payload).digest('hex')

  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(digest))
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  // Get raw body for signature verification
  // Vercel parses body automatically, so we need to stringify for verification
  const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body)
  const signature = req.headers['x-signature'] as string

  // Verify signature (LemonSqueezy sends signature in x-signature header)
  if (webhookSecret && signature) {
    if (!verifyWebhookSignature(rawBody, signature)) {
      console.error('[webhook] Invalid signature')
      res.status(401).json({ error: 'Invalid signature' })
      return
    }
  } else if (webhookSecret) {
    console.warn('[webhook] No signature provided but secret is configured')
  }

  if (!supabaseUrl || !supabaseServiceKey) {
    console.error('[webhook] Missing Supabase configuration')
    res.status(500).json({ error: 'Server configuration error' })
    return
  }

  try {
    const payload: LemonSqueezyWebhookPayload =
      typeof req.body === 'string' ? JSON.parse(req.body) : req.body

    const eventName = payload.meta.event_name
    const subscriptionData = payload.data.attributes
    const subscriptionId = payload.data.id
    const customData = payload.meta.custom_data

    console.log('[webhook] Event:', eventName, 'Subscription:', subscriptionId)

    // Get learner_id from custom data
    const learnerId = customData?.learner_id
    if (!learnerId) {
      console.error('[webhook] No learner_id in custom data:', customData)
      // Still return 200 to prevent retries for events without our custom data
      res.status(200).json({ received: true, skipped: 'no learner_id' })
      return
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Map LemonSqueezy status to our status
    const status = STATUS_MAP[subscriptionData.status] || 'none'

    // Determine period end date
    const periodEnd = subscriptionData.renews_at || subscriptionData.ends_at || null

    // Determine if cancelling at period end
    const cancelAtPeriodEnd = subscriptionData.status === 'cancelled' && !!subscriptionData.ends_at

    // Build subscription record
    const subscriptionRecord = {
      learner_id: learnerId,
      status,
      plan_id: String(subscriptionData.variant_id),
      plan_name: `${subscriptionData.product_name} - ${subscriptionData.variant_name}`,
      current_period_end: periodEnd,
      cancel_at_period_end: cancelAtPeriodEnd,
      provider: 'lemonsqueezy',
      provider_subscription_id: subscriptionId,
      provider_customer_id: String(subscriptionData.customer_id),
      updated_at: new Date().toISOString(),
    }

    // Upsert subscription
    const { error: upsertError } = await supabase
      .from('subscriptions')
      .upsert(subscriptionRecord, {
        onConflict: 'learner_id',
      })

    if (upsertError) {
      console.error('[webhook] Failed to upsert subscription:', upsertError)
      res.status(500).json({ error: 'Failed to update subscription' })
      return
    }

    console.log('[webhook] Updated subscription for learner:', learnerId, 'status:', status)

    res.status(200).json({ received: true, status })
  } catch (err) {
    console.error('[webhook] Error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
}

// Note: Vercel automatically parses JSON bodies. For production, you may want to
// use a custom body parser or adjust signature verification to match the exact
// payload format sent by LemonSqueezy.
