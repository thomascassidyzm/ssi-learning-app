/**
 * SSi Family — POST /api/family/remove (FAMILY-PLAN-SPEC.md §4.2(b))
 *
 * Owner-only. Body: { member_id }. Stamps the row removed — never deletes.
 * The seat frees instantly; the member's learner row, belts, streaks, and
 * downloads all remain untouched. Re-adding later (a fresh invite/create-
 * child) is one tap and everything is exactly where they left it.
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

  const memberId = (req.body || {}).member_id
  if (typeof memberId !== 'string' || !memberId) {
    res.status(400).json({ error: 'member_id is required' })
    return
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  const ownerLearnerId = await resolveLearnerId(supabase, authResult.userId)
  if (!ownerLearnerId) {
    res.status(404).json({ error: 'Learner account not found' })
    return
  }

  const { data: updated, error } = await supabase
    .from('family_members')
    .update({ status: 'removed', removed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', memberId)
    .eq('owner_learner_id', ownerLearnerId) // ownership check IS the filter — no row = not yours or not found
    .is('removed_at', null)
    .select('*')
    .maybeSingle()

  if (error) {
    console.error('[family/remove] update failed:', error)
    res.status(500).json({ error: 'Failed to remove member' })
    return
  }
  if (!updated) {
    res.status(404).json({ error: 'Member not found' })
    return
  }

  res.status(200).json({ member: updated })
}
