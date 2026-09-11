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
 *   rollup: { windowDays, classCount, activeClasses7d, inAppMinutes7d } — THE
 *                        SCHOOL HEADLINE, computed by the same helpers and the
 *                        same rule as the internal admin's node home
 *                        (api/groups/[id]/home.ts classPractice), so the number
 *                        a school leader reads is the number Tom reads for that
 *                        school. inAppMinutes7d counts the classes' own accounts
 *                        AND staff/students' own accounts, each once.
 *   classAccountByClass: { [classId]: { started, journeyDone, journeyTotal, seedNumber,
 *                        lastPractisedAt, phrases7d, minutesByDay[7] } } — THE CLASS
 *                        ACCOUNT'S OWN PROGRESS, the row a class list shows (Tom's
 *                        ruling, 2026-09-11, job #265: a class IS one learner account;
 *                        per-pupil counts on a class are meaningless). journeyDone is
 *                        the play-as-class position as a LEGO ordinal, the same chain
 *                        the class node home uses (enrollment ceiling → last completed
 *                        → classes.last_lego_id); minutesByDay is the class account's
 *                        in-app minutes per UTC day, oldest first, today last; started
 *                        is false only when the account has never played at all — the
 *                        list then says "not started" in words, never a row of zeros.
 *   metric: 'in_app_session_time', idleCutoffSeconds, days: 7
 * }
 *
 * Admin passthrough (job #265): `?school_id=` lets an ssi_admin read ONE
 * school's figures — View-as runs every fetch under the admin's own session,
 * whose resolved scope is empty, which is how the school dashboard under
 * View-as showed zeros as if they were real. verifyAdmin gates it; a staff
 * caller's own scope is never widened by the parameter.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { verifyAuthToken, verifyAdmin } from '../_utils/auth'
import { resolveVisibleScope, scopeForSchoolRead, chunk } from '../_utils/schoolScope'
import { loadClassPractice, practisedSince, ownAccountLearnerIds, inAppTimeSeconds, legoOrdinal, CLASS_PRACTICE_WINDOW_DAYS } from '../_utils/classPractice'
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
    let scope = await resolveVisibleScope(svc, auth.userId)
    const requestedSchoolId = typeof req.query.school_id === 'string' ? req.query.school_id.trim() : ''
    if (requestedSchoolId && scope.classIds.length === 0 && scope.schoolIds.length === 0) {
      const adminResult = await verifyAdmin(req)
      if ('error' in adminResult) {
        res.status(403).json({ error: 'Not a platform admin' })
        return
      }
      scope = await scopeForSchoolRead(svc, requestedSchoolId)
    }

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
      res.status(200).json({ practiceByClass: {}, classPlayByClass: {}, audioPlayedByClass: {}, activeDaysByClass: {}, rollup: { windowDays: CLASS_PRACTICE_WINDOW_DAYS, classCount: 0, activeClasses7d: 0, inAppMinutes7d: 0 }, classAccountByClass: {}, metric: 'in_app_session_time', idleCutoffSeconds: IDLE_CUTOFF_SECONDS, days: DAYS })
      return
    }

    // The class's OWN learner account (THE-MODEL I6) — whole-class play hangs
    // off it. Not in the scope's studentsByClass, by design: it carries no
    // user_tags row so it never inflates a learner count.
    const classLearnerByClass = new Map<string, string>()
    const classRowById = new Map<string, { course_code: string; last_lego_id: string | null }>()
    for (const batch of chunk(classIds)) {
      const { data } = await svc.from('classes').select('id, class_learner_id, course_code, last_lego_id').in('id', batch)
      for (const r of data ?? []) {
        classRowById.set(String((r as any).id), { course_code: String((r as any).course_code || ''), last_lego_id: (r as any).last_lego_id ?? null })
        if ((r as any).class_learner_id) classLearnerByClass.set(String((r as any).id), String((r as any).class_learner_id))
      }
    }

    const studentIds = [...new Set(classIds.flatMap(c => scope.studentsByClass[c] || []))]

    // Last 7 UTC days — the same window for the diary and the ledger.
    const since = new Date()
    since.setUTCDate(since.getUTCDate() - (DAYS - 1))
    since.setUTCHours(0, 0, 0, 0)
    const sinceDay = since.toISOString().split('T')[0]

    // The school headline — identical helpers and rule to the admin's node
    // home (api/groups/[id]/home.ts), so both surfaces read the same number.
    const rollupPromise = (async () => {
      const classRows = classIds.map((id) => ({ id, class_learner_id: classLearnerByClass.get(id) ?? null }))
      const nodeGroupIds: string[] = []
      for (const batch of chunk(scope.schoolIds)) {
        const { data } = await svc.from('schools').select('node_group_id').in('id', batch)
        for (const r of data ?? []) if ((r as any).node_group_id) nodeGroupIds.push(String((r as any).node_group_id))
      }
      const [facts, ownIds] = await Promise.all([
        loadClassPractice(svc, classRows),
        ownAccountLearnerIds(svc, { schoolIds: scope.schoolIds, groupIds: [...new Set([...(scope.groupId ? [scope.groupId] : []), ...nodeGroupIds])], classIds }),
      ])
      const weekAgo = Date.now() - CLASS_PRACTICE_WINDOW_DAYS * 86400000
      let activeClasses7d = 0
      for (const f of facts.values()) if (practisedSince(f, weekAgo)) activeClasses7d += 1
      const inApp = await inAppTimeSeconds(svc, [...classLearnerByClass.values()], ownIds)
      return { facts, rollup: { windowDays: CLASS_PRACTICE_WINDOW_DAYS, classCount: classIds.length, activeClasses7d, inAppMinutes7d: Math.round(inApp.seconds / 60) } }
    })()

    // THE CLASS ACCOUNT'S OWN PROGRESS per class (Tom's ruling, 2026-09-11):
    // journey position, whether it has ever played, and its cursor stamp.
    const classAccountPromise = (async () => {
      const learnerIds = [...classLearnerByClass.values()]
      const enrollmentByLearnerCourse = new Map<string, { highest: string | null; last: string | null; lastPractisedAt: string | null }>()
      const everPlayed = new Map<string, boolean>()
      await Promise.all([
        ...chunk(learnerIds).map(async (batch) => {
          const { data } = await svc.from('course_enrollments').select('learner_id, course_id, highest_completed_lego_id, last_completed_lego_id, last_practiced_at').in('learner_id', batch)
          for (const r of data ?? []) enrollmentByLearnerCourse.set(`${(r as any).learner_id}|${(r as any).course_id}`, { highest: (r as any).highest_completed_lego_id ?? null, last: (r as any).last_completed_lego_id ?? null, lastPractisedAt: (r as any).last_practiced_at ?? null })
        }),
        ...learnerIds.map(async (lid) => {
          const { count } = await svc.from('player_events').select('id', { count: 'exact', head: true }).eq('learner_id', lid)
          everPlayed.set(lid, (count ?? 0) > 0)
        }),
      ])
      const legoTotalByCourse = new Map<string, number>()
      const courses = [...new Set([...classRowById.values()].map((c) => c.course_code).filter(Boolean))]
      await Promise.all(courses.map(async (course) => {
        const { count } = await svc.from('course_legos').select('id', { count: 'exact', head: true }).eq('course_code', course)
        legoTotalByCourse.set(course, count ?? 0)
      }))
      const ordinalCache = new Map<string, Promise<number>>()
      const ordinalFor = (course: string, legoId: string | null): Promise<number> => {
        if (!legoId) return Promise.resolve(0)
        const key = `${course}|${legoId}`
        if (!ordinalCache.has(key)) ordinalCache.set(key, legoOrdinal(svc, course, legoId))
        return ordinalCache.get(key)!
      }
      const out: Record<string, { started: boolean; journeyDone: number; journeyTotal: number; seedNumber: number | null; lastPractisedAt: string | null; journeyLegoId: string | null }> = {}
      await Promise.all(classIds.map(async (classId) => {
        const row = classRowById.get(classId)
        const lid = classLearnerByClass.get(classId)
        const enr = row && lid ? enrollmentByLearnerCourse.get(`${lid}|${row.course_code}`) : undefined
        const journeyLegoId = enr?.highest || enr?.last || row?.last_lego_id || null
        const ord = row ? await ordinalFor(row.course_code, journeyLegoId) : 0
        const total = row ? (legoTotalByCourse.get(row.course_code) ?? 0) : 0
        const seedMatch = journeyLegoId?.match(/S(\d+)L/)
        out[classId] = {
          started: !!(enr?.lastPractisedAt) || ord > 0 || !!(lid && everPlayed.get(lid)),
          journeyDone: ord > 0 ? Math.min(total || ord, ord) : 0,
          journeyTotal: total,
          seedNumber: ord > 0 && seedMatch ? parseInt(seedMatch[1], 10) : null,
          lastPractisedAt: enr?.lastPractisedAt ?? null,
          journeyLegoId,
        }
      }))
      return out
    })()

    const [inAppByLearner, secondsByLearner, { facts, rollup }, classAccountBase] = await Promise.all([
      inAppTimeByLearner(svc, [...studentIds, ...classLearnerByClass.values()], since.toISOString()),
      audioPlayedByLearner(svc, studentIds, sinceDay),
      rollupPromise,
      classAccountPromise,
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
    // The seven UTC days of the window, oldest first, today last.
    const windowDays: string[] = []
    for (let i = 0; i < DAYS; i++) { const d = new Date(since); d.setUTCDate(d.getUTCDate() + i); windowDays.push(d.toISOString().split('T')[0]) }
    const classAccountByClass: Record<string, any> = {}
    for (const c of classIds) {
      const base = classAccountBase[c]
      const lid = classLearnerByClass.get(c)
      const own = lid ? inAppByLearner.get(lid) : undefined
      const f = facts.get(c)
      const minutesByDay = windowDays.map((day) => Math.round((own?.secondsByDay?.[day] || 0) / 60))
      const lastPractisedAt = [base?.lastPractisedAt, f?.lastPractisedAt].filter(Boolean).sort().pop() ?? null
      classAccountByClass[c] = {
        started: !!(base?.started || f?.lastPractisedAt || (own?.seconds ?? 0) > 0),
        journeyDone: base?.journeyDone ?? 0,
        journeyTotal: base?.journeyTotal ?? 0,
        seedNumber: base?.seedNumber ?? null,
        lastPractisedAt,
        phrases7d: f?.phrases ?? 0,
        minutesByDay,
      }
    }

    res.status(200).json({ practiceByClass, classPlayByClass, audioPlayedByClass, activeDaysByClass, rollup, classAccountByClass, metric: 'in_app_session_time', idleCutoffSeconds: IDLE_CUTOFF_SECONDS, days: DAYS })
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
