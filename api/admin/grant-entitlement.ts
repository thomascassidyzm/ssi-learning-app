/**
 * Grant Entitlement API - POST /api/admin/grant-entitlement
 *
 * Directly grants an entitlement to a user (without a code).
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
  // hand-rolled platform_role check under the service-role key. One definition of
  // "admin" for the whole surface — it also honours educational_role 'god' and
  // reads the caller's row under the caller's own token, and it distinguishes a
  // transient failure (500) from genuinely-not-an-admin (403).
  const admin = await verifyAdmin(req)
  if ('error' in admin) {
    res.status(admin.status).json({ error: admin.error })
    return
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  const { learner_id, access_type, granted_courses, duration_type, duration_days } = req.body || {}

  if (!learner_id) {
    res.status(400).json({ error: 'learner_id is required' })
    return
  }

  if (!access_type || !['full', 'courses'].includes(access_type)) {
    res.status(400).json({ error: 'Invalid access_type' })
    return
  }

  if (access_type === 'courses' && (!granted_courses || !Array.isArray(granted_courses) || granted_courses.length === 0)) {
    res.status(400).json({ error: 'granted_courses required for "courses" access type' })
    return
  }

  if (!duration_type || !['lifetime', 'time_limited'].includes(duration_type)) {
    res.status(400).json({ error: 'Invalid duration_type' })
    return
  }

  try {
    // Calculate expiry
    let expires_at = null
    if (duration_type === 'time_limited') {
      const days = duration_days || 30
      expires_at = new Date(Date.now() + days * 86400000).toISOString()
    }

    const { data, error } = await supabase
      .from('user_entitlements')
      .insert({
        learner_id,
        entitlement_code_id: null,
        access_type,
        granted_courses: access_type === 'courses' ? granted_courses : null,
        expires_at,
      })
      .select()
      .single()

    if (error) {
      console.error('[GrantEntitlement] Insert error:', error)
      res.status(500).json({ error: 'Failed to grant entitlement' })
      return
    }

    console.log('[GrantEntitlement] Granted:', access_type, 'to learner:', learner_id, 'by:', admin.userId)
    res.status(201).json({ entitlement: data })
  } catch (err) {
    console.error('[GrantEntitlement] Error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
}
