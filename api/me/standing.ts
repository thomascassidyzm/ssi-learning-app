/**
 * Current-user standing API — GET /api/me/standing?course=<course_code>
 *
 * Auth required. Answers ONE question for the learner, in the Library:
 * "am I doing OK?" — by placing them in the distribution of people who
 * started the SAME course at around the SAME time.
 *
 * ── WHY THIS IS ALLOWED TO EXIST ───────────────────────────────────────────
 * `docs/gamification-done-right.md` bans leaderboards outright ("comparison
 * anxiety; competition over growth") but explicitly carves out the *standing*
 * widget, and `docs/methodology/insight-engine.md` §3.5 specifies it: a
 * sovereign comparison showing "the individual's own marker, the average, and
 * the percentile — 'you're in the top 20% of Welsh learners'", which exists
 * "to honour the handful really putting the time in and to let everyone feel
 * part of it — never a league table to climb."
 *
 * Standing survives the doctrine where streaks and badges do not because it is
 * INFORMATION ABOUT WHERE YOU ARE, not a prize for showing up. Three properties
 * are what keep it on the right side of that line, and each is enforced here:
 *
 *  1. IT RANKS PROGRESS, NOT TIME. The metric is the learner's furthest point
 *     in the course (`highest_completed_lego_id`), never minutes in the app.
 *     Grinding cannot move it; only getting further through the course can. So
 *     it cannot reward sitting there over understanding.
 *
 *  2. IT CANNOT REPRESENT ABSENCE. `highest_completed_lego_id` is a HIGH-WATER
 *     MARK — monotonic by construction — so a learner's own value can never
 *     fall. There is no window, no rolling rate, no decay. A percentile
 *     computed over a 30-day window would be a streak wearing a percentile's
 *     clothes: it would drop while you were away, which hands the system the
 *     ability to say "you've slipped". This one cannot say that, and the
 *     ProfileView acceptance test ("nothing here could ever generate a
 *     Duolingo-style shame email") is what forbids it.
 *
 *  3. IT ONLY EVER COUNTS WHO YOU ARE AHEAD OF. The response carries
 *     `aheadOfPct`, never a rank and never "behind N%". Mathematically the
 *     same fact, psychologically the opposite one.
 *
 * ── THE HONESTY GATE (the reason this ships dark today) ────────────────────
 * A percentile off a tiny or fake cohort is a lie with a number on it. Two
 * filters stand between the raw table and any number a learner sees:
 *
 *  ELIGIBILITY — only real individual humans count. The `learners` table
 *  already carries the flags and they are populated and maintained
 *  (measured 2026-08-31: of 1,136 rows, 723 `is_demo`, 76 `is_class_entity`
 *  — "Grade 6A", "Blwyddyn 5", "Year 7 Blue" are CLASSES, not people — 19
 *  `is_internal`, 5 testers, 12 ssi_admins). Excluding all of those leaves
 *  346 real individuals, 88 of whom have ever reached a position in a course.
 *
 *  K-ANONYMITY — a cohort under MIN_COHORT returns nothing at all. This is
 *  the standing direction in WORKLIST.md: "ANALYTICS ARE REAL OR ABSENT
 *  (Tom, 2026-07-14) … comparison/benchmark views only make sense once real
 *  cohorts exist — wire them real but don't fake them meanwhile;
 *  empty-with-honesty beats seeded."
 *
 * MEASURED CONSEQUENCE, STATED PLAINLY: on the live database as of
 * 2026-08-31 no cohort clears k=20 — the largest real single-course cohort is
 * 19 (afr_for_eng) and the 88 real learners are spread across 53 courses. So
 * this endpoint returns `{ standing: null, reason: 'cohort-too-small' }` for
 * every real learner today, and the widget renders nothing. That is the
 * correct behaviour, not a failure: it lights up on its own, with no further
 * work, the day a real cohort exists — which the schools pipeline will produce.
 *
 * ── WHAT IS DELIBERATELY NOT HERE ──────────────────────────────────────────
 * No top-5 list (insight-engine.md permits an anonymised one, but at today's
 * cohort sizes initials identify a named person, so it stays out until k is
 * comfortably clear). No rank number. No cross-course pooling — comparing a
 * Welsh learner's position to a Japanese learner's is not a like-for-like
 * statement, and pooling to manufacture a cohort is exactly the lie the gate
 * exists to prevent. No notification, ever.
 *
 * Scoped to the caller's own learner id — it can only ever place the caller.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { verifyAuthToken } from '../_utils/auth'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

/**
 * The k-anonymity floor. A cohort smaller than this yields no number at all.
 *
 * 20 is chosen so a single percentile point is not one person: at k=20 each
 * learner moves the figure by 5%, which is already coarse, and below it the
 * number stops being a description of a population and becomes a description
 * of a handful of individuals. Deliberately a constant, not a tunable env var:
 * lowering it is a judgement about what we are willing to assert, and that
 * belongs in a commit with this comment attached to it, not in a dashboard.
 */
export const MIN_COHORT = 20

/** The reason a standing could not honestly be produced. Never shown raw to a learner. */
export type StandingGap =
  | 'no-course'
  | 'not-enrolled'
  | 'no-position'
  | 'cohort-too-small'

export interface CohortMember {
  learner_id: string
  seed: number
}

/** "S0280L01" → 280. Anything else → null. Mirrors parseLegoCursor in legos-learnt.ts. */
export function seedFromCursor(legoId: string | null | undefined): number | null {
  if (!legoId) return null
  const match = /^S(\d{4})L(\d+)/.exec(legoId)
  if (!match) return null
  return parseInt(match[1], 10)
}

