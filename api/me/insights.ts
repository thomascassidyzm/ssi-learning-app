/**
 * GET /api/me/insights — the learner's OWN insights, in the Library.
 *
 * Tom, 2026-09-14 (02:45Z): "the library insights tool can be built, all the
 * pieces are there already" — a learner sees how they are doing at a granular
 * level against the COURSE AVERAGE, and "never against other individuals of
 * course".
 *
 * So this route speaks the rate-compare contract the NodeRateEngine +
 * RateCompare widget already draw (the same shape /api/intel/minutes speaks),
 * with the ENTITY being the caller's own learner and the COMPARATOR being the
 * course average — the learner-weighted figure of job #621: every minute
 * done on the course divided by every person on the course, the caller
 * included when they count — or, optionally, the average of all courses,
 * pooled the same way. No second minutes query: the population, the packed
 * diary read, the sessionisation and the per-course facts are the ones
 * api/intel/minutes.ts uses, imported from there.
 *
 *   ?course_code=<code>              optional — defaults to the course the
 *                                     caller played most in the window, else
 *                                     their most recent enrolment
 *   &compare_to=course|global_all_courses   default: course
 *   &window=today|7d|30d             the engine's WINDOWS table; no "all
 *                                     time" — see the note on that below
 *   &measure=minutes_total|minutes_per_session|listening_minutes
 *
 * THE MINUTE is the one definition in api/_utils/inAppTime.ts (play to stop,
 * tagged main flow / Listening Mode). A SESSION is that same unit: one span
 * from pressing play to stopping — the thing `spansFromDiary` produces and
 * `sessioniseDiary` is named for. Nothing new is defined here.
 *
 * WHO IS NEVER NAMED. The response carries the caller's own value, an
 * average, and — only when the course has PERCENTILE_FLOOR or more people
 * active in the window — an anonymised distribution and a percentile. Below
 * the floor the distribution is EMPTY and `percentileNote` says "not enough
 * people yet", so a small course can never be read back to a person. No
 * other learner's id, name or individual value is ever in the body.
 *
 * WHOSE ROWS. The caller's own diary is read in every env (their staging play
 * is still their play); the population's is read on production only, exactly
 * as Intelligence reads it — the average is about real learners, and real
 * learners are on production.
 *
 * NO "ALL TIME" WINDOW, honestly: the packed read carries a 30-day production
 * window in ~2 s, and a 90-day one hits the 8 s statement timeout (measured
 * 2026-09-14). A whole-diary comparator cannot be served today; the window
 * list says today / 7 days / 30 days and nothing pretends otherwise.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { verifyAuthToken } from '../_utils/auth'
import { applyCors } from '../_utils/cors'
import { resolveRealLearners } from '../_utils/realLearnerPopulation'
import { readDiaryPlayRowsPacked, sessioniseAll, type DiarySessionisation } from '../_utils/inAppTime'
import { distributionStats, deltaPct, K_FLOOR } from '../_utils/rateCompare'
import { WINDOWS, courseFactsFromSpans, pooledFacts, type CourseFacts } from '../intel/minutes'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

const MS_PER_DAY = 86_400_000
const PAGE = 1000
const ENROLMENT_MAX_PAGES = 50
const POPULATION_ENV = 'production'
const DEFAULT_WINDOW = '7d'
const WINDOW_ALIASES: Record<string, string> = { week: '7d', '4w': '30d', term: '30d', all: '30d' }

/**
 * A percentile is shown only against this many ACTIVE people in the window
 * (Tom's brief, 2026-09-14: "if a course has fewer than ~20 active learners
 * in the window, suppress the percentile and say 'not enough people yet'").
 * Distinct from K_FLOOR (5), which gates whether an AVERAGE can be shown at all.
 */
export const PERCENTILE_FLOOR = 20

export type InsightMeasureId = 'minutes_total' | 'minutes_per_session' | 'listening_minutes'
export type CompareId = 'course' | 'global_all_courses'
const COMPARE_COURSE: CompareId = 'course'
const COMPARE_ALL: CompareId = 'global_all_courses'

