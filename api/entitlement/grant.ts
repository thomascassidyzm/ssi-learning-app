/**
 * Entitlement Grant API - POST /api/entitlement/grant
 *
 * Assign course entitlements to a group, school, or class.
 * Requires auth. Only ssi_admin/god users can manage grants.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { verifyAuthToken } from '../_utils/auth'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const authResult = await verifyAuthToken(req)
  if (!authResult.valid || !authResult.userId) {
    res.status(401).json({ error: authResult.error || 'Unauthorized' })
    return
  }
  const userId = authResult.userId

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  try {
    const { group_id, school_id, class_id, granted_courses, expires_at } = req.body || {}

    // Validate exactly one target
    const targets = [group_id, school_id, class_id].filter(Boolean)
    if (targets.length !== 1) {
      res.status(400).json({ error: 'Exactly one of group_id, school_id, or class_id is required' })
      return
    }

    if (!Array.isArray(granted_courses) || granted_courses.length === 0) {
      res.status(400).json({ error: 'granted_courses must be a non-empty array of course codes' })
      return
    }

    // Upsert: if a grant already exists for this target, update it
    const matchColumn = group_id ? 'group_id' : school_id ? 'school_id' : 'class_id'
    const matchValue = group_id || school_id || class_id

    // Check for existing grant
    const { data: existing } = await supabase
      .from('entitlement_grants')
      .select('id')
      .eq(matchColumn, matchValue)
      .single()

    if (existing) {
      // Update existing grant
      const { data, error } = await supabase
        .from('entitlement_grants')
        .update({
          granted_courses,
          granted_by: userId,
          updated_at: new Date().toISOString(),
          expires_at: expires_at || null,
          is_active: true,
        })
        .eq('id', existing.id)
        .select()
        .single()

      if (error) throw error
      res.status(200).json({ grant: data, updated: true })
    } else {
      // Create new grant
      const row: Record<string, unknown> = {
        granted_courses,
        granted_by: userId,
        is_active: true,
      }
      if (group_id) row.group_id = group_id
      if (school_id) row.school_id = school_id
      if (class_id) row.class_id = class_id
      if (expires_at) row.expires_at = expires_at

      const { data, error } = await supabase
        .from('entitlement_grants')
        .insert(row)
        .select()
        .single()

      if (error) throw error
      res.status(201).json({ grant: data, created: true })
    }
  } catch (error) {
    console.error('[EntitlementGrant] Error:', error)
    res.status(500).json({ error: 'Internal server error', detail: String(error) })
  }
}
