/**
 * View-as audit log — POST /api/admin/view-as
 *
 * Server-side audit trail for the ssi_admin "View as" feature
 * (useActAs.ts). Writes to admin_impersonation_audit (service-role only —
 * see supabase/migrations/20260717b_admin_impersonation_audit.sql). This IS
 * the GDPR legitimate-interest compliance record: every view-as session is
 * logged with who, whom, when, and from where.
 *
 * Body: { action: 'start', target_user_id, target_role, target_name?, target_school_id? }
 *     -> { id }               — the audit row id, kept client-side so 'end' can close it
 *   or { action: 'end', id }
 *     -> { ok: true }
 *
 * Best-effort like auditAdminDelete.ts — a logging failure never blocks the
 * admin's own view-as flow (it already ran client-side by the time this is
 * called), but IS surfaced (500) so a broken audit path doesn't fail silently.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { verifyAdmin } from '../_utils/auth'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

function clientIp(req: VercelRequest): string | null {
  const fwd = req.headers['x-forwarded-for']
  if (typeof fwd === 'string' && fwd.length > 0) return fwd.split(',')[0].trim()
  if (Array.isArray(fwd) && fwd.length > 0) return fwd[0]
  return req.socket?.remoteAddress ?? null
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }
  if (!supabaseUrl || !supabaseServiceKey) {
    res.status(500).json({ error: 'Server configuration error' })
    return
  }

  const adminResult = await verifyAdmin(req)
  if ('error' in adminResult) {
    res.status(adminResult.status).json({ error: adminResult.error })
    return
  }

  const body = (req.body || {}) as Record<string, unknown>
  const action = body.action

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  if (action === 'start') {
    const targetUserId = typeof body.target_user_id === 'string' ? body.target_user_id : ''
    const targetRole = typeof body.target_role === 'string' ? body.target_role : ''
    if (!targetUserId || !targetRole) {
      res.status(400).json({ error: 'target_user_id and target_role are required' })
      return
    }
    const { data, error } = await supabase
      .from('admin_impersonation_audit')
      .insert({
        admin_user_id: adminResult.userId,
        target_user_id: targetUserId,
        target_role: targetRole,
        target_name: typeof body.target_name === 'string' ? body.target_name : null,
        target_school_id: typeof body.target_school_id === 'string' ? body.target_school_id : null,
        ip_address: clientIp(req),
        user_agent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
      })
      .select('id')
      .single()

    if (error || !data) {
      console.error('[view-as] audit insert failed:', error)
      res.status(500).json({ error: error?.message || 'Failed to log view-as session' })
      return
    }
    res.status(200).json({ id: data.id })
    return
  }

  if (action === 'end') {
    const id = typeof body.id === 'string' ? body.id : ''
    if (!id) {
      res.status(400).json({ error: 'id is required' })
      return
    }
    // Scoped to this admin's own row — an admin can only close their own
    // view-as session, never fabricate the end of someone else's.
    const { error } = await supabase
      .from('admin_impersonation_audit')
      .update({ ended_at: new Date().toISOString() })
      .eq('id', id)
      .eq('admin_user_id', adminResult.userId)

    if (error) {
      console.error('[view-as] audit close failed:', error)
      res.status(500).json({ error: error.message })
      return
    }
    res.status(200).json({ ok: true })
    return
  }

  res.status(400).json({ error: 'action must be "start" or "end"' })
}
