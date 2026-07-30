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
import { isStrictDescendantGroup, schoolIdForAdmin } from './schoolScope'
import { ensureSchoolNode } from './schoolNode'

export interface GroupTreeCaller {
  userId: string
  isAdmin: boolean
  /** The leader's own governed group. Always null for ssi_admin/god. */
  ownGroupId: string | null
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
  const { data: govtAdmin } = await supabase
    .from('govt_admins')
    .select('group_id')
    .eq('user_id', authResult.userId)
    .maybeSingle()
  const ownGroupId = (govtAdmin as any)?.group_id as string | undefined
  if (ownGroupId) {
    return { userId: authResult.userId, isAdmin: false, ownGroupId }
  }

  // School leader: scope root = their own school's node. Gated on the
  // educational_role, NOT on mere school membership — a teacher also carries
  // a SCHOOL: tag but stays on the teacher surfaces (no node-surface access).
  const { data: learner } = await supabase
    .from('learners')
    .select('educational_role')
    .eq('user_id', authResult.userId)
    .maybeSingle()
  if ((learner as any)?.educational_role === 'school_admin') {
    const schoolId = await schoolIdForAdmin(supabase, authResult.userId)
    if (schoolId) {
      const { data: school } = await supabase
        .from('schools')
        .select('id, school_name, group_id, node_group_id, is_demo, is_test')
        .eq('id', schoolId)
        .maybeSingle()
      if (school) {
        const nodeId = (school as any).node_group_id
          || (await ensureSchoolNode(supabase, school as any, { is_demo: (school as any).is_demo, is_test: (school as any).is_test }))
        if (nodeId) {
          return { userId: authResult.userId, isAdmin: false, ownGroupId: nodeId }
        }
      }
    }
  }

  res.status(403).json({ error: 'You do not govern any group' })
  return null
}

/** Is `groupId` within the caller's visible scope (self or strict descendant)? Admin => always true. */
export async function callerCanSeeGroup(
  supabase: SupabaseClient,
  caller: GroupTreeCaller,
  groupId: string,
): Promise<boolean> {
  if (caller.isAdmin) return true
  if (!caller.ownGroupId) return false
  if (caller.ownGroupId === groupId) return true
  return isStrictDescendantGroup(supabase, caller.ownGroupId, groupId)
}
