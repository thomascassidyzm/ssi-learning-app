/**
 * SSi Family — POST /api/family/signin-link (FAMILY-PLAN-SPEC.md §4.1(b) "Recovery = re-mint")
 *
 * Owner-only, child-accounts-only. Body: { member_id }. Device wiped or link
 * expired → the parent re-mints a fresh one-time sign-in link. Support never
 * touches it; the parent is self-serve forever.
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

  const { data: membership } = await supabase
    .from('family_members')
    .select('id, owner_learner_id, member_learner_id, is_child_account, removed_at')
    .eq('id', memberId)
    .maybeSingle()

  if (!membership || membership.removed_at || membership.owner_learner_id !== ownerLearnerId) {
    res.status(404).json({ error: 'Member not found' })
    return
  }
  if (!membership.is_child_account) {
    res.status(400).json({ error: 'Sign-in links are only for parent-minted child accounts' })
    return
  }

  const { data: childLearner } = await supabase
    .from('learners')
    .select('user_id')
    .eq('id', membership.member_learner_id)
    .maybeSingle()
  if (!childLearner?.user_id) {
    res.status(404).json({ error: 'Child account not found' })
    return
  }

  const { data: childUser, error: getUserErr } = await supabase.auth.admin.getUserById(childLearner.user_id)
  if (getUserErr || !childUser?.user?.email) {
    console.error('[family/signin-link] could not resolve child auth email:', getUserErr)
    res.status(500).json({ error: 'Failed to resolve child account' })
    return
  }

  const { data: linkData, error: linkErr } = await supabase.auth.admin.generateLink({
    type: 'magiclink',
    email: childUser.user.email,
  })
  if (linkErr || !linkData?.properties?.action_link) {
    console.error('[family/signin-link] link generation failed:', linkErr)
    res.status(500).json({ error: 'Failed to generate sign-in link' })
    return
  }

  res.status(200).json({ signInLink: linkData.properties.action_link })
}
