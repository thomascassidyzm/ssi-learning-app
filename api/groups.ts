/**
 * Groups API - GET/POST /api/groups
 *
 * GET: List all groups (tree structure)
 * POST: Create a new group
 *
 * Requires auth. Only ssi_admin/god users.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { verifyAuthToken } from './_utils/auth'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  const authResult = await verifyAuthToken(req)
  if (!authResult.valid || !authResult.userId) {
    res.status(401).json({ error: authResult.error || 'Unauthorized' })
    return
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  // Verify caller is ssi_admin or god
  const { data: learner } = await supabase
    .from('learners')
    .select('platform_role, educational_role')
    .eq('user_id', authResult.userId)
    .single()

  const isAdmin = learner?.platform_role === 'ssi_admin' ||
    learner?.educational_role === 'god'

  if (!isAdmin) {
    res.status(403).json({ error: 'Only SSi admins can manage groups' })
    return
  }

  if (req.method === 'GET') {
    try {
      const { data: groups, error } = await supabase
        .from('groups')
        .select('id, name, type, parent_id, created_at')
        .order('name')

      if (error) throw error

      // Also fetch school counts per group
      const { data: schools } = await supabase
        .from('schools')
        .select('id, group_id')

      const schoolCounts: Record<string, number> = {}
      for (const s of schools || []) {
        if (s.group_id) {
          schoolCounts[s.group_id] = (schoolCounts[s.group_id] || 0) + 1
        }
      }

      // Also fetch grant info per group
      const { data: grants } = await supabase
        .from('entitlement_grants')
        .select('group_id, granted_courses')
        .not('group_id', 'is', null)

      const grantMap: Record<string, string[]> = {}
      for (const g of grants || []) {
        if (g.group_id) {
          grantMap[g.group_id] = g.granted_courses
        }
      }

      const enriched = (groups || []).map((g) => ({
        ...g,
        school_count: schoolCounts[g.id] || 0,
        granted_courses: grantMap[g.id] || [],
      }))

      res.status(200).json({ groups: enriched })
    } catch (error) {
      console.error('[Groups] List error:', error)
      res.status(500).json({ error: 'Internal server error' })
    }
  } else if (req.method === 'POST') {
    try {
      const { name, type, parent_id } = req.body || {}

      if (!name?.trim()) {
        res.status(400).json({ error: 'Group name is required' })
        return
      }

      const row: Record<string, unknown> = {
        name: name.trim(),
        type: type?.trim() || 'region',
      }
      if (parent_id) row.parent_id = parent_id

      const { data, error } = await supabase
        .from('groups')
        .insert(row)
        .select()
        .single()

      if (error) throw error
      res.status(201).json({ group: data })
    } catch (error) {
      console.error('[Groups] Create error:', error)
      res.status(500).json({ error: 'Internal server error' })
    }
  } else {
    res.status(405).json({ error: 'Method not allowed' })
  }
}
