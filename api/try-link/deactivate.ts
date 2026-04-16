/**
 * Try Link Deactivate API - POST /api/try-link/deactivate
 *
 * Admin-only. Deactivates a try link so it can no longer be used.
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

  // Verify caller is admin
  const { data: learner } = await supabase
    .from('learners')
    .select('platform_role, educational_role')
    .eq('user_id', authResult.userId)
    .single()

  if (!learner || (learner.platform_role !== 'ssi_admin' && learner.educational_role !== 'god')) {
    res.status(403).json({ error: 'Only SSi admins can deactivate try links' })
    return
  }

  const { id } = req.body || {}

  if (!id || typeof id !== 'string') {
    res.status(400).json({ error: 'id is required' })
    return
  }

  try {
    const { error: updateError } = await supabase
      .from('try_links')
      .update({ is_active: false })
      .eq('id', id)

    if (updateError) {
      throw updateError
    }

    console.log('[TryLinkDeactivate] Deactivated:', id, 'by:', authResult.userId)
    res.status(200).json({ success: true })
  } catch (error: any) {
    console.error('[TryLinkDeactivate] Error:', error)
    res.status(500).json({ error: error?.message || 'Internal server error' })
  }
}
