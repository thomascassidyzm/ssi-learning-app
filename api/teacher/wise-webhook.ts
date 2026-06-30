/**
 * Wise Webhook Handler — POST /api/teacher/wise-webhook
 *
 * Public (no auth — verified by RSA signature). Handles `transfers#state-change`
 * events and reconciles teacher_commissions.
 *
 *   outgoing_payment_sent  → status='paid', paid_at = now
 *   charged_back           → status='failed' (TERMINAL — source payment reversed;
 *                            do NOT re-queue; can demote pending_payout OR paid)
 *   bounced_back / cancelled / funds_refunded → TRANSIENT delivery failure: reset
 *                            the row to 'accruing' and clear wise_transfer_id /
 *                            wise_batch_group_id so the next cron run re-queues it.
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

// Wise transfer states that map to our statuses.
const PAID_STATES = new Set(['outgoing_payment_sent'])
// TERMINAL failure: the source payment itself was reversed. Never re-queue.
const CHARGEBACK_STATES = new Set(['charged_back'])
// TRANSIENT delivery failure: the money never reached the recipient (bounced,
// cancelled, or refunded back to us). Reset the row so the next cron re-queues it.
const TRANSIENT_FAILURE_STATES = new Set([
  'bounced_back',
  'cancelled',
  'funds_refunded',
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

  // Idempotency: Wise can re-deliver the same state-change. Key on
  // transfer+state+occurred_at. 23505 = already processed → no-op. Fails OPEN if
  // the ledger table is absent (pre-migration).
  const eventKey = `${transferIdStr}:${currentState}:${event.data?.occurred_at || ''}`
  try {
    const { error: dedupErr } = await supabase
      .from('processed_webhook_events')
      .insert({ provider: 'wise', event_id: eventKey, event_type: eventType })
    if (dedupErr && dedupErr.code === '23505') {
      res.status(200).json({ received: true, deduped: true })
      return
    }
    if (dedupErr) {
      console.warn('[wise-webhook] Event dedup unavailable (proceeding):', dedupErr.code, dedupErr.message)
    }
  } catch (e: any) {
    console.warn('[wise-webhook] Event dedup threw (proceeding):', e?.message)
  }

  try {
    if (PAID_STATES.has(currentState)) {
      const paidAt = event.data?.occurred_at || new Date().toISOString()
      // Monotonic: only promote a row that's awaiting payout. Never resurrect a
      // failed/charged-back row to paid on a replayed/out-of-order delivery.
      const { data: updated, error } = await supabase
        .from('teacher_commissions')
        .update({
          status: 'paid',
          paid_at: paidAt,
          updated_at: new Date().toISOString(),
        })
        .eq('wise_transfer_id', transferIdStr)
        .in('status', ['pending_payout'])
        .select('id')

      if (error) {
        // Throw so the catch clears the dedup row and Wise's retry reprocesses,
        // rather than silently losing the paid transition.
        throw new Error(`mark paid failed: ${error.message}`)
      }

      console.log('[wise-webhook] Marked paid:', updated?.length ?? 0, 'row(s), transfer', transferIdStr)
    } else if (CHARGEBACK_STATES.has(currentState)) {
      // TERMINAL. A genuine chargeback can arrive AFTER a transfer was marked paid,
      // so it may demote pending_payout OR paid → failed. Idempotent: re-delivery
      // of an already-failed row no-ops.
      const { data: updated, error } = await supabase
        .from('teacher_commissions')
        .update({
          status: 'failed',
          failure_reason: `Wise: ${currentState}`,
          updated_at: new Date().toISOString(),
        })
        .eq('wise_transfer_id', transferIdStr)
        .in('status', ['pending_payout', 'paid'])
        .select('id')

      if (error) {
        throw new Error(`mark failed failed: ${error.message}`)
      }

      console.log(
        '[wise-webhook] Marked failed (chargeback):',
        updated?.length ?? 0,
        'row(s), transfer',
        transferIdStr,
        'state:',
        currentState
      )
    } else if (TRANSIENT_FAILURE_STATES.has(currentState)) {
      // TRANSIENT: the money bounced/cancelled/was refunded back to us — the
      // commission is still genuinely owed. Reset the row to 'accruing' and clear
      // the Wise transfer linkage so the next cron run re-quotes and re-sends it.
      // Only act on a row still awaiting payout — never resurrect a 'paid' row
      // (a true reversal of a paid transfer would arrive as charged_back), and the
      // unique wise_transfer_id index tolerates the NULL we set here.
      const { data: updated, error } = await supabase
        .from('teacher_commissions')
        .update({
          status: 'accruing',
          wise_transfer_id: null,
          wise_batch_group_id: null,
          failure_reason: `Re-queued after Wise: ${currentState}`,
          updated_at: new Date().toISOString(),
        })
        .eq('wise_transfer_id', transferIdStr)
        .in('status', ['pending_payout'])
        .select('id')

      if (error) {
        throw new Error(`re-queue failed: ${error.message}`)
      }

      console.log(
        '[wise-webhook] Re-queued (transient failure):',
        updated?.length ?? 0,
        'row(s), transfer',
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
    // Clear the dedup row so Wise's retry of this state-change reprocesses rather
    // than being deduped into permanent loss of the paid/failed transition.
    try {
      await supabase
        .from('processed_webhook_events')
        .delete()
        .eq('provider', 'wise')
        .eq('event_id', eventKey)
    } catch (cleanupErr: any) {
      console.warn('[wise-webhook] dedup cleanup failed:', cleanupErr?.message)
    }
    res.status(500).json({ error: err?.message || 'Internal error' })
  }
}
