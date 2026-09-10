/**
 * GET /api/intel/pulse — question 1, the pulse.
 *
 * "How many real people practised this week, and is that more or less than last
 * week?" — by course and by country, rows being courses.
 *
 * WHY THIS COMPUTES RATHER THAN CALLING analytics_overview. The design document
 * says the data already exists in analytics_overview and analytics_growth, and
 * those functions ARE live — verified 2026-09-10. But analytics_overview
 * excludes only is_demo and is_internal: it does not know about staff platform
 * roles, class entities, or the machine countries, and it has no week-against-
 * week, no country and no per-course practice. Reading it here would put a
 * number on the page that disagrees with the population chip printed under it.
 * So the pulse is computed from sessions and player_events through the ONE
 * shared resolver, which is the rule the surface is built on.
 *
 * Every number here counts DISTINCT REAL PEOPLE, never sessions and never
 * events. A person who practised nine times this week is one person.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { verifyAdmin } from '../_utils/auth'
import { applyCors } from '../_utils/cors'
import { resolveRealLearners, isMachineCountry } from '../_utils/realLearnerPopulation'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

const DAY_MS = 24 * 60 * 60 * 1000

export interface PulseCourseRow {
  course: string
  thisWeek: number
  lastWeek: number
}

export interface PulseCountryRow {
  country: string
  people: number
}

export interface PulseResponse {
  thisWeek: number
  lastWeek: number
  population: number
  courses: PulseCourseRow[]
  countries: PulseCountryRow[]
  /** ISO instant the server finished counting — the Updated stamp reads this. */
  countedAt: string
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
  const thisWeekStart = new Date(now - 7 * DAY_MS).toISOString()
  const lastWeekStart = new Date(now - 14 * DAY_MS).toISOString()

  // Practice is a SESSION, which is the only table that records that somebody
  // actually practised rather than merely opened something.
  const { data: sessions, error: sessionsError } = await svc
    .from('sessions')
    .select('learner_id, course_id, started_at')
    .gte('started_at', lastWeekStart)

  if (sessionsError) {
    res.status(500).json({ error: 'Could not read practice' })
    return
  }

  const thisWeekPeople = new Set<string>()
  const lastWeekPeople = new Set<string>()
  const byCourse = new Map<string, { thisWeek: Set<string>; lastWeek: Set<string> }>()

  for (const s of (sessions ?? []) as { learner_id: string; course_id: string; started_at: string }[]) {
    if (!realIds.has(s.learner_id)) continue
    const isThisWeek = s.started_at >= thisWeekStart
    ;(isThisWeek ? thisWeekPeople : lastWeekPeople).add(s.learner_id)

    const course = s.course_id || 'unknown'
    let bucket = byCourse.get(course)
    if (!bucket) { bucket = { thisWeek: new Set(), lastWeek: new Set() }; byCourse.set(course, bucket) }
    ;(isThisWeek ? bucket.thisWeek : bucket.lastWeek).add(s.learner_id)
  }

  // Country lives only on player_events, so it is read separately and only for
  // the people who actually practised this week. The machine countries are
  // dropped by the shared rule, not by a filter written here.
  const { data: events } = await svc
    .from('player_events')
    .select('learner_id, ip_country')
    .gte('occurred_at', thisWeekStart)
    .eq('env', 'production')
    .not('learner_id', 'is', null)

  const byCountry = new Map<string, Set<string>>()
  for (const e of (events ?? []) as { learner_id: string; ip_country: string | null }[]) {
    if (!thisWeekPeople.has(e.learner_id)) continue
    if (isMachineCountry(e.ip_country)) continue
    const country = e.ip_country || 'unknown'
    let set = byCountry.get(country)
    if (!set) { set = new Set(); byCountry.set(country, set) }
    set.add(e.learner_id)
  }

  const body: PulseResponse = {
    thisWeek: thisWeekPeople.size,
    lastWeek: lastWeekPeople.size,
    population: count,
    courses: [...byCourse.entries()]
      .map(([course, b]) => ({ course, thisWeek: b.thisWeek.size, lastWeek: b.lastWeek.size }))
      .sort((a, b) => b.thisWeek - a.thisWeek || a.course.localeCompare(b.course)),
    countries: [...byCountry.entries()]
      .map(([country, set]) => ({ country, people: set.size }))
      .sort((a, b) => b.people - a.people || a.country.localeCompare(b.country)),
    countedAt: new Date().toISOString(),
  }

  res.status(200).json(body)
}
