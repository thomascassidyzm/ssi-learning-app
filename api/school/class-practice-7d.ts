/**
 * Per-class 7-day practice — GET /api/school/class-practice-7d?class_ids=a,b,c
 *
 * The real, player_events-sourced replacement for the TeacherDashboard "Hours/wk"
 * column (which historically summed the legacy sessions-derived
 * class_activity_stats.total_practice_seconds, unwindowed).
 *
 * Auth required. The caller's visible scope is resolved server-side
 * (resolveVisibleScope) — requested class_ids are intersected with what the
 * caller may actually see, so a teacher/school/gov admin only ever gets practice
 * for classes inside their own branch of the hierarchy. If no class_ids are
 * given, every class in the caller's scope is returned.
 *
 * Returns: { practiceByClass: { [classId]: seconds_last_7_days }, days: 7 }
 * where seconds is the sum of learner_speaking_opportunities.play_seconds across
 * that class's students over the last 7 UTC days (across all courses).
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

  const svc = createClient(supabaseUrl, supabaseServiceKey)

  try {
    const scope = await resolveVisibleScope(svc, auth.userId)

    // Intersect any requested class_ids with the caller's actual scope; default
    // to the whole scope. This is the access gate — out-of-scope ids are dropped.
    const requested = String(req.query.class_ids || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
    const inScope = new Set(scope.classIds)
    const classIds = requested.length ? requested.filter(id => inScope.has(id)) : scope.classIds

    if (classIds.length === 0) {
      res.setHeader('Cache-Control', 'no-store')
      res.status(200).json({ practiceByClass: {}, days: 7 })
      return
    }

    const learnerIds = [...new Set(classIds.flatMap(c => scope.studentsByClass[c] || []))]
    if (learnerIds.length === 0) {
      res.setHeader('Cache-Control', 'no-store')
      res.status(200).json({ practiceByClass: Object.fromEntries(classIds.map(c => [c, 0])), days: 7 })
      return
    }

    // Last 7 UTC days.
    const since = new Date()
    since.setUTCDate(since.getUTCDate() - 6)
    const sinceDay = since.toISOString().split('T')[0]

    const secondsByLearner = new Map<string, number>()
    for (const batch of chunk(learnerIds)) {
      const { data, error } = await svc
        .from('learner_speaking_opportunities')
        .select('learner_id, play_seconds')
        .in('learner_id', batch)
        .gte('day', sinceDay)
      if (error) {
        console.error('[class-practice-7d] LSO query failed:', error.message)
        res.status(500).json({ error: 'Failed to load practice data' })
        return
      }
      for (const r of data ?? []) {
        const lid = (r as any).learner_id as string
        secondsByLearner.set(lid, (secondsByLearner.get(lid) || 0) + ((r as any).play_seconds || 0))
      }
    }

    const practiceByClass: Record<string, number> = {}
    for (const c of classIds) {
      const students = scope.studentsByClass[c] || []
      practiceByClass[c] = students.reduce((sum, lid) => sum + (secondsByLearner.get(lid) || 0), 0)
    }

    res.setHeader('Cache-Control', 'no-store')
    res.status(200).json({ practiceByClass, days: 7 })
  } catch (err) {
    console.error('[class-practice-7d] error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
}
