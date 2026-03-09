/**
 * User Entitlements API - GET /api/entitlement/user
 *
 * Requires auth. Returns the current user's active (non-expired) entitlements.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { verifyAuthToken } from '../_utils/auth'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

if (!supabaseUrl) {
  throw new Error('Missing SUPABASE_URL environment variable')
}

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
  const userId = authResult.userId

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  try {
    // Get learner_id
    const { data: learner } = await supabase
      .from('learners')
      .select('id')
      .eq('user_id', userId)
      .single()

    if (!learner) {
      res.status(200).json({ entitlements: [] })
      return
    }

    // Get active entitlements (not expired)
    const { data: entitlements, error } = await supabase
      .from('user_entitlements')
      .select('id, access_type, granted_courses, expires_at, redeemed_at, entitlement_code_id')
      .eq('learner_id', learner.id)

    if (error) {
      console.error('[EntitlementUser] Query error:', error)
      res.status(500).json({ error: 'Internal server error' })
      return
    }

    // Filter out expired entitlements
    const now = new Date()
    const active = (entitlements || []).filter((e) => {
      if (!e.expires_at) return true // lifetime
      return new Date(e.expires_at) > now
    })

    res.status(200).json({ entitlements: active })
  } catch (error) {
    console.error('[EntitlementUser] Error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
}
