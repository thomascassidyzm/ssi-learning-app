/**
 * Update User Role API - POST /api/admin/update-user-role
 *
 * Sets learners.platform_role or learners.educational_role for a given learner.
 * Replaces the direct client UPDATE that was blocked by
 * 20260521200000_fix_learners_update_grant_to_safe_columns.sql
 * (which REVOKEs table-level UPDATE and only re-GRANTs safe columns).
 *
 * Requires ssi_admin / god caller — enforced by verifyAdmin().
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { verifyAdmin } from '../_utils/auth'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

// Mirrors the CHECK constraints on learners (see 20260331_tester_role.sql
// for platform_role and 20260226_rls_entitlements_fix.sql for educational_role).
// null is permitted to clear the role.
const ALLOWED_PLATFORM_ROLES = new Set(['ssi_admin', 'popty_user', 'tester'])
const ALLOWED_EDUCATIONAL_ROLES = new Set(['god', 'student', 'teacher', 'school_admin', 'govt_admin'])

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const adminResult = await verifyAdmin(req)
  if ('error' in adminResult) {
    res.status(adminResult.status).json({ error: adminResult.error })
    return
  }

  const { learner_id, field, value } = (req.body || {}) as {
    learner_id?: string
    field?: string
    value?: string | null
  }

  if (!learner_id || typeof learner_id !== 'string') {
    res.status(400).json({ error: 'learner_id is required' })
    return
  }

  if (field !== 'platform_role' && field !== 'educational_role') {
    res.status(400).json({ error: "field must be 'platform_role' or 'educational_role'" })
    return
  }

  if (value !== null && typeof value !== 'string') {
    res.status(400).json({ error: 'value must be a string or null' })
    return
  }

  if (value !== null) {
    const allowed = field === 'platform_role' ? ALLOWED_PLATFORM_ROLES : ALLOWED_EDUCATIONAL_ROLES
    if (!allowed.has(value)) {
      res.status(400).json({
        error: `Invalid value for ${field}. Allowed: ${[...allowed].join(', ')} or null`,
      })
      return
    }
  }

  if (!supabaseUrl || !supabaseServiceKey) {
    res.status(500).json({ error: 'Server configuration error' })
    return
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  try {
    const { data, error } = await supabase
      .from('learners')
      .update({ [field]: value })
      .eq('id', learner_id)
      .select()
      .single()

    if (error) {
      console.error('[UpdateUserRole] Update error:', error)
      res.status(500).json({ error: 'Failed to update role', detail: error.message })
      return
    }

    if (!data) {
      res.status(404).json({ error: 'Learner not found' })
      return
    }

    console.log('[UpdateUserRole]', field, '=', value, 'for learner', learner_id, 'by', adminResult.userId)
    res.status(200).json({ learner: data })
  } catch (err) {
    console.error('[UpdateUserRole] Error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
}
