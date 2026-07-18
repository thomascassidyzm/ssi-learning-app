/**
 * Current-user engaged-time API - GET /api/me/engaged-time
 *
 * Auth required. Returns the authenticated learner's total TIME IN APP —
 * the commitment metric the learner sees in the Library ("Total Time").
 *
 * This is the SAME definition the admin surfaces use (admin_practice_minutes):
 * sessions.duration_seconds, summed per course, per learner. When a course
 * has no session logs but the learner has made progress, the RPC falls back
 * to a position-derived estimate and flags it via is_estimated — surfaced
 * here as `isEstimated` so the client can render the "~" prefix.
 *
 * Scoped to the caller's own learner id, so reusing the admin RPC here only ever
 * returns the caller's own number.
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
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const authResult = await verifyAuthToken(req)
  if (!authResult.valid || !authResult.userId) {
    res.status(401).json({ error: authResult.error || 'Unauthorized' })
    return
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  try {
    const { data: learner } = await supabase
      .from('learners')
      .select('id')
      .eq('user_id', authResult.userId)
      .maybeSingle()

    if (!learner) {
      res.status(200).json({ engagedMinutes: 0 })
      return
    }

    const { data, error } = await supabase.rpc('admin_practice_minutes', {
      p_learner_ids: [learner.id],
    })
    if (error) {
      console.error('[me/engaged-time] RPC error:', error)
      // Fail soft — the client falls back to its local estimate.
      res.status(200).json({ engagedMinutes: null })
      return
    }

    const row = Array.isArray(data) && data[0] ? data[0] : null
    res.status(200).json({
      engagedMinutes: row?.practice_minutes ?? 0,
      isEstimated: !!row?.is_estimated,
    })
  } catch (error: any) {
    console.error('[me/engaged-time] Error:', error)
    res.status(200).json({ engagedMinutes: null })
  }
}
