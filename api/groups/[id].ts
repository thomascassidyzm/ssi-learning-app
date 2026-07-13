/**
 * Group by ID API - PATCH/DELETE /api/groups/:id
 *
 * PATCH: Rename a group (name/type/parent_id — ssi_admin), OR a name-only
 *   self-rename by the leader who governs this exact group
 *   (region-tier-design.md §1d — "name your group"). The leader path is a
 *   SERVER-DERIVED ownership check: the caller's own govt_admins.group_id
 *   must equal the target id — never trust a client claim of which group
 *   they lead. type/parent_id stay ssi_admin-only: a leader must never
 *   re-parent themselves up the tree.
 * DELETE: Delete a group (schools become ungrouped) — ssi_admin only.
 *
 * Requires auth.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { verifyAdmin, verifyAuthToken } from '../_utils/auth'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

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
  } else if (req.method === 'DELETE') {
    const adminResult = await verifyAdmin(req)
    if ('error' in adminResult) {
      res.status(adminResult.status).json({ error: adminResult.error })
      return
    }
    try {
      // Ungroup schools first
      await supabase
        .from('schools')
        .update({ group_id: null })
        .eq('group_id', groupId)

      // Delete group
      const { error } = await supabase
        .from('groups')
        .delete()
        .eq('id', groupId)

      if (error) throw error
      res.status(200).json({ deleted: true })
    } catch (error) {
      console.error('[Groups] Delete error:', error)
      res.status(500).json({ error: 'Internal server error' })
    }
  } else {
    res.status(405).json({ error: 'Method not allowed' })
  }
}