interface MeasureConfig { value: InsightMeasureId; label: string; unit: string; desc: string }
export const MEASURES: MeasureConfig[] = [
  { value: 'minutes_total', label: 'In-app minutes', unit: 'min', desc: 'Your minutes in the app in this period, from pressing play to stopping — main flow and Listening Mode together. The course average is every minute done on the course divided by every person on it, so it is the typical person, not the busiest.' },
  { value: 'minutes_per_session', label: 'Minutes per session', unit: 'min', desc: 'How long you tend to keep going once you press play. A session runs from pressing play to stopping. The course average is every minute on the course divided by every session on it.' },
  { value: 'listening_minutes', label: 'Listening Mode minutes', unit: 'min', desc: 'Your minutes in Listening Mode in this period. The course average is every Listening Mode minute on the course divided by every person on it.' },
]
const DEFAULT_MEASURE: InsightMeasureId = 'minutes_total'

interface Enrolment { learner_id: string; course_id: string; enrolled_at: string | null }

async function loadEnrolments(svc: SupabaseClient): Promise<Enrolment[]> {
  const out: Enrolment[] = []
  for (let page = 0; page < ENROLMENT_MAX_PAGES; page++) {
    const { data, error } = await svc
      .from('course_enrollments')
      .select('learner_id, course_id, enrolled_at')
      .order('enrolled_at', { ascending: true })
      .order('id', { ascending: true })
      .range(page * PAGE, page * PAGE + PAGE - 1)
    if (error) throw new Error(`course_enrollments: ${error.message}`)
    const rows = data ?? []
    for (const r of rows) out.push({ learner_id: String((r as any).learner_id), course_id: String((r as any).course_id), enrolled_at: ((r as any).enrolled_at as string | null) ?? null })
    if (rows.length < PAGE) break
  }
  return out
}

async function loadCourseNames(svc: SupabaseClient): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const { data } = await svc.from('courses').select('course_code, display_name, learner_display_name')
  for (const r of data ?? []) {
    const code = String((r as any).course_code)
    out.set(code, String((r as any).learner_display_name || (r as any).display_name || code))
  }
  return out
}

const round1 = (n: number) => Math.round(n * 10) / 10
const safeDiv = (a: number, b: number) => (b > 0 ? a / b : 0)

/**
 * Pure: one measure's value + trend over a set of facts, LEARNER-WEIGHTED —
 * the same facts object serves the caller (people = {me}, so ÷1), a course
 * (÷ every person on it) and the pool of every course. Exported for the test.
 */
export function insightMeasureFor(measure: InsightMeasureId, f: CourseFacts): { value: number; trend: number[] } {
  const people = f.people.size
  switch (measure) {
    case 'minutes_total':
      return { value: round1(safeDiv(f.seconds / 60, people)), trend: f.bucketSeconds.map((s) => round1(safeDiv(s / 60, people))) }
    case 'listening_minutes':
      return { value: round1(safeDiv(f.listeningSeconds / 60, people)), trend: f.bucketListeningSeconds.map((s) => round1(safeDiv(s / 60, people))) }
    case 'minutes_per_session':
      return { value: round1(safeDiv(f.seconds / 60, f.spans)), trend: f.bucketSeconds.map((s, i) => round1(safeDiv(s / 60, f.bucketSpans[i] ?? 0))) }
  }
}

/** Per-person values across a population, for the anonymised distribution. */
export function personValues(
  measure: InsightMeasureId,
  sessions: Map<string, DiarySessionisation>,
  people: ReadonlySet<string>,
  course: string | null,
  since: number,
  now: number,
): Map<string, number> {
  const out = new Map<string, number>()
  const acc = new Map<string, { seconds: number; listening: number; spans: number }>()
  for (const lid of people) acc.set(lid, { seconds: 0, listening: 0, spans: 0 })
  for (const [lid, s] of sessions) {
    const a = acc.get(lid)
    if (!a) continue
    for (const span of s.spans) {
      if (!span.course || (course && span.course !== course)) continue
      const from = Math.max(span.startMs, since)
      const to = Math.min(span.endMs, now)
      const secs = to > from ? (to - from) / 1000 : 0
      if (secs <= 0) continue
      a.seconds += secs
      a.spans += 1
      if (span.mode === 'listening') a.listening += secs
    }
  }
  for (const [lid, a] of acc) {
    if (measure === 'minutes_per_session') {
      if (a.spans > 0) out.set(lid, round1(a.seconds / 60 / a.spans))
    } else if (measure === 'listening_minutes') {
      out.set(lid, round1(a.listening / 60))
    } else {
      out.set(lid, round1(a.seconds / 60))
    }
  }
  return out
}

