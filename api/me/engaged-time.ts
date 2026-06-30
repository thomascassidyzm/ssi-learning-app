/**
 * Current-user engaged-time API - GET /api/me/engaged-time
 *
 * Auth required. Returns the authenticated learner's total TIME IN APP —
 * the commitment metric the learner sees in the Library ("Total Time").
 *
 * This is the SAME definition the admin surfaces use (admin_practice_minutes):
 * per session_id, span = max(occurred_at) - min(occurred_at); keep sessions
 * >= 30s, cap each at 2h; sum -> minutes. Derived from player_events session
 * spans, NOT audio-playback seconds — so it reflects real engaged time
 * (including main-flow listening, and listening-mode once its heartbeat lands),
 * not just how long audio was playing.
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

    const minutes = Array.isArray(data) && data[0] ? (data[0].practice_minutes ?? 0) : 0
    res.status(200).json({ engagedMinutes: minutes })
  } catch (error: any) {
    console.error('[me/engaged-time] Error:', error)
    res.status(200).json({ engagedMinutes: null })
  }
}
