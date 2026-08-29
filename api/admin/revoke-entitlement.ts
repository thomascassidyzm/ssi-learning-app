/**
 * Revoke Entitlement API - POST /api/admin/revoke-entitlement
 *
 * Removes an entitlement from a user.
 * Requires auth. Only ssi_admin users can call this.
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
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  // ADMIN-ENT-12 (fixed 2026-08-25): use the shared verifyAdmin() rather than a
  // hand-rolled platform_role check under the service-role key — see the twin
  // comment in grant-entitlement.ts.
  const admin = await verifyAdmin(req)
  if ('error' in admin) {
    res.status(admin.status).json({ error: admin.error })
    return
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

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

    // Decrement use_count on the code if it was code-based. The PostgREST
    // builder is a thenable but has no .catch — the old `.catch(() => {})`
    // threw synchronously (TypeError), bubbling to the outer catch so a
    // successful revoke reported a 500 and the decrement never ran. rpc()
    // resolves with { error } instead of rejecting, so inspect that.
    if (entitlement.entitlement_code_id) {
      const { error: decErr } = await supabase.rpc('decrement_entitlement_use_count', {
        code_id: entitlement.entitlement_code_id,
      })
      if (decErr) {
        // Non-critical — just means use_count may be off by one.
        console.warn('[RevokeEntitlement] use_count decrement failed (non-critical):', decErr.message)
      }
    }

    console.log('[RevokeEntitlement] Revoked:', entitlement_id, 'by:', admin.userId)
    res.status(200).json({ success: true })
  } catch (err) {
    console.error('[RevokeEntitlement] Error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
}
