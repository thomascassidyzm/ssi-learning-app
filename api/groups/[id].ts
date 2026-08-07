/**
 * Group by ID API - GET/PATCH/DELETE /api/groups/:id
 *
 * PATCH: Rename a group (name/type/parent_id — ssi_admin), OR a name-only
 *   rename by a leader who governs this group OR a strict ancestor of it
 *   (region-tier-design.md §1d — "name your group"; extended 2026-08-01 to
 *   the leader's whole subtree, "full authority over everything below them",
 *   same scope DELETE already uses). The leader path is a SERVER-DERIVED
 *   check via isStrictDescendantGroup(their own govt_admins.group_id, target
 *   id) — never trust a client claim of which group they lead. type/parent_id
 *   stay ssi_admin-only: a leader must never re-parent a group up the tree.
 *   A rename that would leave two siblings with the same slug answers 409
 *   `duplicate_name` and writes nothing — the same WARNING POST /api/groups
 *   gives at creation, never a constraint: the same request re-sent with
 *   `confirm_duplicate: true` proceeds byte-identically to before.
 *   Renaming a group that IS a school's own node also renames that school
 *   record, after the warning — one name, two homes (_utils/schoolNodeName.ts).
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
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { verifyAdmin, verifyAuthToken } from '../_utils/auth'
import { computeGroupImpact, deleteGroupCascade } from '../_utils/schoolGroupDeletion'
import { auditAdminDelete } from '../_utils/auditAdminDelete'
import { isStrictDescendantGroup } from '../_utils/schoolScope'
import { isWithinLeaderSubtree } from '../_utils/orgLeader'
import { findSiblingSlugCollisions, duplicateNameBody } from '../_utils/groupSlug'
import { syncSchoolNameForNode } from '../_utils/schoolNodeName'

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
  supabase: SupabaseClient,
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

/**
 * The row's own current name and parent, for working out what a PATCH
 * EFFECTIVELY leaves behind (a patch may change either, both, or neither).
 * FAILS OPEN like the duplicate lookup itself: null on any error or missing
 * row means "no warning", never a failed rename.
 */
async function readGroupNameAndParent(
  supabase: SupabaseClient,
  groupId: string,
): Promise<{ name: string; parent_id: string | null } | null> {
  try {
    const { data, error } = await supabase
      .from('groups')
      .select('id, name, parent_id')
      .eq('id', groupId)
      .maybeSingle()
    if (error || !data) return null
    return { name: String((data as any).name ?? ''), parent_id: ((data as any).parent_id ?? null) as string | null }
  } catch {
    return null
  }
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
    const { name, type, parent_id, confirm_duplicate } = req.body || {}
    const wantsNameOnly = name !== undefined && type === undefined && parent_id === undefined

    // Try ssi_admin first (can rename/re-type/re-parent anything); fall back
    // to the leader-rename path only when the caller isn't an admin AND the
    // request is a name-only change.
    const adminResult = await verifyAdmin(req)
    let callerUserId: string
    let isAdmin = false
    if (!('error' in adminResult)) {
      callerUserId = adminResult.userId
      isAdmin = true
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
      const ownGroupId = (govtAdmin as any)?.group_id as string | undefined
      if (!(await isWithinLeaderSubtree(supabase, ownGroupId, groupId))) {
        res.status(403).json({ error: 'You do not govern this group' })
        return
      }
      callerUserId = authResult.userId
    }

    try {
      // Re-parent cycle check (THE-MODEL.md §6 "PATCH ... re-parent
      // (cycle-checked)"): a group can never become its own parent, nor be
      // re-parented under one of its own descendants (I1 — the group graph
      // is a forest, parent_id chains never cycle).
      if (parent_id) {
        if (parent_id === groupId) {
          res.status(400).json({ error: 'A group cannot be its own parent' })
          return
        }
        if (await isStrictDescendantGroup(supabase, groupId, parent_id)) {
          res.status(400).json({ error: 'Cannot re-parent a group under its own descendant' })
          return
        }
      }

      // Duplicate-name WARNING on rename (never a constraint) — the same rule
      // POST /api/groups applies at creation, and the same 409 body, so the
      // client reads it with the one readDuplicateWarning(). Runs AFTER
      // authorization and the cycle checks and BEFORE the update, so a warned
      // rename writes nothing at all. `confirm_duplicate: true` skips the
      // lookup entirely and behaves exactly as this endpoint did before.
      //
      // Two things rename has to get right that creation didn't:
      //  · EXCLUDE THE ROW ITSELF — renaming "Deborah Testing" to
      //    "deborah-testing" is the same slug on the same row, not a clash.
      //  · Compare against the EFFECTIVE parent and name after the patch. A
      //    PATCH may carry both a new name and a new parent_id (ssi_admin
      //    only), and a pure re-parent that lands a group next to a same-named
      //    sibling produces exactly the ambiguous path this warning exists for.
      // Both reads fail open (see _utils/groupSlug.ts): no warning ever costs
      // someone their rename.
      if (!confirm_duplicate && (name !== undefined || parent_id !== undefined)) {
        const current = await readGroupNameAndParent(supabase, groupId)
        if (current) {
          const effectiveName = name !== undefined ? String(name).trim() : current.name
          const effectiveParent = parent_id !== undefined ? (parent_id || null) : current.parent_id
          const duplicates = (await findSiblingSlugCollisions(supabase, effectiveName, effectiveParent))
            .filter((d) => d.id !== groupId)
          if (duplicates.length > 0) {
            // Same redaction rule as creation: a ROOT collision is with
            // another tenant's organisation, so a non-admin sees only the name
            // and the date. A non-root collision is a sibling inside the
            // subtree this caller has already been validated against.
            res.status(409).json(
              duplicateNameBody(duplicates, {
                detailed: isAdmin || !!effectiveParent,
                noun: effectiveParent ? 'group' : 'organisation',
              }),
            )
            return
          }
        }
      }

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

      // If this group IS a school's own node, its name and the school
      // record's name are one name with two homes — carry the rename across,
      // or every surface reading `schools.school_name` keeps the old one
      // (_utils/schoolNodeName.ts). Deliberately AFTER the duplicate-name
      // warning above, never around it: a rename that got warned and wrote
      // nothing must not write the school either.
      if (name !== undefined) {
        await syncSchoolNameForNode(supabase, groupId, String(name).trim())
      }

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
