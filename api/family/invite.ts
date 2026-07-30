/**
 * SSi Family — POST /api/family/invite (FAMILY-PLAN-SPEC.md §4.1(a))
 *
 * Owner-only. Body: { email }. Writes an 'invited' family_members row. If a
 * learner with that verified email already exists, attaches IMMEDIATELY (the
 * grant-emails.ts immediate-apply pattern). Otherwise it attaches the next
 * time that email signs in and POSTs /api/access/claim (the claim fold-in).
 *
 * Grandpa's total pain: one standard OTP sign-in he'd have done anyway. He
 * never sees the word "family".
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { verifyAuthToken } from '../_utils/auth'
import {
  resolveLearnerId,
  countUsedSeats,
  attachPendingInvitesForEmail,
  FAMILY_SEAT_CAP,
} from '../_utils/familyMembership'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }
  if (!supabaseUrl || !supabaseServiceKey) {
    res.status(500).json({ error: 'Server misconfigured' })
    return
  }

  const authResult = await verifyAuthToken(req)
  if (!authResult.valid || !authResult.userId) {
    res.status(401).json({ error: authResult.error || 'Unauthorized' })
    return
  }

  const rawEmail = (req.body || {}).email
  if (typeof rawEmail !== 'string' || !EMAIL_RE.test(rawEmail.trim())) {
    res.status(400).json({ error: 'A valid email is required' })
    return
  }
  const normalizedEmail = rawEmail.toLowerCase().trim()

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  const ownerLearnerId = await resolveLearnerId(supabase, authResult.userId)
  if (!ownerLearnerId) {
    res.status(404).json({ error: 'Learner account not found' })
    return
  }

  // Inviting yourself is a no-op the UI should never offer, but reject
  // server-side too (matches spec §4.3).
  const { data: ownerLearner } = await supabase
    .from('learners')
    .select('verified_emails')
    .eq('id', ownerLearnerId)
    .maybeSingle()
  const ownerEmails: string[] = (ownerLearner?.verified_emails as string[] | null) || []
  if (ownerEmails.some((e) => e.toLowerCase().trim() === normalizedEmail)) {
    res.status(400).json({ error: 'You cannot invite your own email' })
    return
  }

  const usedSeats = await countUsedSeats(supabase, ownerLearnerId)
  if (usedSeats >= FAMILY_SEAT_CAP) {
    res.status(400).json({ error: `Family is full (${FAMILY_SEAT_CAP} seats including you)` })
    return
  }

  const { data: inserted, error: insertErr } = await supabase
    .from('family_members')
    .insert({
      owner_learner_id: ownerLearnerId,
      invited_email: normalizedEmail,
      is_child_account: false,
      status: 'invited',
    })
    .select('*')
    .single()

  if (insertErr) {
    if (insertErr.code === '23505') {
      // family_members_invite_dedupe: a live invite to this email already exists.
      res.status(409).json({ error: 'Already invited' })
      return
    }
    console.error('[family/invite] insert failed:', insertErr)
    res.status(500).json({ error: 'Failed to create invite' })
    return
  }

  // Best-effort immediate attach: an existing account whose verified email
  // matches gets covered right away — no need to wait for their next sign-in.
  let attachedNow = false
  try {
    const { data: existingLearners } = await supabase
      .from('learners')
      .select('id, verified_emails')
      .contains('verified_emails', [normalizedEmail])

    for (const candidate of existingLearners || []) {
      const emails: string[] = (candidate.verified_emails as string[] | null) || []
      if (!emails.some((e) => e.toLowerCase().trim() === normalizedEmail)) continue
      if (candidate.id === ownerLearnerId) continue // can't invite yourself (checked above, belt+braces)

      const { attached } = await attachPendingInvitesForEmail(supabase, candidate.id as string, normalizedEmail)
      if (attached > 0) attachedNow = true
      break // verified_emails is effectively unique per real person; first match wins
    }
  } catch (attachErr) {
    console.error('[family/invite] immediate attach failed (non-fatal):', attachErr)
  }

  res.status(200).json({ invite: inserted, attachedNow })
}
