/**
 * Email-allowlist list API - GET /api/access/list-grants
 *
 * ADMIN-GATED (ssi_admin / god). Lists email_access_grants for the admin UI.
 * email_access_grants is RLS-on with no policy, so this service-role route is
 * the only way to read it.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { verifyAdmin } from '../_utils/auth'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  if (!supabaseUrl || !supabaseServiceKey) {
    res.status(500).json({ error: 'Server misconfigured' })
    return
  }

  const adminResult = await verifyAdmin(req)
  if ('error' in adminResult) {
    res.status(adminResult.status).json({ error: adminResult.error })
    return
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  try {
    const { data: grants, error } = await supabase
      .from('email_access_grants')
      .select('id, email, access_type, granted_courses, duration_type, duration_days, label, is_active, created_at, redeemed_at')
      .order('created_at', { ascending: false })
      .limit(500)

    if (error) {
      console.error('[AccessListGrants] Query error:', error)
      res.status(500).json({ error: 'Query failed' })
      return
    }

    res.status(200).json({ grants: grants || [] })
  } catch (err) {
    console.error('[AccessListGrants] Error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
}
