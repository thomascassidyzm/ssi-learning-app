/**
 * Teacher Payout Recipient — /api/teacher/payout-recipient
 *
 * Auth required. Manages the authenticated teacher's Wise recipient (the bank
 * account commission payouts will be sent to).
 *
 *   GET  → returns { recipient_id: string | null }
 *
 *   POST → creates a Wise recipient for the authenticated teacher and stores
 *          the returned ID on teachers.payout_recipient_id.
 *
 *          Body shape mirrors Wise's `POST /v1/accounts` request — the exact
 *          fields required vary per currency. Use Wise's `account-requirements`
 *          endpoint to dynamically generate the form. Minimum required:
 *
 *            {
 *              currency: "EUR",
 *              account_holder_name: "Jane Smith",
 *              type: "iban",                       // per account-requirements
 *              details: { iban: "...", ... }      // per account-requirements
 *              legal_type: "PRIVATE"               // optional
 *            }
 *
 *          We pass the body through to Wise after attaching the SSi business
 *          profile ID. On success, store recipient.id on the teacher.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { verifyAuthToken } from '../_utils/auth'
import { wiseApi, requireProfileId } from '../_utils/wise'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

interface WiseRecipientResponse {
  id: number | string
  profile?: number
  accountHolderName?: string
  currency?: string
  type?: string
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const authResult = await verifyAuthToken(req)
  if (!authResult.valid || !authResult.userId) {
    res.status(401).json({ error: authResult.error || 'Unauthorized' })
    return
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  // Resolve teacher row for the authenticated user
  const { data: learner } = await supabase
    .from('learners')
    .select('id')
    .eq('user_id', authResult.userId)
    .maybeSingle()

  if (!learner) {
    res.status(404).json({ error: 'Not a teacher' })
    return
  }

  const { data: teacher, error: teacherErr } = await supabase
    .from('teachers')
    .select('id, payout_recipient_id')
    .eq('learner_id', learner.id)
    .maybeSingle()

  if (teacherErr || !teacher) {
    res.status(404).json({ error: 'Teacher profile not found' })
    return
  }

  if (req.method === 'GET') {
    res.status(200).json({ recipient_id: teacher.payout_recipient_id || null })
    return
  }

  // POST — create a new Wise recipient
  const body = (req.body || {}) as Record<string, unknown>
  const currency = body.currency as string | undefined
  const accountHolderName = body.account_holder_name as string | undefined
  const type = body.type as string | undefined
  const details = body.details as Record<string, unknown> | undefined
  const legalType = (body.legal_type as string | undefined) || 'PRIVATE'

  if (!currency || !accountHolderName || !type || !details) {
    res.status(400).json({
      error: 'currency, account_holder_name, type, and details are required',
    })
    return
  }

  try {
    const profileId = requireProfileId()

    // Wise expects camelCase fields per https://docs.wise.com/api-docs/api-reference/recipient
    const recipient = await wiseApi<WiseRecipientResponse>('/v1/accounts', {
      method: 'POST',
      json: {
        profile: Number(profileId),
        accountHolderName,
        currency,
        type,
        legalType,
        details,
      },
    })

    const recipientId = String(recipient.id)

    const { error: updateErr } = await supabase
      .from('teachers')
      .update({
        payout_recipient_id: recipientId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', teacher.id)

    if (updateErr) {
      console.error('[teacher/payout-recipient] Failed to store recipient ID:', updateErr)
      res.status(500).json({
        error: 'Recipient created at Wise but failed to save locally',
        recipient_id: recipientId,
      })
      return
    }

    console.log(
      '[teacher/payout-recipient] Created Wise recipient',
      recipientId,
      'for teacher',
      teacher.id
    )
    res.status(201).json({ recipient_id: recipientId })
  } catch (err: any) {
    console.error('[teacher/payout-recipient] Error:', err)
    res.status(500).json({ error: err?.message || 'Internal server error' })
  }
}
