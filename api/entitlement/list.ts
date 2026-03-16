/**
 * Entitlement Code List API - GET /api/entitlement/list
 *
 * Requires auth. Only ssi_admin users can list all entitlement codes.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { verifyAuthToken } from '../_utils/auth'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('[EntitlementList] Missing env vars:', { hasUrl: !!supabaseUrl, hasKey: !!supabaseServiceKey })
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  if (!supabaseUrl || !supabaseServiceKey) {
    res.status(500).json({ error: 'Server misconfigured — missing SUPABASE_SERVICE_ROLE_KEY' })
    return
  }

  const authResult = await verifyAuthToken(req)
  if (!authResult.valid || !authResult.userId) {
    res.status(401).json({ error: authResult.error || 'Unauthorized' })
    return
  }
  const userId = authResult.userId

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  // Verify caller is ssi_admin or god
  const { data: learner } = await supabase
    .from('learners')
    .select('platform_role, educational_role')
    .eq('user_id', userId)
    .single()

  if (!learner || (learner.platform_role !== 'ssi_admin' && learner.educational_role !== 'god')) {
    res.status(403).json({ error: 'Only SSi admins can list entitlement codes' })
    return
  }

  try {
    const { data: codes, error } = await supabase
      .from('entitlement_codes')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) {
      console.error('[EntitlementList] Query error:', error)
      res.status(500).json({ error: 'Internal server error' })
      return
    }

    res.status(200).json({ codes: codes || [] })
  } catch (error) {
    console.error('[EntitlementList] Error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
}
