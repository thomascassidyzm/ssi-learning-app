/**
 * Public Board Snapshot API - GET /api/board/snapshot/:code
 *
 * Public, no auth — capability-by-unguessability (living-board-report-spec.md
 * §5, the try-link trust model). Single-row lookup by share_code; nothing
 * else is queryable through this route. 404s on missing OR revoked so a
 * probe can't distinguish "never existed" from "revoked".
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

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

  const code = req.query.code as string
  if (!code) {
    res.status(400).json({ error: 'code is required' })
    return
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  try {
    const { data: snapshot, error } = await supabase
      .from('board_snapshots')
      .select('label, report_month, payload, revoked_at')
      .eq('share_code', code)
      .maybeSingle()

    if (error) throw error

    if (!snapshot || snapshot.revoked_at) {
      res.status(404).json({ error: 'Not found' })
      return
    }

    const payload = (snapshot.payload || {}) as { markdown?: string; resolvedMetrics?: Record<string, unknown>; frozenAt?: string }

    res.status(200).json({
      label: snapshot.label,
      reportMonth: snapshot.report_month,
      markdown: payload.markdown ?? '',
      resolvedMetrics: payload.resolvedMetrics ?? {},
      frozenAt: payload.frozenAt ?? null,
    })
  } catch (error: any) {
    console.error('[BoardSnapshotPublic] Error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
}
