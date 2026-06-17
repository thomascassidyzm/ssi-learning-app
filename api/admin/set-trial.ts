/**
 * Set Trial State API - POST /api/admin/set-trial
 *
 * Admin-only test helper: "skip to end of trial" (or restore it) for one user.
 * Backdates the platform-subscription trial (school + tutor) and any self-granted
 * course play-trial entitlement so the end-of-trial gates fire immediately on the
 * target account's next load. Touches ONLY the rows owned by the target user.
 *
 * Requires auth. Only ssi_admin (or legacy god) users can call this.
 *
 * Body: { user_id: string (auth uid of the target), action: 'expire' | 'restore' }
 *
 * NOTE: a 'trial' with a null/future expiry resolves to ACTIVE (fail-open), so
 * expiring sets BOTH platform_status='expired' AND a past expiry. Restore sets
 * status back to 'trial' with a +30d window.
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

  const admin = await verifyAdmin(req)
  if ('error' in admin) {
    res.status(admin.status).json({ error: admin.error })
    return
  }

  const { user_id, action } = req.body || {}
  if (!user_id || typeof user_id !== 'string') {
    res.status(400).json({ error: 'user_id (auth uid) is required' })
    return
  }
  if (action !== 'expire' && action !== 'restore') {
    res.status(400).json({ error: "action must be 'expire' or 'restore'" })
    return
  }

  const restore = action === 'restore'
  const when = restore
    ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    : new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const status = restore ? 'trial' : 'expired'

  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Resolve the learner PK from the auth uid (teachers + entitlements key on it).
    const { data: learner } = await supabase
      .from('learners')
      .select('id')
      .eq('user_id', user_id)
      .single()
    const learnerId = learner?.id ?? null

    // School the user administers.
    const { data: schools } = await supabase
      .from('schools')
      .update({ platform_status: status, platform_expires_at: when })
      .eq('admin_user_id', user_id)
      .select('id')

    let teachers: unknown[] | null = null
    let entitlements: unknown[] | null = null
    if (learnerId) {
      const t = await supabase
        .from('teachers')
        .update({ platform_status: status, platform_expires_at: when })
        .eq('learner_id', learnerId)
        .select('id')
      teachers = t.data

      // Self-granted course play-trials only (not code/email-grant backed).
      const e = await supabase
        .from('user_entitlements')
        .update({ expires_at: when })
        .eq('learner_id', learnerId)
        .is('email_access_grant_id', null)
        .not('expires_at', 'is', null)
        .select('id')
      entitlements = e.data
    }

    res.status(200).json({
      success: true,
      action,
      changed: {
        schools: schools?.length ?? 0,
        teachers: teachers?.length ?? 0,
        entitlements: entitlements?.length ?? 0,
      },
    })
  } catch (err) {
    console.error('[SetTrial] Error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
}
