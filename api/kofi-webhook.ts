/**
 * Ko-fi Webhook API
 *
 * POST /api/kofi-webhook
 *
 * Receives webhook events from Ko-fi when someone donates or starts a subscription.
 * Ko-fi POSTs form data with a `data` field containing JSON.
 *
 * Fields in the JSON payload:
 *   message_id, type (Donation/Subscription), from_name, email, amount,
 *   is_subscription_payment, is_first_subscription_payment, verification_token
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
const kofiVerificationToken = (process.env.KOFI_VERIFICATION_TOKEN || '').trim()

interface KofiPayload {
  message_id: string
  type: string // 'Donation' | 'Subscription' | 'Shop Order' | 'Commission'
  from_name: string
  email: string
  amount: string
  currency: string
  is_subscription_payment: boolean
  is_first_subscription_payment: boolean
  verification_token: string
  kofi_transaction_id: string
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  try {
    // Ko-fi sends form data with a `data` field containing JSON
    let payload: KofiPayload

    if (typeof req.body === 'string') {
      // URL-encoded form data already parsed by Vercel
      payload = JSON.parse(req.body)
    } else if (req.body?.data) {
      // Form-parsed: { data: '{"message_id":...}' }
      payload = typeof req.body.data === 'string'
        ? JSON.parse(req.body.data)
        : req.body.data
    } else {
      // Direct JSON
      payload = req.body
    }

    // Validate verification token
    if (kofiVerificationToken && payload.verification_token !== kofiVerificationToken) {
      console.error('[kofi-webhook] Invalid verification token')
      res.status(401).json({ error: 'Invalid verification token' })
      return
    }

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('[kofi-webhook] Missing Supabase configuration')
      res.status(500).json({ error: 'Server configuration error' })
      return
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Determine type
    const isMonthly = payload.is_subscription_payment || payload.type === 'Subscription'
    const supporterType = isMonthly ? 'monthly' : 'one-off'

    // Try to match email to an existing learner for badge
    let learnerId: string | null = null
    if (payload.email) {
      const { data: learner } = await supabase
        .from('learners')
        .select('id')
        .eq('email', payload.email.toLowerCase())
        .maybeSingle()

      if (learner) {
        learnerId = learner.id
      }
    }

    // Upsert supporter record (dedup on kofi_transaction_id)
    const { error: upsertError } = await supabase
      .from('supporters')
      .upsert(
        {
          display_name: payload.from_name || 'Anonymous',
          email: payload.email?.toLowerCase() || null,
          kofi_transaction_id: payload.kofi_transaction_id || payload.message_id,
          type: supporterType,
          is_active: true,
          last_supported_at: new Date().toISOString(),
          learner_id: learnerId,
        },
        { onConflict: 'kofi_transaction_id' }
      )

    if (upsertError) {
      console.error('[kofi-webhook] Upsert error:', upsertError)
      res.status(500).json({ error: 'Database error' })
      return
    }

    console.log('[kofi-webhook] Recorded:', payload.from_name, supporterType, payload.amount, payload.currency)
    res.status(200).json({ success: true })
  } catch (err) {
    console.error('[kofi-webhook] Error:', err)
    // Return 200 to prevent Ko-fi retries on parse errors
    res.status(200).json({ received: true, error: 'parse error' })
  }
}
