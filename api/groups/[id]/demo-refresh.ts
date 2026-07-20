/**
 * Demo Refresh API - POST /api/groups/:id/demo-refresh
 *
 * "Refresh demo activity" — the verb on a DEMO node in the Structure tree
 * (founder-ruled 2026-07-19). Regenerates the node's subtree's synthetic
 * student telemetry up to the minute so demo dashboards never read
 * burst-then-dead. Replace-not-stack: idempotent by regeneration.
 *
 * Admin-gated (verifyAdmin) and service-role only — demo telemetry writes
 * never ride a user session. All demo-safety guards (is_demo on the node,
 * every subtree school, every touched learner) live server-side in
 * api/_utils/demoNodeRefresh.ts and refuse rather than skip.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { verifyAdmin } from '../../_utils/auth'
import { refreshDemoNodeActivity } from '../../_utils/demoNodeRefresh'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const groupId = req.query.id as string
  if (!groupId) {
    res.status(400).json({ error: 'Group ID is required' })
    return
  }

  const admin = await verifyAdmin(req)
  if ('error' in admin) {
    res.status(admin.status).json({ error: admin.error })
    return
  }

  if (!supabaseUrl || !supabaseServiceKey) {
    res.status(500).json({ error: 'Server configuration error' })
    return
  }
  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  try {
    const result = await refreshDemoNodeActivity(supabase, groupId, admin.userId)
    res.status(200).json({ success: true, ...result })
  } catch (error: any) {
    console.error('[DemoRefresh] Error:', error)
    const message = error?.message || 'Failed to refresh demo activity'
    res.status(message.startsWith('Refresh refused') ? 403 : 500).json({ error: message })
  }
}
