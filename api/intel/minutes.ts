/**
 * GET /api/intel/minutes — Intelligence at EVERYONE scope on the insight
 * engine: what is being DONE, in minutes, per course and per course-person.
 *
 * Tom, 2026-09-13 (22:27Z, via RBF, verbatim): "why is intelligence still
 * counting by people? the number of people is really irrelevant, it is what
 * is being DONE. how many in-app minutes, per course, per course-person,
 * across any other variables ... using the insights tool we have built for
 * learners? ... this course v average of all courses. Measures: new
 * enrolments, in-app minutes, people with no activity. Today, last 7 days,
 * last 30 days."
 *
 * So this route speaks the rate-compare contract (api/groups/:id/rate-compare)
 * — the same options / applied / entity / average / distribution shape the
 * NodeRateEngine + RateCompare widget already draw — with the ENTITY being
 * every real learner on one course and the COHORT being every course, the
 * selected one included (Tom, 2026-09-14: the comparator must not move when
 * the course changes; and it is the average of all LEARNERS, so ratio
 * measures are learner-weighted — see MEASURES.kind). No second set of
 * charts, no second data adapter.
 *
 *   ?course_code=<code>       optional — defaults to the busiest course by
 *                              minutes in the window
 *   &compare_to=global_all_courses   the only rung that means anything here:
 *                              at Everyone scope "everyone on this course" IS
 *                              the entity, so `global` is not offered
 *   &window=today|7d|30d|all  the existing WINDOWS table
 *   &measure=minutes_per_person|new_enrolments|no_activity
 *   &learner_id=<learners.id>[&env=production|staging|dev]
 *                              RECONCILE: also return that one learner's
 *                              spans in the window — open row, close row,
 *                              mode, minutes — so the headline can be checked
 *                              against a real diary (the failure this guards
 *                              against is "a minute figure nobody can
 *                              reproduce").
 *
 * THE MINUTE is the one definition in api/_utils/inAppTime.ts (play to stop,
 * tagged main flow / Listening Mode, closed at the last audio-ended point).
 * THE POPULATION is the one resolver in api/_utils/realLearnerPopulation.ts —
 * no demo, internal, staff, class accounts or machine events — exactly as the
 * pulse counts. Production diary rows only: the pitch number is about real
 * learners, and real learners are on production.
 *
 * COURSE-PERSON (taste-safe default, flagged in the job report): a real
 * learner with a course_enrollment on the course at the window's end, plus
 * anyone real who played the course inside the window without an enrolment
 * row. Minutes per person = the course's minutes in the window ÷ that count.
 * `no_activity` = the share of those people with no span in the window.
 * `new_enrolments` = course_enrollments created inside the window.
 * `minutes_total` = the course's minutes in the window, whoever did them —
 * so a course with a handful of very active learners cannot read as popular
 * on the per-person measure alone (Tom, 2026-09-14).
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { verifyAdmin } from '../_utils/auth'
import { applyCors } from '../_utils/cors'
import { resolveRealLearners } from '../_utils/realLearnerPopulation'
import {
  readDiaryPlayRowsPacked,
  sessioniseAll,
  LISTENING_EXACT_FROM,
  type PlaySpan,
  type DiarySessionisation,
} from '../_utils/inAppTime'
import { distributionStats, deltaPct, cohortFloor } from '../_utils/rateCompare'

// The cohort here is COURSES, not people: a course average is already an
// aggregate, so it takes the entity floor (Tom, 2026-09-15: the 5 was a GDPR
// floor for individual learners only). One other course is a comparison.
export const COURSE_COHORT_FLOOR = cohortFloor('entities')
export function courseCohortTooSmall(otherCourses: number): boolean {
  return otherCourses < COURSE_COHORT_FLOOR
}

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

const MS_PER_DAY = 86_400_000
const PAGE = 1000
const ENROLMENT_MAX_PAGES = 50
const DIARY_ENV = 'production'

// ─── Windows: the rate-compare table, verbatim (rolling, anchored to now). ───
interface WindowConfig { value: string; label: string; days: number; periods: number; periodDays: number; trendLabel: string }
export const WINDOWS: WindowConfig[] = [
  { value: 'today', label: 'Today', days: 1, periods: 24, periodDays: 1 / 24, trendLabel: 'Hourly · last 24 hours' },
  { value: '7d', label: 'Last 7 days', days: 7, periods: 7, periodDays: 1, trendLabel: 'Daily · last 7 days' },
  { value: '30d', label: 'Last 30 days', days: 30, periods: 30, periodDays: 1, trendLabel: 'Daily · last 30 days' },
  // No 'all' here: a whole-diary read is not one packed round trip, and Tom
  // named today / 7 days / 30 days. Add it when the read can carry it.
]
const DEFAULT_WINDOW = '7d'
const WINDOW_ALIASES: Record<string, string> = { week: '7d', '4w': '30d', term: '30d', all: '30d' }

export type MinutesMeasureId = 'minutes_per_person' | 'minutes_total' | 'new_enrolments' | 'no_activity'
/**
 * `kind` decides what "Average of all courses" means for the measure:
 *   ratio — the LEARNER-WEIGHTED figure: the numerator summed over every
 *           course divided by the denominator summed over every course, so a
 *           dead course with two enrolments weighs two people, not one whole
 *           course (Tom, 2026-09-14: "the averages of all LEARNERS");
 *   count — the plain mean per course, because a total has no denominator
 *           to weight by.
 * Either way the selected course is INCLUDED: one fixed number for a window
 * and a measure, whichever course is picked.
 */
