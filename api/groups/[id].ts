/**
 * Group by ID API - PATCH/DELETE /api/groups/:id
 *
 * PATCH: Rename a group
 * DELETE: Delete a group (schools become ungrouped)
 *
 * Requires auth. Only ssi_admin/god users.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { verifyAdmin } from '../_utils/auth'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  const adminResult = await verifyAdmin(req)
  if ('error' in adminResult) {
    res.status(adminResult.status).json({ error: adminResult.error })
    return
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  const groupId = req.query.id as string
  if (!groupId) {
    res.status(400).json({ error: 'Group ID is required' })
    return
  }

  if (req.method === 'PATCH') {
    try {
      const { name, type, parent_id } = req.body || {}
      const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }

      if (name !== undefined) updates.name = name.trim()
      if (type !== undefined) updates.type = type.trim()
      if (parent_id !== undefined) updates.parent_id = parent_id || null

      const { data, error } = await supabase
        .from('groups')
        .update(updates)
        .eq('id', groupId)
        .select()
        .single()

      if (error) throw error
      res.status(200).json({ group: data })
    } catch (error) {
      console.error('[Groups] Update error:', error)
      res.status(500).json({ error: 'Internal server error' })
    }
  } else if (req.method === 'DELETE') {
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