/** UTC calendar quarter of a timestamp, e.g. "2026Q2". The cohort's time key. */
export function quarterOf(ts: string | null | undefined): string | null {
  if (!ts) return null
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return null
  return `${d.getUTCFullYear()}Q${Math.floor(d.getUTCMonth() / 3) + 1}`
}

export interface Standing {
  /** Percentage of the cohort this learner is strictly AHEAD of, 0-100. */
  aheadOfPct: number
  /** How many real people the comparison is against (this learner included). */
  cohortSize: number
  /** 'quarter' = started the same course around the same time; 'course' = same course, any time. */
  cohortKind: 'quarter' | 'course'
  /** The quarter label when cohortKind is 'quarter', e.g. "2026Q2". */
  cohortQuarter: string | null
  /** The cohort's median position, so the UI can say "most people are around here". */
  medianSeed: number
  /** This learner's own furthest point. */
  seed: number
}

/**
 * Place `mySeed` within `cohort`, or refuse.
 *
 * `aheadOfPct` counts members STRICTLY behind this learner, so a learner tied
 * with everyone else is ahead of 0% rather than being flattered — and the
 * learner is always counted in their own cohort size, so the denominator is
 * the honest population, not the population minus themselves.
 */
export function placeInCohort(
  mySeed: number,
  cohort: CohortMember[],
  minCohort: number = MIN_COHORT
): Standing | { gap: StandingGap } {
  if (cohort.length < minCohort) return { gap: 'cohort-too-small' }

  const behind = cohort.filter((m) => m.seed < mySeed).length
  const sorted = cohort.map((m) => m.seed).sort((a, b) => a - b)
  const medianSeed = sorted[Math.floor(sorted.length / 2)]

  return {
    aheadOfPct: Math.round((behind / cohort.length) * 100),
    cohortSize: cohort.length,
    cohortKind: 'course',
    cohortQuarter: null,
    medianSeed,
    seed: mySeed,
  }
}

/**
 * Choose the tightest cohort that still clears the floor, and place the learner.
 *
 * The ladder is deliberately only TWO rungs, tightest first:
 *   1. same course AND same enrolment quarter — the real statement, because it
 *      compares people who started the same thing at the same time
 *   2. same course, any start time — weaker, but still like-for-like on the
 *      only axis that governs how far you can have got: the course itself
 * and then it stops. There is no third rung pooling across courses, because
 * that comparison is not true.
 */
export function chooseCohort(
  me: { seed: number; quarter: string | null },
  peers: Array<CohortMember & { quarter: string | null }>,
  minCohort: number = MIN_COHORT
): Standing | { gap: StandingGap } {
  if (me.quarter) {
    const sameQuarter = peers.filter((p) => p.quarter === me.quarter)
    const placed = placeInCohort(me.seed, sameQuarter, minCohort)
    if (!('gap' in placed)) {
      return { ...placed, cohortKind: 'quarter', cohortQuarter: me.quarter }
    }
  }
  return placeInCohort(me.seed, peers, minCohort)
}

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

  const course = typeof req.query.course === 'string' ? req.query.course.trim() : ''
  if (!course) {
    res.status(200).json({ standing: null, reason: 'no-course' })
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
      res.status(200).json({ standing: null, reason: 'not-enrolled' })
      return
    }

    // Every enrolment on this course, with the enrolling learner's eligibility
    // flags joined in. One indexed read on (course_id) — the whole feature is
    // this query plus arithmetic. No new table, no new signal, no writes.
    const { data: rows, error } = await supabase
      .from('course_enrollments')
      .select('learner_id, enrolled_at, highest_completed_lego_id, learners!inner(is_demo, is_internal, is_class_entity, platform_role)')
      .eq('course_id', course)

    if (error) {
      console.error('[me/standing] cohort read error:', error)
      // Fail soft and silent — a missing standing is a blank space in the
      // Library, which is exactly what the honesty gate produces anyway.
      res.status(200).json({ standing: null, reason: 'cohort-too-small' })
      return
    }

    // ELIGIBILITY: real individual humans only. A class entity is not a person,
    // a demo row is not a person, and staff are not the population a learner
    // wants to be measured against.
    const eligible = (rows || []).filter((r: any) => {
      const l = Array.isArray(r.learners) ? r.learners[0] : r.learners
      if (!l) return false
      if (l.is_demo || l.is_internal || l.is_class_entity) return false
      if (l.platform_role === 'tester' || l.platform_role === 'ssi_admin') return false
      return seedFromCursor(r.highest_completed_lego_id) !== null
    })

    const mine = eligible.find((r: any) => r.learner_id === learner.id)
    const mySeed = mine ? seedFromCursor((mine as any).highest_completed_lego_id) : null
    if (mySeed === null) {
      // Either not enrolled, not yet started, or not an eligible account — all
      // three mean the same thing to the learner: no number, no explanation.
      res.status(200).json({ standing: null, reason: 'no-position' })
      return
    }

    const peers: Array<CohortMember & { quarter: string | null }> = eligible.map((r: any) => ({
      learner_id: r.learner_id,
      seed: seedFromCursor(r.highest_completed_lego_id) as number,
      quarter: quarterOf(r.enrolled_at),
    }))

    const placed = chooseCohort(
      { seed: mySeed, quarter: quarterOf((mine as any).enrolled_at) },
      peers
    )

    if ('gap' in placed) {
      res.status(200).json({ standing: null, reason: placed.gap })
      return
    }

    res.status(200).json({ standing: placed })
  } catch (err: any) {
    console.error('[me/standing] Error:', err)
    res.status(200).json({ standing: null, reason: 'cohort-too-small' })
  }
}
