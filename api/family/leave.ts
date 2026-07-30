/**
 * SSi Family — POST /api/family/leave (FAMILY-PLAN-SPEC.md §4.2(b))
 *
 * Member-only self-serve: "or Ffion taps 'leave family' herself." Stamps the
 * caller's OWN membership row removed. No body needed — the row is found by
 * the caller's own learner id, never a member_id from the request (a member
 * can only ever remove themselves, matching the owner-only scope of remove.ts).
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { verifyAuthToken } from '../_utils/auth'
import { resolveLearnerId } from '../_utils/familyMembership'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

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

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  const learnerId = await resolveLearnerId(supabase, authResult.userId)
  if (!learnerId) {
    res.status(404).json({ error: 'Learner account not found' })
    return
  }

  const { data: updated, error } = await supabase
    .from('family_members')
    .update({ status: 'removed', removed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('member_learner_id', learnerId)
    .is('removed_at', null)
    .select('*')
    .maybeSingle()

  if (error) {
    console.error('[family/leave] update failed:', error)
    res.status(500).json({ error: 'Failed to leave family' })
    return
  }
  if (!updated) {
    res.status(404).json({ error: 'You are not a member of a family' })
    return
  }

  res.status(200).json({ member: updated })
}
