/**
 * Wise Webhook Handler — POST /api/teacher/wise-webhook
 *
 * Public (no auth — verified by RSA signature). Handles `transfers#state-change`
 * events and reconciles teacher_commissions.
 *
 *   outgoing_payment_sent  → status='paid', paid_at = now
 *   funds_refunded         → status='failed', failure_reason='funds_refunded'
 *   bounced_back           → status='failed', failure_reason='bounced_back'
 *   charged_back           → status='failed', failure_reason='charged_back'
 *
 * Lookup: Wise's `data.resource.id` is the transfer ID; we match on
 * teacher_commissions.wise_transfer_id (set by the monthly cron when the
 * transfer is created).
 *
 * Webhook signature: Wise sends a Base64 RSA+SHA256 signature of the raw body
 * in `X-Signature-SHA256`. We verify with the published Wise public key
 * (env var WISE_WEBHOOK_PUBLIC_KEY).
 *
 * https://docs.wise.com/api-docs/features/webhooks-notifications/event-types
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { verifyWiseWebhook } from '../_utils/wise'

// Signature verification needs the raw, unparsed body.
export const config = {
  api: { bodyParser: false },
}

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

function readRawBody(req: VercelRequest): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

interface WiseTransferStateChangeEvent {
  event_type?: string
  // Newer events use camelCase, older use snake_case — handle both.
  data?: {
    resource?: {
      id?: number | string
      type?: string
      profile_id?: number
    }
    current_state?: string
    previous_state?: string
    occurred_at?: string
  }
}

// Wise transfer states that map to our terminal statuses
const PAID_STATES = new Set(['outgoing_payment_sent'])
const FAILED_STATES = new Set([
  'funds_refunded',
  'bounced_back',
  'charged_back',
  'cancelled',
])

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  // Wise sends `X-Signature-SHA256` (newer) — also accept `X-Signature` for older accounts.
  const signature =
    (req.headers['x-signature-sha256'] as string | undefined) ||
    (req.headers['x-signature'] as string | undefined) ||
    ''

  let rawBody: string
  try {
    rawBody = await readRawBody(req)
  } catch (err) {
    console.error('[wise-webhook] Failed to read body:', err)
    res.status(400).json({ error: 'Failed to read body' })
    return
  }

  if (!verifyWiseWebhook(rawBody, signature)) {
    console.error('[wise-webhook] Signature verification failed')
    res.status(401).json({ error: 'Invalid signature' })
    return
  }

  let event: WiseTransferStateChangeEvent
  try {
    event = JSON.parse(rawBody) as WiseTransferStateChangeEvent
  } catch {
    res.status(400).json({ error: 'Invalid JSON' })
    return
  }

  const eventType = event.event_type || ''
  const transferId = event.data?.resource?.id
  const currentState = event.data?.current_state

  console.log(
    '[wise-webhook] Received:',
    eventType,
    'transfer:',
    transferId,
    'state:',
    currentState
  )

  // We only care about transfer state-change events
  if (!eventType.startsWith('transfers#state-change') || !transferId || !currentState) {
    res.status(200).json({ received: true, ignored: true })
    return
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)
  const transferIdStr = String(transferId)

  try {
    if (PAID_STATES.has(currentState)) {
      const paidAt = event.data?.occurred_at || new Date().toISOString()
      const { error } = await supabase
        .from('teacher_commissions')
        .update({
          status: 'paid',
          paid_at: paidAt,
          updated_at: new Date().toISOString(),
        })
        .eq('wise_transfer_id', transferIdStr)

      if (error) {
        console.error('[wise-webhook] Failed to mark paid:', error)
        res.status(500).json({ error: error.message })
        return
      }

      console.log('[wise-webhook] Marked paid: transfer', transferIdStr)
    } else if (FAILED_STATES.has(currentState)) {
      const { error } = await supabase
        .from('teacher_commissions')
        .update({
          status: 'failed',
          failure_reason: `Wise: ${currentState}`,
          updated_at: new Date().toISOString(),
        })
        .eq('wise_transfer_id', transferIdStr)

      if (error) {
        console.error('[wise-webhook] Failed to mark failed:', error)
        res.status(500).json({ error: error.message })
        return
      }

      console.log(
        '[wise-webhook] Marked failed: transfer',
        transferIdStr,
        'state:',
        currentState
      )
    } else {
      // Intermediate states (processing, waiting_recipient_input, etc.) — log only.
      console.log(
        '[wise-webhook] Intermediate state ignored:',
        currentState,
        'transfer:',
        transferIdStr
      )
    }

    res.status(200).json({ received: true })
  } catch (err: any) {
    console.error('[wise-webhook] Handler error:', err)
    res.status(500).json({ error: err?.message || 'Internal error' })
  }
}
