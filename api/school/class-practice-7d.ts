/**
 * Per-class 7-day practice — GET /api/school/class-practice-7d?class_ids=a,b,c
 *
 * The player_events-sourced source of the TeacherDashboard "Time in app" column
 * (historically "Hours/wk", which summed the legacy sessions-derived
 * class_activity_stats.total_practice_seconds, unwindowed; then audio-played
 * seconds off the ledger until 2026-09-10).
 *
 * THE HEADLINE IS IN-APP SESSION TIME (founder ruling, Tom 2026-09-10: "in-app
 * time is in-class time, they want to know that precisely"; rule and defaults
 * in api/_utils/inAppTime.ts). Per class it is the sum, each learner id once, of
 *   - the CLASS's own account (`classes.class_learner_id`) — whole-class play
 *     from the front, which is most of what a school does; and
 *   - each STUDENT's own account on that class.
 * Audio-played seconds (learner_speaking_opportunities.play_seconds, students
 * only — the class account cannot write that ledger) stay in the payload as the
 * secondary figure, demoted not deleted.
 *
 * Auth required. The caller's visible scope is resolved server-side
 * (resolveVisibleScope) — requested class_ids are intersected with what the
 * caller may actually see, so a teacher/school/gov admin only ever gets practice
 * for classes inside their own branch of the hierarchy. If no class_ids are
 * given, every class in the caller's scope is returned.
 *
 * Returns: {
 *   practiceByClass:   { [classId]: in-app seconds, last 7 days } — the headline
 *   classPlayByClass:  { [classId]: of which, the class account's own play }
 *   audioPlayedByClass:{ [classId]: students' audio-played seconds off the ledger }
 *   activeDaysByClass: { [classId]: distinct UTC days in the window with any play,
 *                        the class account and its students together } — what
 *                        the class list's health mark is worked out from
 *   metric: 'in_app_session_time', idleCutoffSeconds, days: 7
 * }
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { verifyAuthToken } from '../_utils/auth'
import { resolveVisibleScope, chunk } from '../_utils/schoolScope'
import { filterActiveScope } from '../_utils/schoolCoverageGate'
import { applyCors } from '../_utils/cors'
import { inAppTimeByLearner, IDLE_CUTOFF_SECONDS } from '../_utils/inAppTime'

const DAYS = 7

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  // Cross-origin policy and preflight both live in `api/_utils/cors.ts`.
  // Without this the native WebView's preflight for the `Authorization`
  // header goes unanswered and the call fails there while working on the web.
  if (applyCors(req, res, { methods: 'GET' })) return

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
    const requestedClassIds = requested.length ? requested.filter(id => inScope.has(id)) : scope.classIds

    // Coverage gate: a school whose platform trial/subscription has lapsed
    // goes dark for its own teacher/school_admin view (client-side, this is
    // SchoolsContainer's platformActive gate) — enforce the same rule here
    // for direct API callers. Group rollups are exempt (see schoolCoverageGate.ts).
    const { classIds: coveredClassIds, blocked } = await filterActiveScope(svc, { ...scope, classIds: requestedClassIds })
    if (blocked) {
      res.status(403).json({ error: 'coverage_expired', message: 'This school’s platform coverage has expired.' })
      return
    }
    const classIds = coveredClassIds

    if (classIds.length === 0) {
      res.setHeader('Cache-Control', 'no-store')
      res.status(200).json({ practiceByClass: {}, classPlayByClass: {}, audioPlayedByClass: {}, activeDaysByClass: {}, metric: 'in_app_session_time', idleCutoffSeconds: IDLE_CUTOFF_SECONDS, days: DAYS })
      return
    }

    // The class's OWN learner account (THE-MODEL I6) — whole-class play hangs
    // off it. Not in the scope's studentsByClass, by design: it carries no
    // user_tags row so it never inflates a learner count.
    const classLearnerByClass = new Map<string, string>()
    for (const batch of chunk(classIds)) {
      const { data } = await svc.from('classes').select('id, class_learner_id').in('id', batch)
      for (const r of data ?? []) if ((r as any).class_learner_id) classLearnerByClass.set(String((r as any).id), String((r as any).class_learner_id))
    }

    const studentIds = [...new Set(classIds.flatMap(c => scope.studentsByClass[c] || []))]

    // Last 7 UTC days — the same window for the diary and the ledger.
    const since = new Date()
    since.setUTCDate(since.getUTCDate() - (DAYS - 1))
    since.setUTCHours(0, 0, 0, 0)
    const sinceDay = since.toISOString().split('T')[0]

    const [inAppByLearner, secondsByLearner] = await Promise.all([
      inAppTimeByLearner(svc, [...studentIds, ...classLearnerByClass.values()], since.toISOString()),
      audioPlayedByLearner(svc, studentIds, sinceDay),
    ])
    if (!secondsByLearner) {
      res.status(500).json({ error: 'Failed to load practice data' })
      return
    }

    const practiceByClass: Record<string, number> = {}
    const classPlayByClass: Record<string, number> = {}
    const audioPlayedByClass: Record<string, number> = {}
    // Distinct days with any play, class account and students together — the
    // health mark's input ("how many of the last seven days the class
    // practised on"). A class with no pupil accounts earns its days from the
    // front of the room like any other.
    const activeDaysByClass: Record<string, number> = {}
    for (const c of classIds) {
      const students = scope.studentsByClass[c] || []
      const classLearner = classLearnerByClass.get(c)
      const classPlay = classLearner ? (inAppByLearner.get(classLearner)?.seconds || 0) : 0
      classPlayByClass[c] = classPlay
      practiceByClass[c] = classPlay + students.reduce((sum, lid) => sum + (inAppByLearner.get(lid)?.seconds || 0), 0)
      audioPlayedByClass[c] = students.reduce((sum, lid) => sum + (secondsByLearner.get(lid) || 0), 0)
      const days = new Set<string>()
      for (const lid of [classLearner, ...students]) if (lid) for (const d of inAppByLearner.get(lid)?.days ?? []) days.add(d)
      activeDaysByClass[c] = days.size
    }

    res.setHeader('Cache-Control', 'no-store')
    res.status(200).json({ practiceByClass, classPlayByClass, audioPlayedByClass, activeDaysByClass, metric: 'in_app_session_time', idleCutoffSeconds: IDLE_CUTOFF_SECONDS, days: DAYS })
  } catch (err) {
    console.error('[class-practice-7d] error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
}

/** The SECONDARY figure: audio-played seconds off the ledger, per learner. Null on a query error. */
async function audioPlayedByLearner(svc: SupabaseClient, learnerIds: string[], sinceDay: string): Promise<Map<string, number> | null> {
  const secondsByLearner = new Map<string, number>()
  for (const batch of chunk(learnerIds)) {
    const { data, error } = await svc
      .from('learner_speaking_opportunities')
      .select('learner_id, play_seconds')
      .in('learner_id', batch)
      .gte('day', sinceDay)
    if (error) {
      console.error('[class-practice-7d] LSO query failed:', error.message)
      return null
    }
    for (const r of data ?? []) {
      const lid = (r as any).learner_id as string
      secondsByLearner.set(lid, (secondsByLearner.get(lid) || 0) + ((r as any).play_seconds || 0))
    }
  }
  return secondsByLearner
}
