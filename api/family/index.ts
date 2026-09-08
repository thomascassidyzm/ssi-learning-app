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
import { applyCors } from '../_utils/cors'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  // Cross-origin policy and preflight both live in `api/_utils/cors.ts`.
  // Without this the native WebView's preflight for the `Authorization`
  // header goes unanswered and the call fails there while working on the web.
  if (applyCors(req, res, { methods: 'GET' })) return

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
    res.status(200).json({ isOwner: false, hasFamilyPlan: false, seatsUsed: 0, seatCap: FAMILY_SEAT_CAP, members: [], removedChildren: [], familyEndsAt: null })
    return
  }

  const { data: ownSub } = await supabase
    .from('subscriptions')
    .select('status, plan_name, current_period_end, cancel_at_period_end, scheduled_plan_name, scheduled_plan_at')
    .eq('learner_id', learnerId)
    .maybeSingle()
  const hasFamilyPlan =
    !!ownSub &&
    ownSub.plan_name === 'SSi Family' &&
    ownSub.status === 'active' &&
    (!ownSub.current_period_end || new Date(ownSub.current_period_end) > new Date())

  // When the family cover ends, if the owner has set it to: a scheduled change
  // to Premium (job #376·F, D5 — the family page shows the date) or a
  // cancellation. Null while nothing ends.
  const familyEndsAt: string | null = !hasFamilyPlan
    ? null
    : ownSub!.scheduled_plan_name && ownSub!.scheduled_plan_at
      ? (ownSub!.scheduled_plan_at as string)
      : ownSub!.cancel_at_period_end
        ? (ownSub!.current_period_end as string | null)
        : null

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

  // Removed CHILD rows still surface, because a child account has no email and
  // no way to pay: the parent-minted link is its only door, and it must stay
  // reachable after Remove (job #376·F, D7). They hold no seat and are listed
  // apart from the family. Removed adults are not listed; they sign in on
  // their own address whenever they like.
  const { data: removedRows } = await supabase
    .from('family_members')
    .select('id, member_learner_id, is_child_account, removed_at, created_at')
    .eq('owner_learner_id', learnerId)
    .eq('is_child_account', true)
    .not('removed_at', 'is', null)
  const removedChildIds = (removedRows || [])
    .map((r: any) => r.member_learner_id)
    .filter((id: string | null): id is string => !!id)
  if (removedChildIds.length > 0) {
    const { data: removedLearners } = await supabase
      .from('learners')
      .select('id, display_name')
      .in('id', removedChildIds)
    for (const l of removedLearners || []) displayNames.set(l.id as string, (l.display_name as string) || '')
  }
  const removedChildren = (removedRows || []).map((r: any) => ({
    id: r.id,
    status: 'removed' as const,
    is_child_account: true,
    invited_email: null,
    display_name: r.member_learner_id ? (displayNames.get(r.member_learner_id) ?? null) : null,
    created_at: r.created_at,
    removed_at: r.removed_at,
  }))

  const members = rows.map((r) => ({
    id: r.id,
    status: r.status,
    is_child_account: r.is_child_account,
    invited_email: r.invited_email,
    display_name: r.member_learner_id ? (displayNames.get(r.member_learner_id) ?? null) : null,
    created_at: r.created_at,
    // When the invite mail last went out (null: never, or a child seat), so
    // the family screen can say so and offer a resend rather than a bare
    // "Invited" (Tom, 2026-09-07).
    invite_emailed_at: r.invite_emailed_at ?? null,
  }))

  res.status(200).json({
    isOwner: rows.length > 0 || hasFamilyPlan,
    hasFamilyPlan,
    seatsUsed: 1 + rows.length,
    seatCap: FAMILY_SEAT_CAP,
    members,
    removedChildren,
    familyEndsAt,
  })
}
