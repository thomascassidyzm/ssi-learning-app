/**
 * Learner profile payload — GET /api/me/profile
 *
 * The one server call behind the learner's motivation/profile layer (the
 * mirror + the portrait + the adherence panel + the plan). Founder design
 * ruling 2026-08-03: three layers, three energies.
 *
 *   1. CELEBRATE ADHERENCE — the only rewarded thing is showing up and giving
 *      it a go. Speaking opportunities are "goes". Return is celebrated;
 *      ABSENCE IS NEVER COMPUTED. This endpoint deliberately has no notion of
 *      a streak, a gap, a missed day, or a lapse — if the data model can know
 *      "streak: 0" the design is already wrong, so it cannot.
 *   2. REFLECT EXECUTION (the mirror) — latency reported directly, honest and
 *      unrewarded, framed as "where you are × the direction you're moving".
 *   3. ESTIMATE LEVEL (the portrait) — difficulty × execution, where COURSE
 *      POSITION is the difficulty term. Brilliant on unit 3 is not expert;
 *      struggling on unit 900 is not weak. Surfaced as a NOTIONAL CEFR band
 *      that sharpens with data — never a test result.
 *
 * NUMBERS RULE: no incentive-points anywhere in the response. Every number
 * here is a descriptive insight (goes, minutes, milliseconds) the learner
 * could count themselves. The weighting that produces the portrait is the one
 * hidden formula, and it stays hidden — server-side, never shipped to the
 * client, never surfaced as a score.
 *
 * Every block reports its own `source: 'real' | 'mock'` so the UI can label
 * plausible-but-invented data honestly rather than passing it off as live.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { verifyAuthToken } from '../_utils/auth'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

/** Listening heartbeat cadence (ListeningOverlay LISTENING_TICK_MS) — one tick = 30s engaged. */
const LISTENING_TICK_MINUTES = 0.5

/** The unit of the reasonable plan (project_ssi_reasonability_adherence): 30 hours, cadence free. */
export const PLAN_TARGET_HOURS = 30

export type SourceTag = 'real' | 'mock'

export interface MirrorPoint { hours: number; ms: number }

export interface LearnerProfilePayload {
  courseCode: string | null
  adherence: {
    goesThisWeek: number
    goesTotal: number
    speakingMinutesThisWeek: number
    listeningMinutesThisWeek: number
    daysPresentThisWeek: number
    source: SourceTag
  }
  mirror: {
    latencyNowMs: number | null
    latencyEarlyMs: number | null
    /** Negative = replies are arriving faster than they used to. */
    directionPct: number | null
    curve: MirrorPoint[]
    smoothShare: number | null
    unitsSteady: number
    source: SourceTag
  }
  portrait: {
    positionKnown: string | null
    positionTarget: string | null
    unitsMet: number
    /** 0..1 — how much the estimate has settled. Drives the visible interval width. */
    confidence: number
    cefr: { band: string; low: string; high: string }
    source: SourceTag
  }
  plan: {
    hoursDone: number
    targetHours: number
    source: SourceTag
  }
}

// ---------------------------------------------------------------------------
// The hidden formula. Lives here and only here.
// ---------------------------------------------------------------------------

/**
 * Notional CEFR estimate = difficulty × execution.
 *
 * Difficulty term = course position (units met). Execution term = how settled
 * the learner's replies are at that position (mastery mix + latency trend).
 * Execution can nudge the estimate one step either way inside the position's
 * neighbourhood; it can never carry a learner at unit 3 to B1, because
 * position is the dominant term by construction.
 *
 * The band is deliberately returned WITH an interval (low..high) that narrows
 * as confidence rises — the learner sees an estimate getting sharper, never a
 * verdict.
 */
const CEFR_LADDER = ['pre-A1', 'A1', 'A1+', 'A2', 'A2+', 'B1', 'B1+', 'B2'] as const

function positionRung(unitsMet: number): number {
  // Anchored on the shipped belt thresholds (seeds), read in units.
  if (unitsMet < 10) return 0
  if (unitsMet < 30) return 1
  if (unitsMet < 70) return 2
  if (unitsMet < 140) return 3
  if (unitsMet < 240) return 4
  if (unitsMet < 400) return 5
  if (unitsMet < 700) return 6
  return 7
}

export function estimateCefr(
  unitsMet: number,
  executionScore: number,
  confidence: number
): { band: string; low: string; high: string } {
  const base = positionRung(unitsMet)
  // Execution nudges by at most one rung, and only once there is enough of it.
  const nudge = confidence < 0.25 ? 0 : executionScore > 0.66 ? 1 : executionScore < 0.33 ? -1 : 0
  const centre = Math.max(0, Math.min(CEFR_LADDER.length - 1, base + nudge))
  // Interval width: wide while unsure, collapsing to the single band when settled.
  const width = confidence > 0.75 ? 0 : confidence > 0.45 ? 1 : 2
  const low = Math.max(0, centre - width)
  const high = Math.min(CEFR_LADDER.length - 1, centre + width)
  return { band: CEFR_LADDER[centre], low: CEFR_LADDER[low], high: CEFR_LADDER[high] }
}

