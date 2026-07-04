/**
 * Admin Codes API - /api/admin/codes
 *
 * GET  — list invite codes. ssi_admin/god see all; other callers (e.g. govt
 *        admins issuing school_admin invites) see only codes they created —
 *        mirrors the client-side scoping AdminAccess.vue applied when it read
 *        invite_codes directly.
 * POST — toggle a code's is_active. Body: { kind: 'invite'|'entitlement', id,
 *        is_active }. ssi_admin/god may toggle anything; other callers only
 *        invite codes they created.
 *
 * Replaces the direct client reads/updates of invite_codes in AdminAccess.vue
 * so authenticated SELECT on the base table can be revoked (the code strings
 * are bearer credentials — see 20260704_gated_invite_codes_select_revoke.sql).
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { verifyAuthToken } from '../_utils/auth'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('[AdminCodes] Missing env vars:', { hasUrl: !!supabaseUrl, hasKey: !!supabaseServiceKey })
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'POST') {
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

  const { data: learner } = await supabase
    .from('learners')
    .select('platform_role, educational_role')
    .eq('user_id', userId)
    .single()

  const isSsiAdmin = learner?.platform_role === 'ssi_admin' || learner?.educational_role === 'god'

  if (req.method === 'GET') {
    try {
      let query = supabase
        .from('invite_codes')
        .select('*')
        .order('created_at', { ascending: false })
      if (!isSsiAdmin) query = query.eq('created_by', userId)

      const { data: codes, error } = await query
      if (error) {
        console.error('[AdminCodes] Query error:', error)
        res.status(500).json({ error: 'Internal server error' })
        return
      }

      res.status(200).json({ codes: codes || [] })
    } catch (error) {
      console.error('[AdminCodes] Error:', error)
      res.status(500).json({ error: 'Internal server error' })
    }
    return
  }

  // POST — toggle is_active
  const { kind, id, is_active } = (req.body || {}) as {
    kind?: string
    id?: string
    is_active?: boolean
  }

  if (kind !== 'invite' && kind !== 'entitlement') {
    res.status(400).json({ error: "kind must be 'invite' or 'entitlement'" })
    return
  }
  if (!id || typeof id !== 'string') {
    res.status(400).json({ error: 'id is required' })
    return
  }
  if (typeof is_active !== 'boolean') {
    res.status(400).json({ error: 'is_active must be a boolean' })
    return
  }

  const table = kind === 'invite' ? 'invite_codes' : 'entitlement_codes'

  if (!isSsiAdmin) {
    // Non-admins may only toggle invite codes they created.
    if (kind !== 'invite') {
      res.status(403).json({ error: 'Only SSi admins can toggle entitlement codes' })
      return
    }
    const { data: row } = await supabase
      .from('invite_codes')
      .select('created_by')
      .eq('id', id)
      .single()
    if (!row || row.created_by !== userId) {
      res.status(403).json({ error: 'You can only toggle codes you created' })
      return
    }
  }

  try {
    const { error } = await supabase
      .from(table)
      .update({ is_active })
      .eq('id', id)

    if (error) {
      console.error('[AdminCodes] Toggle error:', error)
      res.status(500).json({ error: 'Internal server error' })
      return
    }

    res.status(200).json({ ok: true, is_active })
  } catch (error) {
    console.error('[AdminCodes] Error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
}
