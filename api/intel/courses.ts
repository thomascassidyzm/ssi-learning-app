/**
 * GET /api/intel/courses — question 5.
 *
 * "Which courses are worth our attention, and which are people actually
 * finishing?" One ranking, replacing the Courses tiles and the Course
 * Scoreboard: for every course, how many real people have ever been in it,
 * how many practised it in the last thirty days and the last seven, how
 * many minutes they gave it, and how many have reached the end.
 *
 * REACH, STICKINESS, FINISHING, in the design's words:
 *   - reach       = real people who have ever been in the course: an
 *                   enrolment row, or a session in the last thirty days —
 *                   the live probe of 2026-09-10 found people practising a
 *                   course with no enrolment row, so enrolments alone
 *                   undercount and put stickiness over one.
 *   - stickiness  = of those, the share who practised in the last thirty days
 *   - finishing   = real people whose furthest point is at or past nine
 *                   tenths of the course's seeds. Position is a LEGO, never a
 *                   seed number, but course_enrollments records the highest
 *                   completed SEED and courses records seed_count, and that
 *                   ratio is the one honest "how far through" available
 *                   without reading every LEGO id. A course with no recorded
 *                   seed_count reports finishing as null, never as zero.
 *
 * Ranked by people practising in the last thirty days, then by reach. Real
 * people only, through the one shared resolver.
 *
 * NO MINUTES. The enrolments' minute counter is a dead column that stopped
 * being written in 2026-04, and the sessions table's own duration is not
 * reliably written either — the live probe read one minute for fifty-five
 * people on one course beside a thousand for eleven on another. A number
 * that lies quietly is the failure this surface exists to avoid, so minutes
 * are not on this page until they are computed from the events themselves.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { verifyAdmin } from '../_utils/auth'
import { applyCors } from '../_utils/cors'
import { resolveRealLearners } from '../_utils/realLearnerPopulation'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

const DAY_MS = 86_400_000
/** Reaching this share of a course's seeds counts as finishing it. */
export const FINISHED_SHARE = 0.9

export interface CourseRow {
  course: string
  name: string
  community: boolean
  seeds: number | null
  reach: number
  practised30: number
  practised7: number
  finished: number | null
  /** practised30 / reach, or null when nobody has ever been in it. */
  stickiness: number | null
}

export interface CoursesResponse {
  population: number
  rows: CourseRow[]
  countedAt: string
}

export function isFinished(highestSeed: number | null | undefined, seedCount: number | null | undefined): boolean | null {
  if (!seedCount || seedCount <= 0) return null
  if (highestSeed === null || highestSeed === undefined) return false
  return highestSeed >= Math.ceil(seedCount * FINISHED_SHARE)
}

export function rankCourses(a: CourseRow, b: CourseRow): number {
  return b.practised30 - a.practised30 || b.reach - a.reach || a.course.localeCompare(b.course)
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (applyCors(req, res, { methods: 'GET' })) return
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }
  const admin = await verifyAdmin(req)
  if ('error' in admin) {
    res.status(admin.status).json({ error: admin.error })
    return
  }

  const svc = createClient(supabaseUrl, supabaseServiceKey)
  const { realIds, count } = await resolveRealLearners(svc)
  const now = Date.now()
  const thirtyDaysAgo = new Date(now - 30 * DAY_MS).toISOString()
  const sevenDaysAgo = now - 7 * DAY_MS

  const [{ data: courses, error: coursesError }, { data: enrolments }, { data: sessions }] = await Promise.all([
    svc.from('courses').select('course_code, display_name, is_community, seed_count'),
    svc.from('course_enrollments').select('learner_id, course_id, highest_completed_seed'),
    svc.from('sessions').select('learner_id, course_id, started_at').gte('started_at', thirtyDaysAgo),
  ])
  if (coursesError || !courses) {
    res.status(500).json({ error: 'Could not read courses' })
    return
  }

  const seedCount = new Map<string, number | null>()
  const rows = new Map<string, CourseRow>()
  for (const c of courses as { course_code: string; display_name: string | null; is_community: boolean | null; seed_count: number | null }[]) {
    seedCount.set(c.course_code, c.seed_count)
    rows.set(c.course_code, {
      course: c.course_code,
      name: c.display_name || c.course_code,
      community: !!c.is_community,
      seeds: c.seed_count,
      reach: 0,
      practised30: 0,
      practised7: 0,
      finished: c.seed_count ? 0 : null,
      stickiness: null,
    })
  }

  const ever = new Map<string, Set<string>>()
  const setFor = (m: Map<string, Set<string>>, k: string) => m.get(k) ?? m.set(k, new Set()).get(k)!
  for (const e of (enrolments ?? []) as { learner_id: string; course_id: string; highest_completed_seed: number | null }[]) {
    if (!realIds.has(e.learner_id)) continue
    const row = rows.get(e.course_id)
    if (!row) continue
    setFor(ever, e.course_id).add(e.learner_id)
    if (isFinished(e.highest_completed_seed, seedCount.get(e.course_id))) row.finished = (row.finished ?? 0) + 1
  }

  const seen30 = new Map<string, Set<string>>()
  const seen7 = new Map<string, Set<string>>()
  for (const s of (sessions ?? []) as { learner_id: string; course_id: string; started_at: string }[]) {
    if (!realIds.has(s.learner_id) || !rows.has(s.course_id)) continue
    setFor(seen30, s.course_id).add(s.learner_id)
    setFor(ever, s.course_id).add(s.learner_id)
    if (new Date(s.started_at).getTime() >= sevenDaysAgo) setFor(seen7, s.course_id).add(s.learner_id)
  }

  for (const row of rows.values()) {
    row.reach = ever.get(row.course)?.size ?? 0
    row.practised30 = seen30.get(row.course)?.size ?? 0
    row.practised7 = seen7.get(row.course)?.size ?? 0
    row.stickiness = row.reach > 0 ? Math.round((row.practised30 / row.reach) * 100) / 100 : null
  }

  const body: CoursesResponse = {
    population: count,
    rows: [...rows.values()].sort(rankCourses),
    countedAt: new Date().toISOString(),
  }
  res.status(200).json(body)
}