// ---------------------------------------------------------------------------

function startOfWeekUtc(now: Date): Date {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const dow = (d.getUTCDay() + 6) % 7 // Monday = 0
  d.setUTCDate(d.getUTCDate() - dow)
  return d
}

/**
 * Mock block — clearly-labelled plausible data for a learner with no rows yet,
 * so the surfaces are tasteable on dev. Shaped like a real week-two learner.
 * NOTE the shape still cannot express an absence: no zero-streak, no gap.
 */
function mockPayload(courseCode: string | null): LearnerProfilePayload {
  const curve: MirrorPoint[] = [
    { hours: 0.5, ms: 2450 }, { hours: 1.5, ms: 2310 }, { hours: 2.5, ms: 2180 },
    { hours: 3.5, ms: 1990 }, { hours: 4.5, ms: 1880 }, { hours: 5.5, ms: 1740 },
    { hours: 6.5, ms: 1660 }, { hours: 7.5, ms: 1520 },
  ]
  return {
    courseCode,
    adherence: {
      goesThisWeek: 247, goesTotal: 1120,
      speakingMinutesThisWeek: 96, listeningMinutesThisWeek: 34,
      daysPresentThisWeek: 4, source: 'mock',
    },
    mirror: {
      latencyNowMs: 1520, latencyEarlyMs: 2450, directionPct: -38,
      curve, smoothShare: 0.61, unitsSteady: 34, source: 'mock',
    },
    portrait: {
      positionKnown: 'I wanted to speak to you', positionTarget: 'quería hablar contigo',
      unitsMet: 46, confidence: 0.42,
      cefr: estimateCefr(46, 0.6, 0.42), source: 'mock',
    },
    plan: { hoursDone: 7.5, targetHours: PLAN_TARGET_HOURS, source: 'mock' },
  }
}

