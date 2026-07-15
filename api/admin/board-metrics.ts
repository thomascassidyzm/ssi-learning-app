/**
 * Board Metrics API - GET /api/admin/board-metrics
 *
 * Admin-only. Resolves every metric in the board registry (api/_utils/boardMetrics.ts)
 * live against the DB and returns { slug, label, method, value, asOf } per metric —
 * the numbers behind {{metric:...}} tokens on /admin/board.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { verifyAdmin } from '../_utils/auth'
import { resolveAllBoardMetrics } from '../_utils/boardMetrics'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const admin = await verifyAdmin(req)
  if ('error' in admin) {
    res.status(admin.status).json({ error: admin.error })
    return
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey)
    const metrics = await resolveAllBoardMetrics(supabase)
    res.status(200).json({ metrics })
  } catch (error: any) {
    console.error('[BoardMetrics] Error:', error)
    res.status(500).json({ error: error?.message || 'Internal server error' })
  }
}
