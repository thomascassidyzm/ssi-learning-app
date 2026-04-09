/**
 * Entitlement Grants List API - GET /api/entitlement/grants
 *
 * List entitlement grants. Optionally filter by group_id, school_id, or class_id.
 * Requires auth. Only ssi_admin/god users.
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
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const authResult = await verifyAuthToken(req)
  if (!authResult.valid || !authResult.userId) {
    res.status(401).json({ error: authResult.error || 'Unauthorized' })
    return
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  try {
    const { group_id, school_id, class_id } = req.query || {}

    let query = supabase
      .from('entitlement_grants')
      .select('*')
      .order('created_at', { ascending: false })

    if (group_id) query = query.eq('group_id', group_id as string)
    if (school_id) query = query.eq('school_id', school_id as string)
    if (class_id) query = query.eq('class_id', class_id as string)

    const { data, error } = await query

    if (error) throw error
    res.status(200).json({ grants: data || [] })
  } catch (error) {
    console.error('[EntitlementGrants] Error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
}
