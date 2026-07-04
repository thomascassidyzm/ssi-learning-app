/**
 * Cascade User ID API - POST /api/auth/cascade-user-id
 *
 * After useAuth.ts links a new auth user_id to an existing learner
 * row (because the new auth email matched a learner's
 * verified_emails), related rows in govt_admins / user_tags need
 * their user_id cascaded too so downstream queries find the right
 * records.
 *
 * user_tags isn't REVOKE'd, so its cascade can stay client-side.
 * govt_admins was REVOKE'd by 20260521180000_block_anon_role_escalation
 * — this endpoint covers that one row update.
 *
 * Auth: verifyAuthToken. The caller's JWT user_id MUST match the
 * new_user_id; the endpoint then propagates from old_user_id to
 * new_user_id on govt_admins.
 *
 * Risk model: an attacker who knows another user's previous user_id
 * could in theory call this and steal their govt_admin association.
 * Mitigation: legitimate use only fires after Supabase OTP email
 * verification matched a learner record (the email is the gate),
 * AND this endpoint refuses unless old_user_id is ORPHANED (no
 * learners row still holds it) — mirroring the relink_user_tags
 * SECURITY DEFINER guard (secfix_15). So a caller can only move an
 * association whose learner has already been re-pointed away, never
 * a LIVE admin's. A future "previous_user_id" history column would
 * let us prove the caller once owned old_user_id and tighten more.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { verifyAuthToken } from '../_utils/auth'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

interface CascadeBody {
  old_user_id?: string
}

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

  const { old_user_id: oldUserId } = (req.body || {}) as CascadeBody
  if (!oldUserId || typeof oldUserId !== 'string') {
    res.status(400).json({ error: 'old_user_id is required' })
    return
  }

  const newUserId = authResult.userId

  if (oldUserId === newUserId) {
    // No-op — caller hasn't actually merged. Don't 400 because this can
    // happen on benign double-fires; just report nothing changed.
    res.status(200).json({ cascaded: 0 })
    return
  }

  if (!supabaseUrl || !supabaseServiceKey) {
    res.status(500).json({ error: 'Server configuration error' })
    return
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  try {
    // Sanity: caller has a learner record. Without one there's nothing
    // legitimate to cascade to.
    const { data: callerLearner } = await supabase
      .from('learners')
      .select('id')
      .eq('user_id', newUserId)
      .maybeSingle()

    if (!callerLearner) {
      res.status(404).json({ error: 'No learner record for caller' })
      return
    }

    // SECURITY: refuse unless old_user_id is ORPHANED — the same guard the
    // sibling relink_user_tags (secfix_15) applies to user_tags. In the
    // legitimate flow claim_learner has already re-pointed the learner off
    // old_user_id, so no learners row holds it. If one still does, old_user_id
    // is an ACTIVE identity (potentially someone else's) and this is not a
    // legitimate cascade — refuse, so a caller can't steal a live govt_admin
    // association by supplying a known or guessed auth user id.
    const { data: activeOwners } = await supabase
      .from('learners')
      .select('id')
      .eq('user_id', oldUserId)
      .limit(1)

    if (activeOwners && activeOwners.length > 0) {
      console.warn('[CascadeUserId] REFUSED: old_user_id still owned by an active learner', oldUserId)
      res.status(409).json({ error: 'old_user_id is not orphaned' })
      return
    }

    const { data: updated, error: updateError } = await supabase
      .from('govt_admins')
      .update({ user_id: newUserId })
      .eq('user_id', oldUserId)
      .select('user_id')

    if (updateError) {
      console.error('[CascadeUserId] govt_admins update failed:', updateError)
      res.status(500).json({ error: 'Failed to cascade user_id', detail: updateError.message })
      return
    }

    const count = updated?.length || 0
    console.log('[CascadeUserId] cascaded', count, 'govt_admins rows', oldUserId, '→', newUserId)
    res.status(200).json({ cascaded: count })
  } catch (err) {
    console.error('[CascadeUserId] Error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
}
