/**
 * Current-user engaged-time API - GET /api/me/engaged-time
 *
 * Auth required. Returns the authenticated learner's total TIME IN APP —
 * the commitment metric the learner sees in the Library ("Total Time").
 *
 * SOURCE (owner ruling, 2026-08-19): time counts as in-app time when the app
 * is PLAYING — including listening — and does not count when it is not. That
 * measure already exists and already accrues:
 * `learner_speaking_opportunities.play_seconds`, banked per learner / course /
 * day from segments between playback start and stop, flushed on
 * visibilitychange and beforeunload so a closed tab doesn't lose the tail.
 *
 * It used to read `admin_practice_minutes`, i.e. SUM(sessions.duration_seconds),
 * which was wall-clock: `ended_at - started_at` on rows whose timer was never
 * closed. For the owner's own account that read 437h, of which 350h came from
 * 18 sessions — one claiming a single 128-hour sitting, with items_practiced =
 * 0. The playback ledger reads 43h for the same account, with no single day
 * over 6.1h. A read-time cap on the old number was explicitly REJECTED: the
 * measurement itself had to become accurate, not be clamped after the fact.
 *
 * The forward fix is in SessionStore.endSession (it now writes play seconds
 * too), but sessions.duration_seconds carries historical wall-clock rows that
 * cannot be repaired — the play time for them was never recorded. So the tile
 * reads the ledger, which was always playback-based.
 *
 * KNOWN GAP: the ledger begins 2026-05-14; sessions predate it (the owner's go
 * back to 2026-03-18). Playback before that date is not counted and is not
 * recoverable. An honest 43h beats a wrong 437h, but the number is a floor for
 * the earliest accounts, not a complete history.
 *
 * NOT changed here: admin/schools surfaces still read admin_practice_minutes,
 * so they still show the wall-clock number. Reconciling them is a separate
 * pass — see the report for 2026-08-19.
 *
 * Scoped to the caller's own learner id — it can only ever return the caller's
 * own number.
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

    // Paginated: a long-running learner accrues one row per course per day,
    // which passes the default PostgREST page cap inside a year — a single
    // unpaginated read would silently truncate the total downwards.
    let playSeconds = 0
    const PAGE = 1000
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from('learner_speaking_opportunities')
        .select('play_seconds')
        .eq('learner_id', learner.id)
        .range(from, from + PAGE - 1)
      if (error) {
        console.error('[me/engaged-time] ledger error:', error)
        // Fail soft — the client falls back to its local estimate.
        res.status(200).json({ engagedMinutes: null })
        return
      }
      if (!data || data.length === 0) break
      for (const row of data) playSeconds += (row as any).play_seconds || 0
      if (data.length < PAGE) break
    }

    res.status(200).json({
      engagedMinutes: Math.floor(playSeconds / 60),
      // Never an estimate — this is measured playback, not derived from
      // course position. The flag stays in the response so the client's "~"
      // rendering keeps working without a change.
      isEstimated: false,
    })
  } catch (error: any) {
    console.error('[me/engaged-time] Error:', error)
    res.status(200).json({ engagedMinutes: null })
  }
}