async function buildPayload(
  supabase: SupabaseClient,
  learnerId: string,
  courseCode: string | null
): Promise<LearnerProfilePayload> {
  const now = new Date()
  const weekStart = startOfWeekUtc(now)
  const weekStartDay = weekStart.toISOString().slice(0, 10)

  const mock = mockPayload(courseCode)

  // --- Layer 1: adherence. Goes + speaking seconds, per day, from the live
  // per-day rollup. We read only days that HAVE rows; a day with no row is
  // simply not in the set. There is no iteration over "days since" anywhere.
  const [goesWeekRes, goesAllRes, listeningRes, metricsRes, sessionsRes] = await Promise.all([
    supabase
      .from('learner_speaking_opportunities')
      .select('day, opportunities, play_seconds')
      .eq('learner_id', learnerId)
      .gte('day', weekStartDay),
    supabase
      .from('learner_speaking_opportunities')
      .select('opportunities')
      .eq('learner_id', learnerId),
    supabase
      .from('player_events')
      .select('id', { count: 'exact', head: true })
      .eq('learner_id', learnerId)
      .eq('event_type', 'listening_tick')
      .gte('occurred_at', weekStart.toISOString()),
    supabase
      .from('learner_lego_metrics')
      .select('lego_id, course_code, mastery_state, mean_latency_ms, n_samples, last_seen_at')
      .eq('learner_id', learnerId)
      .order('last_seen_at', { ascending: true })
      .limit(2000),
    supabase
      .from('sessions')
      .select('duration_seconds')
      .eq('learner_id', learnerId)
      .limit(5000),
  ])

  const weekRows = goesWeekRes.data ?? []
  const hasAdherence = weekRows.length > 0 || (goesAllRes.data?.length ?? 0) > 0
  const adherence = hasAdherence
    ? {
        goesThisWeek: weekRows.reduce((n, r: any) => n + Number(r.opportunities || 0), 0),
        goesTotal: (goesAllRes.data ?? []).reduce((n: number, r: any) => n + Number(r.opportunities || 0), 0),
        speakingMinutesThisWeek: Math.round(
          weekRows.reduce((n, r: any) => n + Number(r.play_seconds || 0), 0) / 60
        ),
        listeningMinutesThisWeek: Math.round((listeningRes.count ?? 0) * LISTENING_TICK_MINUTES),
        daysPresentThisWeek: new Set(weekRows.map((r: any) => r.day)).size,
        source: 'real' as SourceTag,
      }
    : mock.adherence

  // --- Total engaged hours (plan progress + the mirror's x-axis).
  const totalSeconds = (sessionsRes.data ?? []).reduce(
    (n: number, r: any) => n + Number(r.duration_seconds || 0), 0
  )
  const hoursDone = totalSeconds / 3600
  const plan = totalSeconds > 0
    ? { hoursDone: Math.round(hoursDone * 10) / 10, targetHours: PLAN_TARGET_HOURS, source: 'real' as SourceTag }
    : mock.plan

  // --- Layer 2: the mirror. Latency direction from the per-unit metrics,
  // oldest-seen units standing in for "then" and newest for "now".
  const metrics = (metricsRes.data ?? []).filter((m: any) => typeof m.mean_latency_ms === 'number')
  let mirror = mock.mirror
  if (metrics.length >= 6) {
    const window = Math.max(3, Math.floor(metrics.length / 4))
    const mean = (rows: any[]) => rows.reduce((n, r) => n + Number(r.mean_latency_ms), 0) / rows.length
    const early = mean(metrics.slice(0, window))
    const nowMs = mean(metrics.slice(-window))
    // Curve: bucket the units in seen-order across the learner's engaged hours,
    // so the shape reads as "the direction you're moving" against time in app.
    const buckets = Math.min(8, Math.max(3, Math.floor(metrics.length / 4)))
    const per = Math.ceil(metrics.length / buckets)
    const curve: MirrorPoint[] = []
    for (let i = 0; i < buckets; i++) {
      const slice = metrics.slice(i * per, (i + 1) * per)
      if (!slice.length) continue
      curve.push({
        hours: Math.round(((hoursDone || buckets) * ((i + 0.5) / buckets)) * 10) / 10,
        ms: Math.round(mean(slice)),
      })
    }
    const steady = metrics.filter((m: any) =>
      m.mastery_state === 'confident' || m.mastery_state === 'mastered').length
    mirror = {
      latencyNowMs: Math.round(nowMs),
      latencyEarlyMs: Math.round(early),
      directionPct: early > 0 ? Math.round(((nowMs - early) / early) * 100) : null,
      curve,
      smoothShare: metrics.length ? Math.round((steady / metrics.length) * 100) / 100 : null,
      unitsSteady: steady,
      source: 'real',
    }
  }

  // --- Layer 3: the portrait. Position is the difficulty term.
  let portrait = mock.portrait
  if (metrics.length > 0) {
    const unitsMet = metrics.length
    const steadyShare = mirror.smoothShare ?? 0.4
    // Execution: how settled the replies are, softened by the latency direction.
    const trend = mirror.directionPct ?? 0
    const execution = Math.max(0, Math.min(1, steadyShare + (trend < -10 ? 0.15 : trend > 10 ? -0.15 : 0)))
    // Confidence: sample volume, saturating. An interval that visibly narrows.
    const samples = metrics.reduce((n: number, m: any) => n + Number(m.n_samples || 0), 0)
    const confidence = Math.max(0, Math.min(1, Math.log10(1 + samples) / 3))
    const last: any = metrics[metrics.length - 1]
    portrait = {
      // Learner-facing position is the content itself, never a number and
      // never the internal unit id (feedback_ssi_position_is_lego_not_seed).
      positionKnown: null,
      positionTarget: null,
      unitsMet,
      confidence: Math.round(confidence * 100) / 100,
      cefr: estimateCefr(unitsMet, execution, confidence),
      source: 'real',
    }
    // Resolve the last unit's own words so the learner sees what they said,
    // not where they are in a list.
    if (last?.lego_id) {
      // lego_id is unique only WITHIN a course, so scope the lookup by the
      // metric row's own course_code.
      const { data: lego } = await supabase
        .from('course_legos')
        .select('known_text, target_text')
        .eq('lego_id', last.lego_id)
        .eq('course_code', last.course_code ?? courseCode ?? '')
        .maybeSingle()
      if (lego) {
        portrait.positionKnown = (lego as any).known_text ?? null
        portrait.positionTarget = (lego as any).target_text ?? null
      }
    }
  }

  return { courseCode, adherence, mirror, portrait, plan }
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const courseCode = typeof req.query.course === 'string' ? req.query.course : null

  const authResult = await verifyAuthToken(req)
  if (!authResult.valid || !authResult.userId) {
    // Guests see the shape, clearly labelled as sample data — the surfaces
    // stay tasteable without ever inventing a signed-in learner's history.
    res.status(200).json(mockPayload(courseCode))
    return
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey)
    const { data: learner } = await supabase
      .from('learners')
      .select('id')
      .eq('user_id', authResult.userId)
      .maybeSingle()

    if (!learner) {
      res.status(200).json(mockPayload(courseCode))
      return
    }

    res.status(200).json(await buildPayload(supabase, learner.id, courseCode))
  } catch (error: any) {
    console.error('[me/profile] Error:', error)
    // Fail soft into labelled sample data — a profile screen must never be a
    // wall of errors, and mock is honestly tagged so nothing is passed off.
    res.status(200).json(mockPayload(courseCode))
  }
}
