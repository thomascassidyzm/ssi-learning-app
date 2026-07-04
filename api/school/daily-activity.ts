/**
 * Per-day activity series — GET /api/school/daily-activity?days=30
 *
 * The player_events-sourced replacement for useAnalyticsData.fetchDailyActivity,
 * which read the legacy sessions table directly. Returns a per-day series over
 * the caller's visible students (learner_speaking_opportunities), scoped
 * server-side by resolveVisibleScope — so a teacher/school/gov admin only ever
 * sees activity for their own branch of the hierarchy.
 *
 * Auth required. Returns:
 *   { activity: [{ day, practice_minutes, active_students, cycles }], days }
 * ordered oldest → newest. `cycles` = speaking opportunities; there is no
 * per-session count in the daily rollup (LSO is per-day), so the legacy
 * "sessions" metric maps to cycles.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { verifyAuthToken } from '../_utils/auth'
import { resolveVisibleScope, chunk } from '../_utils/schoolScope'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const auth = await verifyAuthToken(req)
  if (!auth.valid || !auth.userId) {
    res.status(401).json({ error: auth.error || 'Unauthorized' })
    return
  }
  if (!supabaseUrl || !supabaseServiceKey) {
    res.status(500).json({ error: 'Server configuration error' })
    return
  }

  const days = Math.min(90, Math.max(1, parseInt(String(req.query.days || '30'), 10) || 30))
  const svc = createClient(supabaseUrl, supabaseServiceKey)

  try {
    const scope = await resolveVisibleScope(svc, auth.userId)
    if (scope.learnerIds.length === 0) {
      res.setHeader('Cache-Control', 'no-store')
      res.status(200).json({ activity: [], days })
      return
    }

    const since = new Date()
    since.setUTCDate(since.getUTCDate() - (days - 1))
    const sinceDay = since.toISOString().split('T')[0]

    const byDay = new Map<string, { seconds: number; cycles: number; students: Set<string> }>()
    for (const batch of chunk(scope.learnerIds)) {
      const { data, error } = await svc
        .from('learner_speaking_opportunities')
        .select('learner_id, day, play_seconds, opportunities')
        .in('learner_id', batch)
        .gte('day', sinceDay)
      if (error) {
        console.error('[daily-activity] LSO query failed:', error.message)
        res.status(500).json({ error: 'Failed to load activity data' })
        return
      }
      for (const r of data ?? []) {
        const day = (r as any).day as string
        const e = byDay.get(day) || { seconds: 0, cycles: 0, students: new Set<string>() }
        e.seconds += (r as any).play_seconds || 0
        e.cycles += (r as any).opportunities || 0
        e.students.add((r as any).learner_id)
        byDay.set(day, e)
      }
    }

    const activity = [...byDay.entries()]
      .map(([day, e]) => ({
        day,
        practice_minutes: Math.round(e.seconds / 60),
        active_students: e.students.size,
        cycles: e.cycles,
      }))
      .sort((a, b) => (a.day < b.day ? -1 : 1))

    res.setHeader('Cache-Control', 'no-store')
    res.status(200).json({ activity, days })
  } catch (err) {
    console.error('[daily-activity] error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
}