export interface Placement {
  percentile: number
  /** Set — and the distribution emptied — when the population is under PERCENTILE_FLOOR. */
  percentileNote: string | null
  distribution: { values: number[]; min: number; q1: number; median: number; q3: number; max: number }
}

/**
 * Pure: where the caller sits among an anonymous population, or an honest
 * "not enough people yet" with NO shape at all when the floor is not met.
 * `values` never includes the caller's own value. Exported for the test.
 */
export function placeAmong(entityValue: number, values: number[], activeCount: number): Placement {
  if (activeCount < PERCENTILE_FLOOR) {
    return {
      percentile: 0,
      percentileNote: `Not enough people yet — a percentile appears once ${PERCENTILE_FLOOR} or more people have been active in this period.`,
      distribution: { values: [], min: 0, q1: 0, median: 0, q3: 0, max: 0 },
    }
  }
  const dist = distributionStats(values)
  return {
    percentile: dist.percentileOf(entityValue),
    percentileNote: null,
    distribution: { values: dist.values, min: dist.min, q1: dist.q1, median: dist.median, q3: dist.q3, max: dist.max },
  }
}

/**
 * People in a facts object other than the caller. Pooled facts key people as
 * `<course>\u0000<learner>` (one person on two courses is two course-persons),
 * so the caller may appear once per course they are on.
 */
export function othersBesides(f: CourseFacts, me: string): number {
  let n = 0
  for (const id of f.people) if (id !== me && !id.endsWith(`\u0000${me}`)) n++
  return n
}

