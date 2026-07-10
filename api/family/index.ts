/**
 * SSi Family — GET /api/family (FAMILY-PLAN-SPEC.md §4)
 *
 * Owner-only management view for the Settings → Family page: the live
 * member list (resolved display names), seat usage, and whether the caller
 * currently holds an active 'SSi Family' subscription. A COVERED MEMBER's
 * own "you're covered" signal comes from /api/subscription's virtual
 * planName, not this endpoint — there's nothing for a member to manage here.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { verifyAuthToken } from '../_utils/auth'
import { resolveLearnerId, liveFamilyRows, FAMILY_SEAT_CAP } from '../_utils/familyMembership'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  if (req.method !== 'GET') {
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
    res.status(200).json({ isOwner: false, hasFamilyPlan: false, seatsUsed: 0, seatCap: FAMILY_SEAT_CAP, members: [] })
    return
  }

  const { data: ownSub } = await supabase
    .from('subscriptions')
    .select('status, plan_name, current_period_end')
    .eq('learner_id', learnerId)
    .maybeSingle()
  const hasFamilyPlan =
    !!ownSub &&
    ownSub.plan_name === 'SSi Family' &&
    ownSub.status === 'active' &&
    (!ownSub.current_period_end || new Date(ownSub.current_period_end) > new Date())

  const rows = await liveFamilyRows(supabase, learnerId)

  const memberLearnerIds = rows.map((r) => r.member_learner_id).filter((id): id is string => !!id)
  const displayNames = new Map<string, string>()
  if (memberLearnerIds.length > 0) {
    const { data: learners } = await supabase
      .from('learners')
      .select('id, display_name')
      .in('id', memberLearnerIds)
    for (const l of learners || []) displayNames.set(l.id as string, (l.display_name as string) || '')
  }

  const members = rows.map((r) => ({
    id: r.id,
    status: r.status,
    is_child_account: r.is_child_account,
    invited_email: r.invited_email,
    display_name: r.member_learner_id ? (displayNames.get(r.member_learner_id) ?? null) : null,
    created_at: r.created_at,
  }))

  res.status(200).json({
    isOwner: rows.length > 0 || hasFamilyPlan,
    hasFamilyPlan,
    seatsUsed: 1 + rows.length,
    seatCap: FAMILY_SEAT_CAP,
    members,
  })
}
