/**
 * groupTreeAuth — shared authz for the node-surface read endpoints (THE
 * MODEL §6: Structure tree/table, node home, invites). ssi_admin/god sees
 * the whole forest; a govt_admin (group leader) is scoped to their own
 * group + its subtree — the same shape as resolveAdminOrSubtreeLeader in
 * api/groups/[id].ts, factored out for reuse here. A school_admin is the
 * same leader shape one level down: their scope root is their own school's
 * NODE (schools.node_group_id, minted on demand — THE MODEL I2), so the
 * node home / rail / invites they reach are exactly their school subtree,
 * with no parent context (nav unification, 2026-07-30).
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import type { SupabaseClient } from '@supabase/supabase-js'
import { verifyAdmin, verifyAuthToken } from './auth'
import { adminSchoolIdFor } from './schoolStaff'
import { isWithinLeaderSubtree } from './orgLeader'
import { ensureSchoolNode } from './schoolNode'

export interface GroupTreeCaller {
  userId: string
  isAdmin: boolean
  /** The leader's own governed group. Always null for ssi_admin/god. */
  ownGroupId: string | null
}

/**
 * The leader half of the resolution, with NO response writing: which group is
 * this auth uid the leader of? A govt_admin's governed group, else a
 * school_admin's own school NODE, else null.
 *
 * Factored out of resolveGroupTreeCaller so callers that must NOT 403 a
 * non-leader can reuse the identical rule — api/_utils/vadVisibility.ts
 * resolves a teacher or a student as a legitimate caller with no leader group,
 * and re-deriving "who is a leader" there is exactly how two surfaces drift
 * apart. One copy, here.
 */
export async function leaderGroupIdFor(
  supabase: SupabaseClient,
  authUid: string,
): Promise<string | null> {
  const { data: govtAdmin } = await supabase
    .from('govt_admins')
    .select('group_id')
    .eq('user_id', authUid)
    .maybeSingle()
  const ownGroupId = (govtAdmin as any)?.group_id as string | undefined
  if (ownGroupId) return ownGroupId

  // School leader: scope root = their own school's node. This is AUTHORITY —
  // the node surfaces it opens include the leader's own group-delete path
  // (api/groups/[id].ts) — so it is asked twice over, and neither question is
  // mere membership. First the educational_role, because a teacher also
  // carries a SCHOOL: tag but stays on the teacher surfaces. Then WHICH
  // school, via adminSchoolIdFor rather than the membership resolver: that one
  // returns the EARLIEST tag, so an admin of B who once taught at A took A's
  // node as their scope root and could act on a school they never ran.
  const { data: learner } = await supabase
    .from('learners')
    .select('educational_role')
    .eq('user_id', authUid)
    .maybeSingle()
  if ((learner as any)?.educational_role !== 'school_admin') return null

  const schoolId = await adminSchoolIdFor(supabase, authUid)
  if (!schoolId) return null
  const { data: school } = await supabase
    .from('schools')
    .select('id, school_name, group_id, node_group_id, is_demo, is_test')
    .eq('id', schoolId)
    .maybeSingle()
  if (!school) return null
  return (school as any).node_group_id
    || (await ensureSchoolNode(supabase, school as any, { is_demo: (school as any).is_demo, is_test: (school as any).is_test }))
    || null
}

/** Writes the 401/403 response itself and returns null on rejection. */
export async function resolveGroupTreeCaller(
  req: VercelRequest,
  res: VercelResponse,
  supabase: SupabaseClient,
): Promise<GroupTreeCaller | null> {
  const adminResult = await verifyAdmin(req)
  if (!('error' in adminResult)) {
    return { userId: adminResult.userId, isAdmin: true, ownGroupId: null }
  }

  const authResult = await verifyAuthToken(req)
  if (!authResult.valid || !authResult.userId) {
    res.status(401).json({ error: authResult.error || 'Unauthorized' })
    return null
  }

  const ownGroupId = await leaderGroupIdFor(supabase, authResult.userId)
  if (ownGroupId) {
    return { userId: authResult.userId, isAdmin: false, ownGroupId }
  }

  res.status(403).json({ error: 'You do not govern any group' })
  return null
}

/**
 * Is `groupId` within the caller's visible scope (self or strict descendant)?
 * Admin => always true.
 *
 * The leader half delegates to isWithinLeaderSubtree — the SAME predicate the
 * write paths (groups create/rename, invite minting) enforce. Two copies of an
 * authz rule is precisely where a read surface and a write surface drift apart,
 * so there is deliberately only one.
 */
export async function callerCanSeeGroup(
  supabase: SupabaseClient,
  caller: GroupTreeCaller,
  groupId: string,
): Promise<boolean> {
  if (caller.isAdmin) return true
  return isWithinLeaderSubtree(supabase, caller.ownGroupId, groupId)
}
