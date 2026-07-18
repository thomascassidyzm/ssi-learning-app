/**
 * groupTreeAuth — shared authz for the Structure tree/table read endpoints
 * (THE-MODEL.md §6). ssi_admin/god sees the whole forest; a govt_admin
 * (group leader) is scoped to their own group + its subtree — the same
 * shape as resolveAdminOrSubtreeLeader in api/groups/[id].ts, factored out
 * for reuse here.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import type { SupabaseClient } from '@supabase/supabase-js'
import { verifyAdmin, verifyAuthToken } from './auth'
import { isStrictDescendantGroup } from './schoolScope'

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
  if (!ownGroupId) {
    res.status(403).json({ error: 'You do not govern any group' })
    return null
  }
  return { userId: authResult.userId, isAdmin: false, ownGroupId }
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
