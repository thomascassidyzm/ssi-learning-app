/**
 * Monthly Teacher Payouts Cron — /api/cron/teacher-payouts
 *
 * Vercel cron, configured in vercel.json to run at 06:00 UTC on the 1st of
 * each month. Processes commission rows for the just-finished month using
 * Wise's batch-group flow.
 *
 * Eligibility:
 *   teacher_commissions.status = 'accruing'
 *   AND period_end < today                — period closed
 *   AND accrued_pence >= 10000            — £100 threshold
 *   AND teachers.payout_recipient_id IS NOT NULL
 *
 * Rows below threshold stay `accruing` and roll forward to next period
 * (no action needed — they continue accumulating until they cross £100).
 *
 * Flow per Wise docs:
 *   1. POST /v3/profiles/:id/batch-groups          → create empty batch
 *   2. For each eligible commission:
 *        a. POST /v3/profiles/:id/quotes           → quote GBP→teacher currency
 *        b. POST /v1/transfers                     → create transfer
 *        c. PATCH /v3/profiles/:id/batch-groups/:groupId → add transfer
 *   3. Mark teacher_commissions.status='pending_payout'
 *      and store wise_batch_group_id for reconciliation.
 *
 * NOTE: Actual funding of the batch (paying SSi's GBP into the batch group so
 * Wise dispatches the transfers) requires a human action in the Wise dashboard
 * for v1 — acceptable per Tom's spike. We log the batch ID + total in the
 * response so it can be funded immediately after the cron runs.
 *
 * Auth: Vercel cron requests carry an `Authorization: Bearer <CRON_SECRET>`
 * header set in project env. We check for it; in dev a missing header is
 * allowed only if NODE_ENV !== 'production'.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { wiseApi, requireProfileId } from '../_utils/wise'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
const cronSecret = (process.env.CRON_SECRET || '').trim()

// £100 in pence
const PAYOUT_THRESHOLD_PENCE = 10000

interface EligibleCommission {
  id: string
  teacher_id: string
  period_start: string
  period_end: string
  accrued_pence: number
}

interface TeacherPayout extends EligibleCommission {
  payout_recipient_id: string
}

interface WiseQuote {
  id: string
  sourceAmount?: number
  targetAmount?: number
  rate?: number
}

interface WiseTransfer {
  id: number | string
  reference?: string
  status?: string
}

interface WiseBatchGroup {
  id: string
  status?: string
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  // Cron auth — Vercel sends Authorization: Bearer <CRON_SECRET>
  const authHeader = (req.headers.authorization || '').trim()
  const isProd = process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production'
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    if (isProd) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }
    console.warn('[cron/teacher-payouts] CRON_SECRET mismatch — allowing in non-prod')
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)
  const todayIso = new Date().toISOString().slice(0, 10)

  // 1. Pull eligible commission rows
  const { data: rows, error: queryErr } = await supabase
    .from('teacher_commissions')
    .select('id, teacher_id, period_start, period_end, accrued_pence')
    .eq('status', 'accruing')
    .lt('period_end', todayIso)
    .gte('accrued_pence', PAYOUT_THRESHOLD_PENCE)

  if (queryErr) {
    console.error('[cron/teacher-payouts] Query failed:', queryErr)
    res.status(500).json({ error: queryErr.message })
    return
  }

  const eligible = (rows || []) as EligibleCommission[]
  if (eligible.length === 0) {
    res.status(200).json({
      message: 'No commissions met the £100 threshold this period.',
      processed: 0,
      skipped_no_recipient: 0,
    })
    return
  }

  // 2. Resolve payout_recipient_id for each teacher; skip those without one
  const teacherIds = Array.from(new Set(eligible.map((r) => r.teacher_id)))
  const { data: teachers, error: teacherErr } = await supabase
    .from('teachers')
    .select('id, payout_recipient_id, display_name')
    .in('id', teacherIds)

  if (teacherErr) {
    console.error('[cron/teacher-payouts] Teacher lookup failed:', teacherErr)
    res.status(500).json({ error: teacherErr.message })
    return
  }

  const recipientByTeacher = new Map<string, string>()
  for (const t of teachers || []) {
    if (t.payout_recipient_id) {
      recipientByTeacher.set(t.id, t.payout_recipient_id)
    }
  }

  const payable: TeacherPayout[] = []
  const skippedNoRecipient: EligibleCommission[] = []
  for (const row of eligible) {
    const recipientId = recipientByTeacher.get(row.teacher_id)
    if (!recipientId) {
      console.warn(
        '[cron/teacher-payouts] Skipping teacher',
        row.teacher_id,
        '— no payout_recipient_id; commission row',
        row.id,
        'will roll into next period.'
      )
      skippedNoRecipient.push(row)
      continue
    }
    payable.push({ ...row, payout_recipient_id: recipientId })
  }

  if (payable.length === 0) {
    res.status(200).json({
      message: `${eligible.length} eligible row(s), but no teachers have a Wise recipient set up.`,
      processed: 0,
      skipped_no_recipient: skippedNoRecipient.length,
    })
    return
  }

  // 3. Create batch group + transfers via Wise
  let batchGroupId: string
  const profileId = requireProfileId()

  try {
    // Create batch group. `name` shows up in the Wise dashboard for funding.
    const periodLabel = payable[0].period_start.slice(0, 7) // YYYY-MM
    const batch = await wiseApi<WiseBatchGroup>(
      `/v3/profiles/${profileId}/batch-groups`,
      {
        method: 'POST',
        json: {
          name: `SSi teacher commissions ${periodLabel}`,
          sourceCurrency: 'GBP',
        },
      }
    )
    batchGroupId = batch.id
    console.log('[cron/teacher-payouts] Created batch group', batchGroupId)
  } catch (err: any) {
    console.error('[cron/teacher-payouts] Failed to create batch group:', err)
    res.status(500).json({ error: 'Failed to create Wise batch group', detail: err?.message })
    return
  }

  const succeeded: Array<{ commission_id: string; transfer_id: string }> = []
  const failed: Array<{ commission_id: string; reason: string }> = []

  for (const row of payable) {
    try {
      // a. Quote: SSi pays in GBP, Wise computes target currency for the recipient.
      //    Recipient's currency was set at recipient-creation time; we pass
      //    targetAccount and Wise infers it. We anchor on sourceAmount in pence
      //    (Wise expects major units as a number, e.g. 105.00 not 10500).
      const sourceAmountMajor = row.accrued_pence / 100
      const quote = await wiseApi<WiseQuote>(
        `/v3/profiles/${profileId}/quotes`,
        {
          method: 'POST',
          json: {
            sourceCurrency: 'GBP',
            // targetCurrency omitted — Wise resolves from targetAccount on transfer create
            sourceAmount: sourceAmountMajor,
            targetAccount: Number(row.payout_recipient_id),
            payOut: 'BANK_TRANSFER',
          },
        }
      )

      // b. Transfer
      const reference = `SSi ${row.period_start.slice(0, 7)}`.slice(0, 35) // Wise reference max 35 chars
      const transfer = await wiseApi<WiseTransfer>('/v1/transfers', {
        method: 'POST',
        json: {
          targetAccount: Number(row.payout_recipient_id),
          quoteUuid: quote.id,
          customerTransactionId: row.id, // idempotency key — our commission row UUID
          details: {
            reference,
            transferPurpose: 'verification.transfers.purpose.other',
            sourceOfFunds: 'verification.source.of.funds.other',
          },
        },
      })

      // c. Add transfer to batch group
      await wiseApi(
        `/v3/profiles/${profileId}/batch-groups/${batchGroupId}/transfers`,
        {
          method: 'PATCH',
          json: { transferId: transfer.id },
        }
      )

      succeeded.push({ commission_id: row.id, transfer_id: String(transfer.id) })
    } catch (err: any) {
      console.error(
        '[cron/teacher-payouts] Transfer failed for commission',
        row.id,
        err?.message
      )
      failed.push({ commission_id: row.id, reason: err?.message || 'unknown' })
    }
  }

  // 4. Mark successful rows pending_payout, attach batch + transfer IDs
  for (const ok of succeeded) {
    const { error: updErr } = await supabase
      .from('teacher_commissions')
      .update({
        status: 'pending_payout',
        wise_transfer_id: ok.transfer_id,
        wise_batch_group_id: batchGroupId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', ok.commission_id)

    if (updErr) {
      console.error(
        '[cron/teacher-payouts] Failed to mark commission',
        ok.commission_id,
        'pending_payout:',
        updErr
      )
    }
  }

  // 5. Mark failed rows so we don't retry them on the next cron run accidentally.
  //    Tom can manually flip them back to 'accruing' after investigation.
  for (const f of failed) {
    await supabase
      .from('teacher_commissions')
      .update({
        status: 'failed',
        failure_reason: `Cron pre-funding: ${f.reason}`.slice(0, 500),
        updated_at: new Date().toISOString(),
      })
      .eq('id', f.commission_id)
  }

  const totalPence = succeeded.reduce((sum, ok) => {
    const row = payable.find((p) => p.id === ok.commission_id)
    return sum + (row?.accrued_pence || 0)
  }, 0)

  res.status(200).json({
    message: `Batch group ${batchGroupId} created. ACTION REQUIRED: fund this batch in the Wise dashboard to dispatch ${succeeded.length} transfer(s).`,
    batch_group_id: batchGroupId,
    processed: succeeded.length,
    failed: failed.length,
    skipped_no_recipient: skippedNoRecipient.length,
    total_payout_pence: totalPence,
    total_payout_gbp: (totalPence / 100).toFixed(2),
  })
}
