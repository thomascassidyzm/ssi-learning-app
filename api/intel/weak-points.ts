/**
 * GET /api/intel/weak-points?course=<code>&days=<n> — question 4.
 *
 * "Which bits of a course make people stumble, skip or retry?"
 *
 * The raw events have been in production all along — audio_play carries a lego
 * id, and lego_skip, phase_skip, tap_skip, audio_retry and audio_failed are all
 * live — but nothing has ever aggregated them per LEGO. This endpoint is that
 * aggregate, and it is the highest-value thing the telemetry can be made to say
 * that it does not say today.
 *
 * THE K-FLOOR IS THE POINT, not a caveat. 87 real people have a position in any
 * course at all, spread across 53 courses, so most courses will answer "too few
 * learners to say" and that is the correct output. Seeding it, smoothing it or
 * dropping the floor to make the page look alive would make this the one page
 * on the surface that lies. Empty with honesty beats seeded.
 *
 * tap_pause is NOT read here. The same event fires when somebody opens the
 * Library or Settings or navigates away, so it is not a hesitation signal and
 * treating it as one would invent struggle out of somebody closing a tab.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { verifyAdmin } from '../_utils/auth'
import { applyCors } from '../_utils/cors'
import { resolveRealLearners, isMachineCountry } from '../_utils/realLearnerPopulation'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

/**
 * Fewer real learners than this behind a number and the number is not shown.
 * Five is the Insight Engine's own default floor (spec.ts, Sovereignty.kFloor)
 * and this uses the same value so a chart and a page cannot disagree.
 */
export const K_FLOOR = 5

/** One page of events; the loop below pages until it runs out or hits the cap. */
const PAGE = 1000
/** Hard ceiling on rows read for one course-window, so one busy course cannot
 *  hold the request open indefinitely. Truncation is REPORTED, never silent. */
const MAX_ROWS = 60000

const SKIP_EVENTS = new Set(['lego_skip', 'phase_skip', 'tap_skip'])

export interface WeakPointRow {
  legoId: string
  knownText: string | null
  targetText: string | null
  plays: number
  skips: number
  retries: number
  failures: number
  learnersReached: number
  /** Share of the people who reached this LEGO whose last event in the course
   *  was on it. Null when fewer than K_FLOOR people reached it. */
  stoppedShare: number | null
}

export interface WeakPointsResponse {
  course: string
  days: number
  /** Real people with any event in this course in the window. */
  learners: number
  /** True when the whole course is under the floor — rows are empty by design. */
  tooFewToSay: boolean
  kFloor: number
  rows: WeakPointRow[]
  /** True when the event read hit MAX_ROWS and the counts are a lower bound. */
  truncated: boolean
  countedAt: string
}

type EventRow = {
  learner_id: string | null
  event_type: string
  payload: Record<string, unknown> | null
  ip_country: string | null
  occurred_at: string
}

