/**
 * Group by ID API - GET/PATCH/DELETE /api/groups/:id
 *
 * PATCH: Rename a group (name/type/parent_id — ssi_admin), OR a name-only
 *   self-rename by the leader who governs this exact group
 *   (region-tier-design.md §1d — "name your group"). The leader path is a
 *   SERVER-DERIVED ownership check: the caller's own govt_admins.group_id
 *   must equal the target id — never trust a client claim of which group
 *   they lead. type/parent_id stay ssi_admin-only: a leader must never
 *   re-parent themselves up the tree.
 * GET (?impact=1): deletion-impact preview (schools/classes/learners in the
 *   group, whether there's real recorded activity) — ssi_admin, OR the
 *   leader of an ANCESTOR group previewing one of their own sub-groups.
 *   The confirm dialog in AdminStructure.vue calls this before DELETE.
 * DELETE: Delete a group (schools become ungrouped) — ssi_admin, OR a group
 *   leader deleting a SUB-group in their own subtree ("every level can
 *   delete the things it created and everything below them", founder
 *   ruling) — a SERVER-DERIVED path-prefix check via
 *   isStrictDescendantGroup(their own govt_admins.group_id, target id),
 *   never a client claim. A leader can never delete their OWN governed
 *   group (that would delete their own seat) or a sideways/ancestor group.
 *   Cleans up invite_codes/govt_admins referencing the group first — those
 *   FKs have no ON DELETE behaviour, see schoolGroupDeletion.ts. If the
 *   group has real recorded activity in any of its schools, the caller must
 *   pass `confirm_name` matching the group's name exactly. Every delete is
 *   logged to player_events (admin_group_deleted), best-effort.
 *
 * Requires auth.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { verifyAdmin, verifyAuthToken } from '../_utils/auth'
import { computeGroupImpact, deleteGroupCascade } from '../_utils/schoolGroupDeletion'
import { auditAdminDelete } from '../_utils/auditAdminDelete'
import { isStrictDescendantGroup } from '../_utils/schoolScope'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

/**
 * ssi_admin/god first; fall back to a group leader whose OWN governed group
 * is a strict ancestor of `groupId` (deleting/previewing one of THEIR
 * sub-groups). Writes the 401/403 response itself and returns null on
 * rejection so callers can `if (!callerUserId) return`.
 */
async function resolveAdminOrSubtreeLeader(
  req: VercelRequest,
  res: VercelResponse,
  supabase: ReturnType<typeof createClient>,
  groupId: string,
): Promise<string | null> {
  const adminResult = await verifyAdmin(req)
  if (!('error' in adminResult)) return adminResult.userId

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
  if (!ownGroupId || !(await isStrictDescendantGroup(supabase, ownGroupId, groupId))) {
    res.status(403).json({ error: 'You do not govern this group' })
    return null
  }
  return authResult.userId
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  const groupId = req.query.id as string
  if (!groupId) {
    res.status(400).json({ error: 'Group ID is required' })
    return
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  if (req.method === 'PATCH') {
    const { name, type, parent_id } = req.body || {}
    const wantsNameOnly = name !== undefined && type === undefined && parent_id === undefined

    // Try ssi_admin first (can rename/re-type/re-parent anything); fall back
    // to the leader-rename path only when the caller isn't an admin AND the
    // request is a name-only change.
    const adminResult = await verifyAdmin(req)
    let callerUserId: string
    if (!('error' in adminResult)) {
      callerUserId = adminResult.userId
    } else {
      const authResult = await verifyAuthToken(req)
      if (!authResult.valid || !authResult.userId) {
        res.status(401).json({ error: authResult.error || 'Unauthorized' })
        return
      }
      if (!wantsNameOnly) {
        res.status(403).json({ error: 'Only SSi admins can change group type or parent' })
        return
      }
      const { data: govtAdmin } = await supabase
        .from('govt_admins')
        .select('group_id')
        .eq('user_id', authResult.userId)
        .maybeSingle()
      if (!govtAdmin || (govtAdmin as any).group_id !== groupId) {
        res.status(403).json({ error: 'You do not govern this group' })
        return
      }
      callerUserId = authResult.userId
    }

    try {
      const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
      if (name !== undefined) {
        updates.name = String(name).trim()
        updates.name_confirmed = true
      }
      if (type !== undefined) updates.type = type.trim()
      if (parent_id !== undefined) updates.parent_id = parent_id || null

      const { data, error } = await supabase
        .from('groups')
        .update(updates)
        .eq('id', groupId)
        .select()
        .single()

      if (error) throw error
      console.log('[Groups] Updated group', groupId, 'by', callerUserId)
      res.status(200).json({ group: data })
    } catch (error) {
      console.error('[Groups] Update error:', error)
      res.status(500).json({ error: 'Internal server error' })
    }
  } else if (req.method === 'GET') {
    const callerUserId = await resolveAdminOrSubtreeLeader(req, res, supabase, groupId)
    if (!callerUserId) return
    try {
      const impact = await computeGroupImpact(supabase, groupId)
      res.status(200).json({ impact })
    } catch (err: any) {
      const notFound = /not found/i.test(err?.message || '')
      res.status(notFound ? 404 : 500).json({ error: err?.message || 'Failed to compute impact' })
    }
  } else if (req.method === 'DELETE') {
    const callerUserId = await resolveAdminOrSubtreeLeader(req, res, supabase, groupId)
    if (!callerUserId) return
    const confirmName = ((req.query.confirm_name as string) || (req.body as any)?.confirm_name || '').trim()
    try {
      const impact = await computeGroupImpact(supabase, groupId)

      if (impact.hasRealActivity && confirmName !== impact.groupName) {
        res.status(409).json({
          error: 'This group has real recorded activity — type the group name exactly to confirm deletion',
          requires_confirm_name: true,
          impact,
        })
        return
      }

      await deleteGroupCascade(supabase, groupId)

      await auditAdminDelete(supabase, {
        actorUserId: callerUserId,
        eventType: 'admin_group_deleted',
        payload: { group_id: groupId, group_name: impact.groupName, impact },
      })
      res.status(200).json({ deleted: true, impact })
    } catch (err: any) {
      console.error('[Groups] Delete error:', err)
      const notFound = /not found/i.test(err?.message || '')
      res.status(notFound ? 404 : 500).json({ error: err?.message || 'Failed to delete group' })
    }
  } else {
    res.status(405).json({ error: 'Method not allowed' })
  }
}
