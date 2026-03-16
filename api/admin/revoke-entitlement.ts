/**
 * Revoke Entitlement API - POST /api/admin/revoke-entitlement
 *
 * Removes an entitlement from a user.
 * Requires auth. Only ssi_admin users can call this.
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

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  // Verify caller is ssi_admin
  const { data: caller } = await supabase
    .from('learners')
    .select('platform_role')
    .eq('user_id', authResult.userId)
    .single()

  if (!caller || caller.platform_role !== 'ssi_admin') {
    res.status(403).json({ error: 'Only SSi admins can revoke entitlements' })
    return
  }

  const { entitlement_id } = req.body || {}

  if (!entitlement_id) {
    res.status(400).json({ error: 'entitlement_id is required' })
    return
  }

  try {
    // Get the entitlement to check for associated code
    const { data: entitlement } = await supabase
      .from('user_entitlements')
      .select('entitlement_code_id')
      .eq('id', entitlement_id)
      .single()

    if (!entitlement) {
      res.status(404).json({ error: 'Entitlement not found' })
      return
    }

    // Delete the entitlement
    const { error } = await supabase
      .from('user_entitlements')
      .delete()
      .eq('id', entitlement_id)

    if (error) {
      console.error('[RevokeEntitlement] Delete error:', error)
      res.status(500).json({ error: 'Failed to revoke entitlement' })
      return
    }

    // Decrement use_count on the code if it was code-based
    if (entitlement.entitlement_code_id) {
      await supabase.rpc('decrement_entitlement_use_count', {
        code_id: entitlement.entitlement_code_id,
      }).catch(() => {
        // Non-critical — just means use_count may be off by one
      })
    }

    console.log('[RevokeEntitlement] Revoked:', entitlement_id, 'by:', authResult.userId)
    res.status(200).json({ success: true })
  } catch (err) {
    console.error('[RevokeEntitlement] Error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
}