interface MeasureConfig { value: MinutesMeasureId; label: string; unit: string; per: string; kind: 'ratio' | 'count'; desc: string }
export const MEASURES: MeasureConfig[] = [
  { value: 'minutes_per_person', label: 'In-app minutes per person', unit: 'min', per: '', kind: 'ratio', desc: 'Minutes in the app in the selected period, from pressing play to stopping, divided by the people on the course. Main flow and Listening Mode are shown beneath. The average of all courses is every minute done on every course, divided by every person on every course, this course included.' },
  { value: 'minutes_total', label: 'In-app minutes (total)', unit: 'min', per: '', kind: 'count', desc: 'All the minutes done on the course in the selected period, from pressing play to stopping, whoever did them. Main flow and Listening Mode are shown beneath. The average of all courses is the total across every course divided by the number of courses, this course included.' },
  { value: 'new_enrolments', label: 'New enrolments', unit: 'people', per: '', kind: 'count', desc: 'Real people who joined the course in the selected period. The average of all courses is the total across every course divided by the number of courses, this course included.' },
  { value: 'no_activity', label: 'People with no activity', unit: '%', per: '', kind: 'ratio', desc: 'The share of people on the course who did not press play at all in the selected period. The average of all courses is every silent person on every course, divided by every person on every course, this course included.' },
]
const DEFAULT_MEASURE: MinutesMeasureId = 'minutes_per_person'
const COMPARE_ALL_COURSES = 'global_all_courses'

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

/** Seconds of `span` inside [from, to). */
function overlapSeconds(span: PlaySpan, from: number, to: number): number {
  const a = Math.max(span.startMs, from)
  const b = Math.min(span.endMs, to)
  return b > a ? (b - a) / 1000 : 0
}

function periodBounds(periods: number, periodDays: number, now: number): number[] {
  const periodMs = periodDays * MS_PER_DAY
  const bounds: number[] = []
  for (let i = 0; i <= periods; i++) bounds.push(now - (periods - i) * periodMs)
  return bounds
}

const round1 = (n: number) => Math.round(n * 10) / 10

/** Everything the three measures need for one course, computed once. */
export interface CourseFacts {
  code: string
  people: Set<string>
  activePeople: Set<string>
  seconds: number
  mainSeconds: number
  listeningSeconds: number
  /** seconds per trend bucket */
  bucketSeconds: number[]
  /** learner ids active per bucket */
  bucketActive: Set<string>[]
  newEnrolments: number
  bucketEnrolments: number[]
  /**
   * Play-to-stop spans (the engine's session unit) and Listening Mode seconds
   * per bucket — read by the learner's own insights (api/me/insights.ts) for
   * "minutes per session" and "Listening Mode minutes" on the same facts.
   */
  spans: number
  bucketSpans: number[]
  bucketListeningSeconds: number[]
}

function emptyFacts(code: string, periods: number): CourseFacts {
  return {
    code, people: new Set(), activePeople: new Set(), seconds: 0, mainSeconds: 0, listeningSeconds: 0,
    bucketSeconds: new Array(periods).fill(0), bucketActive: Array.from({ length: periods }, () => new Set<string>()),
    newEnrolments: 0, bucketEnrolments: new Array(periods).fill(0),
    spans: 0, bucketSpans: new Array(periods).fill(0), bucketListeningSeconds: new Array(periods).fill(0),
  }
}