function fmtMin(seconds: number): string {
  return round1(seconds / 60).toLocaleString('en-GB')
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (applyCors(req, res, { methods: 'GET' })) return
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return }
  if (!supabaseUrl || !supabaseServiceKey) { res.status(500).json({ error: 'Server misconfigured' }); return }

  const auth = await verifyAuthToken(req)
  if (!auth.valid || !auth.userId) { res.status(401).json({ error: auth.error || 'Unauthorized' }); return }

  const requestedCourse = String(req.query.course_code || '').trim() || null
  const requestedWindowRaw = String(req.query.window || '').trim()
  const requestedWindow = WINDOW_ALIASES[requestedWindowRaw] ?? requestedWindowRaw
  const windowConfig = WINDOWS.find((w) => w.value === requestedWindow) ?? WINDOWS.find((w) => w.value === DEFAULT_WINDOW)!
  const requestedMeasure = String(req.query.measure || '').trim()
  const measureConfig = MEASURES.find((m) => m.value === requestedMeasure) ?? MEASURES.find((m) => m.value === DEFAULT_MEASURE)!
  const compareTo: CompareId = String(req.query.compare_to || '').trim() === COMPARE_ALL ? COMPARE_ALL : COMPARE_COURSE

  const svc = createClient(supabaseUrl, supabaseServiceKey)
  const now = Date.now()
  const since = now - windowConfig.days * MS_PER_DAY
  const sinceIso = new Date(since).toISOString()
  const nowIso = new Date(now).toISOString()

  try {
    const { data: learner } = await svc.from('learners').select('id').eq('user_id', auth.userId).maybeSingle()
    const me = learner ? String((learner as any).id) : null
    if (!me) { res.status(200).json(noCourseBody(windowConfig, measureConfig, compareTo, nowIso, 'Press play on a course and your insights will start here.')); return }

    const [population, populationRows, ownRows, enrolments, names] = await Promise.all([
      resolveRealLearners(svc),
      readDiaryPlayRowsPacked(svc, sinceIso, nowIso, POPULATION_ENV),
      readDiaryPlayRowsPacked(svc, sinceIso, nowIso, null, [me]),
      loadEnrolments(svc),
      loadCourseNames(svc),
    ])
    const { realIds } = population

    // The population — only real learners reach the rule, as Intelligence does.
    const realRows = new Map([...populationRows].filter(([lid]) => realIds.has(lid)))
    const [sessions, ownSessions] = await Promise.all([sessioniseAll(svc, realRows), sessioniseAll(svc, ownRows)])
    const facts = courseFactsFromSpans(sessions, enrolments, realIds, since, now, windowConfig.periods, windowConfig.periodDays)
    // The caller alone, on the same facts shape (people = {me}, so every
    // learner-weighted measure divides by one).
    const ownFacts = courseFactsFromSpans(ownSessions, [], new Set([me]), since, now, windowConfig.periods, windowConfig.periodDays)

    // The caller's courses: enrolled, or played in the window. Busiest first.
    const myCourses = new Set<string>()
    for (const e of enrolments) if (e.learner_id === me) myCourses.add(e.course_id)
    for (const code of ownFacts.keys()) myCourses.add(code)
    const latestEnrolment = new Map<string, number>()
    for (const e of enrolments) if (e.learner_id === me && e.enrolled_at) latestEnrolment.set(e.course_id, new Date(e.enrolled_at).getTime())
    const ranked = [...myCourses].sort((a, b) =>
      (ownFacts.get(b)?.seconds ?? 0) - (ownFacts.get(a)?.seconds ?? 0)
      || (latestEnrolment.get(b) ?? 0) - (latestEnrolment.get(a) ?? 0)
      || a.localeCompare(b))
    const nameOf = (code: string) => names.get(code) ?? code
    const courseCode = requestedCourse && myCourses.has(requestedCourse) ? requestedCourse : (ranked[0] ?? null)

    const baseBody = {
      ...noCourseBody(windowConfig, measureConfig, compareTo, nowIso, ''),
      node: { id: 'me', name: 'You', label: 'learner', kind: 'node' as const },
      options: {
        courses: ranked.map((code) => ({ code, classCount: 0, hasData: (ownFacts.get(code)?.seconds ?? 0) > 0 })),
        compares: [
          { value: COMPARE_COURSE, label: 'Course average', word: 'course' },
          { value: COMPARE_ALL, label: 'Average of all courses', word: 'global' },
        ],
        windows: WINDOWS.map((w) => ({ value: w.value, label: w.label })),
        measures: MEASURES.map((m) => ({ value: m.value, label: m.label, desc: m.desc })),
      },
      applied: { course_code: courseCode, compare_to: compareTo, days: windowConfig.days, window: windowConfig.value, measure: measureConfig.value },
    }

    res.setHeader('Cache-Control', 'no-store')
    if (!courseCode) {
      res.status(200).json({ ...baseBody, insufficientData: true, cohortSize: 0, reason: 'Press play on a course and your insights will start here.' })
      return
    }

    const own = ownFacts.get(courseCode) ?? null
    const entity = own ? insightMeasureFor(measureConfig.value, own) : { value: 0, trend: new Array(windowConfig.periods).fill(0) }

    // The comparator: this course, or every course pooled — learner-weighted either way.
    const courseFacts = facts.get(courseCode)
    const allCourses = [...facts.values()].filter((f) => f.people.size > 0)
    const comparatorFacts: CourseFacts | null = compareTo === COMPARE_ALL ? pooledFacts(allCourses) : (courseFacts ?? null)
    const othersOnCourse = comparatorFacts ? othersBesides(comparatorFacts, me) : 0
    if (!comparatorFacts || othersOnCourse < K_FLOOR) {
      const reason = compareTo === COMPARE_ALL
        ? 'Not enough people have been active yet to make an average.'
        : `Not enough other people on ${nameOf(courseCode)} yet to make an average — your own minutes are still counted, and the comparison appears as the course grows.`
      res.status(200).json({ ...baseBody, insufficientData: true, cohortSize: othersOnCourse, reason })
      return
    }
    const average = insightMeasureFor(measureConfig.value, comparatorFacts)
    const averageLabel = compareTo === COMPARE_ALL ? 'Average of all courses' : 'Course average'

    // Placement: an anonymous population, the caller's own value taken out,
    // and NO shape at all below the floor.
    let values: number[]
    let activeCount: number
    if (compareTo === COMPARE_ALL) {
      const all = new Map<string, number>()
      for (const f of allCourses) {
        for (const [lid, v] of personValues(measureConfig.value, sessions, f.people, f.code, since, now)) all.set(`${f.code}\u0000${lid}`, v)
      }
      for (const f of allCourses) all.delete(`${f.code}\u0000${me}`)
      values = [...all.values()]
      activeCount = comparatorFacts.activePeople.size
    } else {
      const perPerson = personValues(measureConfig.value, sessions, comparatorFacts.people, courseCode, since, now)
      perPerson.delete(me)
      values = [...perPerson.values()]
      activeCount = comparatorFacts.activePeople.size
    }
    const placement = placeAmong(entity.value, values, activeCount)

    const split = own
      ? { minutes: round1(own.seconds / 60), mainMinutes: round1(own.mainSeconds / 60), listeningMinutes: round1(own.listeningSeconds / 60), sessions: own.spans }
      : { minutes: 0, mainMinutes: 0, listeningMinutes: 0, sessions: 0 }
    const contextLine = own && own.seconds > 0
      ? `Main flow ${fmtMin(own.mainSeconds)} min · Listening Mode ${fmtMin(own.listeningSeconds)} min · ${own.spans} session${own.spans === 1 ? '' : 's'} on ${nameOf(courseCode)}`
      : `Nothing played on ${nameOf(courseCode)} in this period yet — the moment you press play, it counts.`
    const cohortLabel = compareTo === COMPARE_ALL ? 'people on every course' : `people on ${nameOf(courseCode)}`

    res.status(200).json({
      ...baseBody,
      insufficientData: false,
      metricLabel: measureConfig.label,
      unit: measureConfig.unit,
      per: '',
      entity: { label: 'You', value: entity.value, trend: entity.trend },
      average: { label: averageLabel, value: average.value, trend: average.trend },
      deltaPct: deltaPct(entity.value, average.value),
      percentile: placement.percentile,
      percentileNote: placement.percentileNote,
      contextLine,
      subject: 'You',
      subjectIsViewer: true,
      levelNoun: 'learner',
      cohortLabel,
      distribution: { ...placement.distribution, entityValue: entity.value, averageValue: average.value, percentile: placement.percentile },
      cohortSize: othersOnCourse,
      activePeople: activeCount,
      percentileFloor: PERCENTILE_FLOOR,
      counted: realIds.has(me),
      split,
    })
  } catch (error) {
    console.error('[me/insights] error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
}

function noCourseBody(
  windowConfig: (typeof WINDOWS)[number],
  measureConfig: MeasureConfig,
  compareTo: CompareId,
  nowIso: string,
  reason: string,
) {
  return {
    node: { id: 'me', name: 'You', label: 'learner', kind: 'node' as const },
    options: {
      courses: [] as { code: string; classCount: number; hasData: boolean }[],
      compares: [
        { value: COMPARE_COURSE, label: 'Course average', word: 'course' },
        { value: COMPARE_ALL, label: 'Average of all courses', word: 'global' },
      ],
      windows: WINDOWS.map((w) => ({ value: w.value, label: w.label })),
      measures: MEASURES.map((m) => ({ value: m.value, label: m.label, desc: m.desc })),
    },
    applied: { course_code: null as string | null, compare_to: compareTo, days: windowConfig.days, window: windowConfig.value, measure: measureConfig.value },
    windowLabel: windowConfig.label,
    trendLabel: windowConfig.trendLabel,
    trendPeriodDays: windowConfig.periodDays,
    kFloor: K_FLOOR,
    percentileFloor: PERCENTILE_FLOOR,
    populationEnv: POPULATION_ENV,
    countedAt: nowIso,
    insufficientData: true,
    cohortSize: 0,
    reason,
  }
}
