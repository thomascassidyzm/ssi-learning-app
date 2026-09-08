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
import { applyCors } from '../_utils/cors'
import { safeInviterName, sendFamilyInviteEmail } from '../_utils/familyInviteEmail'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  // Cross-origin policy and preflight both live in `api/_utils/cors.ts`.
  // Without this the native WebView's preflight for the `Authorization`
  // header goes unanswered and the call fails there while working on the web.
  if (applyCors(req, res, { methods: 'POST' })) return

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
    .select('verified_emails, display_name')
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

  // AN INVITE THAT ALREADY EXISTS IS RE-SENT, NOT REFUSED. The dedupe index
  // used to answer 409 "Already invited" — which is exactly the moment an
  // owner is retyping the address because the mail has not turned up (Tom,
  // 2026-09-07: Resend had delivered it within a second; the app could only
  // say "Invited"). Re-posting a live invite now sends the mail again and
  // says so. An invite that has already been claimed is the one genuine
  // "already in your family" — that stays a 409, with words a person can act on.
  let inserted: Record<string, unknown> | null = null
  let resent = false
  const { data: freshRow, error: insertErr } = await supabase
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
    if (insertErr.code !== '23505') {
      console.error('[family/invite] insert failed:', insertErr)
      res.status(500).json({ error: 'We could not save this invite. Nothing was changed — please try again in a moment.' })
      return
    }
    const { data: existing } = await supabase
      .from('family_members')
      .select('*')
      .eq('owner_learner_id', ownerLearnerId)
      .eq('invited_email', normalizedEmail)
      .is('removed_at', null)
      .maybeSingle()
    if (!existing) {
      res.status(409).json({ error: 'That address has already been invited.' })
      return
    }
    if (existing.status !== 'invited') {
      res.status(409).json({ error: 'That person is already in your family.' })
      return
    }
    inserted = existing
    resent = true
  } else {
    inserted = freshRow
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

  // Tell the person they have been invited. Until this existed the owner had
  // to phone them and explain that they should go and sign in with that exact
  // address — the whole point of the address-based seat was that they need do
  // nothing unusual, and nothing said so. The two states get different words:
  // an existing account is already attached, a new one attaches on first
  // sign-in (familyInviteEmail.ts).
  //
  // Best-effort: the seat is real whether or not the mail goes, so a send
  // failure is reported, never thrown. Child seats never reach here —
  // create-child.ts mints a synthetic address and hands over a QR code.
  let emailed = false
  let emailError: string | undefined
  let sentId: string | undefined
  try {
    const sendResult = await sendFamilyInviteEmail({
      address: normalizedEmail,
      inviterName: safeInviterName(ownerLearner?.display_name as string | null),
      hasAccount: attachedNow,
    })
    emailed = sendResult.sent
    sentId = sendResult.id
    if (!sendResult.sent) emailError = sendResult.error
  } catch (mailErr) {
    emailError = mailErr instanceof Error ? mailErr.message : 'send failed'
  }
  if (!emailed) console.error('[family/invite] invite email not sent:', emailError)

  // Stamp the row so the family screen can say WHEN the mail went and offer
  // a resend (GET /api/family reads invite_emailed_at back). Best-effort: the
  // stamp is observability, the seat is the thing.
  let inviteEmailedAt: string | null = null
  if (emailed && inserted?.id) {
    inviteEmailedAt = new Date().toISOString()
    const { error: stampErr } = await supabase
      .from('family_members')
      .update({ invite_emailed_at: inviteEmailedAt, invite_email_id: sentId ?? null })
      .eq('id', inserted.id)
    if (stampErr) console.error('[family/invite] could not stamp invite_emailed_at (non-fatal):', stampErr)
  }

  res.status(200).json({
    invite: { ...inserted, invite_emailed_at: inviteEmailedAt ?? (inserted as any)?.invite_emailed_at ?? null },
    attachedNow,
    emailed,
    resent,
    emailError: emailed ? undefined : emailError,
  })
}