function legoIdOf(payload: Record<string, unknown> | null): string | null {
  if (!payload) return null
  const direct = payload.legoId
  if (typeof direct === 'string' && direct) return direct
  const from = payload.fromLegoId
  if (typeof from === 'string' && from) return from
  return null
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

  const course = typeof req.query.course === 'string' ? req.query.course.slice(0, 64) : ''
  if (!course) {
    res.status(400).json({ error: 'course is required' })
    return
  }
  const days = Math.min(365, Math.max(1, Number(req.query.days) || 90))

  const svc = createClient(supabaseUrl, supabaseServiceKey)
  const { realIds } = await resolveRealLearners(svc)

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()

  const events: EventRow[] = []
  let truncated = false
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data, error } = await svc
      .from('player_events')
      .select('learner_id, event_type, payload, ip_country, occurred_at')
      .eq('course_code', course)
      .eq('env', 'production')
      .gte('occurred_at', since)
      .order('occurred_at', { ascending: true })
      .range(from, from + PAGE - 1)

    if (error) {
      res.status(500).json({ error: 'Could not read events' })
      return
    }
    const page = (data ?? []) as EventRow[]
    events.push(...page)
    if (page.length < PAGE) break
    if (from + PAGE >= MAX_ROWS) truncated = true
  }

  // Per-LEGO tallies, and per-person the LEGO they were last seen on.
  const tally = new Map<string, { plays: number; skips: number; retries: number; failures: number; reached: Set<string> }>()
  const lastLegoByLearner = new Map<string, string>()
  const learnersInCourse = new Set<string>()

  for (const e of events) {
    if (!e.learner_id || !realIds.has(e.learner_id)) continue
    if (isMachineCountry(e.ip_country)) continue
    learnersInCourse.add(e.learner_id)

    const legoId = legoIdOf(e.payload)
    if (!legoId) continue

    let t = tally.get(legoId)
    if (!t) { t = { plays: 0, skips: 0, retries: 0, failures: 0, reached: new Set() }; tally.set(legoId, t) }
    t.reached.add(e.learner_id)

    if (e.event_type === 'audio_play') t.plays++
    else if (SKIP_EVENTS.has(e.event_type)) t.skips++
    else if (e.event_type === 'audio_retry') t.retries++
    else if (e.event_type === 'audio_failed') t.failures++

    // Events are read oldest-first, so the last write wins and this ends up
    // holding the LEGO each person was on when they stopped.
    lastLegoByLearner.set(e.learner_id, legoId)
  }

  if (learnersInCourse.size < K_FLOOR) {
    const body: WeakPointsResponse = {
      course, days,
      learners: learnersInCourse.size,
      tooFewToSay: true,
      kFloor: K_FLOOR,
      rows: [],
      truncated,
      countedAt: new Date().toISOString(),
    }
    res.status(200).json(body)
    return
  }

  const stoppedOn = new Map<string, number>()
  for (const legoId of lastLegoByLearner.values()) {
    stoppedOn.set(legoId, (stoppedOn.get(legoId) ?? 0) + 1)
  }

  // Position is a LEGO and a row shows both languages, never a seed number.
  const legoIds = [...tally.keys()]
  const { data: legoRows } = await svc
    .from('course_legos')
    .select('lego_id, known_text, target_text')
    .eq('course_code', course)
    .in('lego_id', legoIds.slice(0, 1000))

  const text = new Map<string, { known: string | null; target: string | null }>()
  for (const l of (legoRows ?? []) as { lego_id: string; known_text: string | null; target_text: string | null }[]) {
    text.set(l.lego_id, { known: l.known_text, target: l.target_text })
  }

  const rows: WeakPointRow[] = legoIds.map((legoId) => {
    const t = tally.get(legoId)!
    const reached = t.reached.size
    return {
      legoId,
      knownText: text.get(legoId)?.known ?? null,
      targetText: text.get(legoId)?.target ?? null,
      plays: t.plays,
      skips: t.skips,
      retries: t.retries,
      failures: t.failures,
      learnersReached: reached,
      stoppedShare: reached >= K_FLOOR ? (stoppedOn.get(legoId) ?? 0) / reached : null,
    }
  })

  // Ranked by how much trouble a LEGO caused per person who met it. A LEGO
  // under the floor sorts last rather than being dropped: it still happened.
  rows.sort((a, b) => {
    const score = (r: WeakPointRow) =>
      r.learnersReached >= K_FLOOR
        ? (r.skips + r.retries + r.failures) / r.learnersReached + (r.stoppedShare ?? 0)
        : -1
    return score(b) - score(a) || a.legoId.localeCompare(b.legoId)
  })

  const body: WeakPointsResponse = {
    course, days,
    learners: learnersInCourse.size,
    tooFewToSay: false,
    kFloor: K_FLOOR,
    rows: rows.slice(0, 50),
    truncated,
    countedAt: new Date().toISOString(),
  }
  res.status(200).json(body)
}