/**
 * Pure: per-course facts from the spans and the enrolments. Exported so the
 * measures are testable without a database.
 */
export function courseFactsFromSpans(
  sessions: Map<string, DiarySessionisation>,
  enrolments: Enrolment[],
  realIds: ReadonlySet<string>,
  since: number,
  now: number,
  periods: number,
  periodDays: number,
): Map<string, CourseFacts> {
  const bounds = periodBounds(periods, periodDays, now)
  const facts = new Map<string, CourseFacts>()
  const factsFor = (code: string): CourseFacts => {
    let f = facts.get(code)
    if (!f) {
      f = emptyFacts(code, periods)
      facts.set(code, f)
    }
    return f
  }
  for (const e of enrolments) {
    if (!realIds.has(e.learner_id)) continue
    const at = e.enrolled_at ? new Date(e.enrolled_at).getTime() : NaN
    if (Number.isFinite(at) && at >= now) continue // enrolled after the window's end
    const f = factsFor(e.course_id)
    f.people.add(e.learner_id)
    if (Number.isFinite(at) && at >= since) {
      f.newEnrolments++
      for (let i = 1; i < bounds.length; i++) if (at > bounds[i - 1] && at <= bounds[i]) { f.bucketEnrolments[i - 1]++; break }
    }
  }
  for (const [lid, s] of sessions) {
    if (!realIds.has(lid)) continue
    for (const span of s.spans) {
      if (!span.course) continue
      const secs = overlapSeconds(span, since, now)
      if (secs <= 0 && span.seconds > 0) continue
      const f = factsFor(span.course)
      f.people.add(lid)
      f.activePeople.add(lid)
      f.seconds += secs
      f.spans += 1
      if (span.mode === 'listening') f.listeningSeconds += secs
      else f.mainSeconds += secs
      for (let i = 1; i < bounds.length; i++) {
        const o = overlapSeconds(span, bounds[i - 1], bounds[i])
        if (o > 0) {
          f.bucketSeconds[i - 1] += o
          f.bucketActive[i - 1].add(lid)
          f.bucketSpans[i - 1] += 1
          if (span.mode === 'listening') f.bucketListeningSeconds[i - 1] += o
        }
      }
    }
  }
  return facts
}

export function measureFor(measure: MinutesMeasureId, f: CourseFacts): { value: number; trend: number[] } {
  const people = f.people.size
  switch (measure) {
    case 'minutes_per_person':
      return { value: people ? round1(f.seconds / 60 / people) : 0, trend: f.bucketSeconds.map((s) => (people ? round1(s / 60 / people) : 0)) }
    case 'minutes_total':
      return { value: Math.round(f.seconds / 60), trend: f.bucketSeconds.map((s) => round1(s / 60)) }
    case 'new_enrolments':
      return { value: f.newEnrolments, trend: f.bucketEnrolments }
    case 'no_activity':
      return { value: people ? round1(((people - f.activePeople.size) / people) * 100) : 0, trend: f.bucketActive.map((a) => (people ? round1(((people - a.size) / people) * 100) : 0)) }
  }
}

/**
 * Every course pooled as if it were one: seconds and enrolments summed, and
 * people counted per COURSE-PERSON (a learner on two courses is two people,
 * exactly as the per-course denominators count them). Keys are course-scoped
 * so the sets add across courses.
 */
export function pooledFacts(courses: readonly CourseFacts[]): CourseFacts {
  const periods = courses[0]?.bucketSeconds.length ?? 0
  const pooled = emptyFacts('*', periods)
  for (const f of courses) {
    for (const lid of f.people) pooled.people.add(`${f.code}\u0000${lid}`)
    for (const lid of f.activePeople) pooled.activePeople.add(`${f.code}\u0000${lid}`)
    pooled.seconds += f.seconds
    pooled.mainSeconds += f.mainSeconds
    pooled.listeningSeconds += f.listeningSeconds
    pooled.newEnrolments += f.newEnrolments
    pooled.spans += f.spans
    for (let i = 0; i < periods; i++) {
      pooled.bucketSeconds[i] += f.bucketSeconds[i] ?? 0
      pooled.bucketEnrolments[i] += f.bucketEnrolments[i] ?? 0
      pooled.bucketSpans[i] += f.bucketSpans[i] ?? 0
      pooled.bucketListeningSeconds[i] += f.bucketListeningSeconds[i] ?? 0
      for (const lid of f.bucketActive[i] ?? []) pooled.bucketActive[i].add(`${f.code}\u0000${lid}`)
    }
  }
  return pooled
}

/**
 * THE COMPARATOR — "Average of all courses" over `courses`, the selected
 * course among them. Ratio measures are learner-weighted (the pooled
 * numerator over the pooled denominator); count measures are the mean per
 * course. Pure and exported: the same list gives the same number whichever
 * course is the entity, and the test pins that.
 */
export function averageOfAllCourses(measure: MinutesMeasureId, courses: readonly CourseFacts[]): { value: number; trend: number[] } {
  const kind = MEASURES.find((m) => m.value === measure)!.kind
  const pooled = measureFor(measure, pooledFacts(courses))
  if (kind === 'ratio' || courses.length === 0) return pooled
  const n = courses.length
  return { value: round1(pooled.value / n), trend: pooled.trend.map((v) => round1(v / n)) }
}

function fmtMin(seconds: number): string {
  return Math.round(seconds / 60).toLocaleString('en-GB')
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (applyCors(req, res, { methods: 'GET' })) return
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return }
  if (!supabaseUrl || !supabaseServiceKey) { res.status(500).json({ error: 'Server misconfigured' }); return }

  const admin = await verifyAdmin(req)
  if ('error' in admin) { res.status(admin.status).json({ error: admin.error }); return }

  const requestedCourse = String(req.query.course_code || '').trim() || null
  const requestedWindowRaw = String(req.query.window || '').trim()
  const requestedWindow = WINDOW_ALIASES[requestedWindowRaw] ?? requestedWindowRaw
  const windowConfig = WINDOWS.find((w) => w.value === requestedWindow) ?? WINDOWS.find((w) => w.value === DEFAULT_WINDOW)!
  const requestedMeasure = String(req.query.measure || '').trim()
  const measureConfig = MEASURES.find((m) => m.value === requestedMeasure) ?? MEASURES.find((m) => m.value === DEFAULT_MEASURE)!
  const reconcileLearner = String(req.query.learner_id || '').trim() || null
  const reconcileEnv = String(req.query.env || '').trim() || DIARY_ENV

  const svc = createClient(supabaseUrl, supabaseServiceKey)
  const now = Date.now()
  const since = now - windowConfig.days * MS_PER_DAY
  const sinceIso = new Date(since).toISOString()
  const nowIso = new Date(now).toISOString()

  try {
    const [population, rowsByLearner, enrolments, names] = await Promise.all([
      resolveRealLearners(svc),
      readDiaryPlayRowsPacked(svc, sinceIso, nowIso, DIARY_ENV),
      loadEnrolments(svc),
      loadCourseNames(svc),
    ])
    const { realIds, count: populationCount } = population

    // Only real learners are sessionised: the excluded ids never reach the rule.
    const realRows = new Map([...rowsByLearner].filter(([lid]) => realIds.has(lid)))
    const sessions = await sessioniseAll(svc, realRows)
    const facts = courseFactsFromSpans(sessions, enrolments, realIds, since, now, windowConfig.periods, windowConfig.periodDays)

    const ranked = [...facts.values()].sort((a, b) => b.seconds - a.seconds || b.people.size - a.people.size || a.code.localeCompare(b.code))
    const courseOptions = ranked.map((f) => ({ code: f.code, classCount: f.people.size, hasData: f.seconds > 0 }))
    const courseCode = requestedCourse && facts.has(requestedCourse) ? requestedCourse : (ranked[0]?.code ?? null)
    const nameOf = (code: string) => names.get(code) ?? code

    const baseBody = {
      node: { id: 'everyone', name: courseCode ? nameOf(courseCode) : 'Everyone', label: 'course', kind: 'node' as const },
      options: {
        courses: courseOptions,
        compares: [{ value: COMPARE_ALL_COURSES, label: 'Average of all courses', word: 'global' }],
        windows: WINDOWS.map((w) => ({ value: w.value, label: w.label })),
        measures: MEASURES.map((m) => ({ value: m.value, label: m.label, desc: m.desc })),
      },
      applied: { course_code: courseCode, compare_to: COMPARE_ALL_COURSES, days: windowConfig.days, window: windowConfig.value, measure: measureConfig.value },
      windowLabel: windowConfig.label,
      trendLabel: windowConfig.trendLabel,
      trendPeriodDays: windowConfig.periodDays,
      kFloor: COURSE_COHORT_FLOOR,
      population: populationCount,
      diaryEnv: DIARY_ENV,
      coursePersonRule: 'a real learner enrolled on the course at the end of the window, or who played it inside the window',
      listeningExactFrom: LISTENING_EXACT_FROM,
      countedAt: nowIso,
    }

    // ─── Reconcile: one learner's spans, read in their own env, any population. ───
    let reconcile: unknown
    if (reconcileLearner) {
      const rows = await readDiaryPlayRowsPacked(svc, sinceIso, nowIso, reconcileEnv, [reconcileLearner])
      const s = (await sessioniseAll(svc, rows)).get(reconcileLearner)
      const spans = s?.spans ?? []
      reconcile = {
        learnerId: reconcileLearner,
        env: reconcileEnv,
        isRealLearner: realIds.has(reconcileLearner),
        rows: rows.get(reconcileLearner)?.length ?? 0,
        seconds: s?.seconds ?? 0,
        mainSeconds: s?.mainSeconds ?? 0,
        listeningSeconds: s?.listeningSeconds ?? 0,
        spans: spans.map((x) => ({
          openedAt: new Date(x.startMs).toISOString(),
          closedAt: new Date(x.endMs).toISOString(),
          mode: x.mode,
          course: x.course,
          seconds: x.seconds,
          minutes: round1(x.seconds / 60),
          clips: x.clips,
          openedBy: x.openedBy,
          closedBy: x.closedBy,
          closeClipEnd: x.closeClipEnd,
        })),
      }
    }

    res.setHeader('Cache-Control', 'no-store')
    if (!courseCode) {
      res.status(200).json({ ...baseBody, insufficientData: true, cohortSize: 0, reason: 'Nobody real has played or enrolled in this period.', reconcile })
      return
    }

    const entityFacts = facts.get(courseCode)!
    const entity = measureFor(measureConfig.value, entityFacts)
    // The COHORT is every course with anyone on it, the selected course
    // included, so the average is one fixed number for a window and a measure
    // (Tom, 2026-09-14: a comparator that moves when the course changes is
    // "confusing and not helpful for us as admin"). The DISTRIBUTION strip
    // stays the siblings: the widget adds the entity itself when it ranks.
    const cohort = ranked.filter((f) => f.people.size > 0)
    const members = cohort.filter((f) => f.code !== courseCode)
    if (courseCohortTooSmall(members.length)) {
      res.status(200).json({ ...baseBody, insufficientData: true, cohortSize: members.length, reason: `Only ${members.length} other course${members.length === 1 ? '' : 's'} to compare with — the comparison needs at least ${COURSE_COHORT_FLOOR}.`, reconcile })
      return
    }
    const cohortValues = members.map((f) => measureFor(measureConfig.value, f).value)
    const average = averageOfAllCourses(measureConfig.value, cohort)
    const averageValue = average.value
    const averageTrend = average.trend
    const dist = distributionStats(cohortValues)

    const split = {
      minutes: Math.round(entityFacts.seconds / 60),
      mainMinutes: Math.round(entityFacts.mainSeconds / 60),
      listeningMinutes: Math.round(entityFacts.listeningSeconds / 60),
      people: entityFacts.people.size,
      activePeople: entityFacts.activePeople.size,
      newEnrolments: entityFacts.newEnrolments,
    }
    const contextLine = `Main flow ${fmtMin(entityFacts.mainSeconds)} min · Listening Mode ${fmtMin(entityFacts.listeningSeconds)} min · ${split.people.toLocaleString('en-GB')} people on the course, ${split.activePeople.toLocaleString('en-GB')} of them active`

    res.status(200).json({
      ...baseBody,
      insufficientData: false,
      metricLabel: measureConfig.label,
      unit: measureConfig.unit,
      per: measureConfig.per,
      entity: { label: nameOf(courseCode), value: entity.value, trend: entity.trend },
      average: { label: 'Average of all courses', value: averageValue, trend: averageTrend },
      deltaPct: deltaPct(entity.value, averageValue),
      percentile: dist.percentileOf(entity.value),
      contextLine,
      subject: nameOf(courseCode),
      subjectIsViewer: false,
      levelNoun: 'course',
      cohortLabel: 'all courses',
      distribution: {
        values: dist.values,
        min: dist.min,
        q1: dist.q1,
        median: dist.median,
        q3: dist.q3,
        max: dist.max,
        entityValue: entity.value,
        averageValue,
        percentile: dist.percentileOf(entity.value),
      },
      cohortSize: members.length,
      averageCourses: cohort.length,
      split,
      reconcile,
    })
  } catch (error) {
    console.error('[intel/minutes] error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
}
