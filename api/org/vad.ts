/**
 * GET /api/org/vad — the HIERARCHY-SCOPED VAD read.
 *
 * FOUNDER RULING, 2026-08-20: "the VAD data should follow the same hierarchy of
 * visibility that all data follows — students < teachers < school leaders <
 * group leaders — as long as the hierarchy is legitimate, the data should be
 * viewable." Until this endpoint, every VAD surface was behind the ssi_admin
 * gate, so a group leader looking at their own programme had no route to any of
 * it. This is that route.
 *
 * Query — exactly one of:
 *   ?groupId=<node id | school id>   the node subtree (group leader, school leader)
 *   ?classId=<class id>              one class (teacher, and any leader above it)
 *   ?learnerId=<learners.id>         one learner (and a student's own)
 *
 * AUTHZ is api/_utils/vadVisibility.ts and nothing else — the same subtree
 * predicate the node home and the write paths enforce, composed with
 * resolveVisibleScope's learner set. No second model, and no RLS policy was
 * touched: this is the server-mediated door the RLS doctrine calls for.
 *
 * WHY BOTH TABLES COME THROUGH ONE DOOR: learner_lego_metrics is readable from
 * the browser today only because the caller is an ssi_admin; a group leader's
 * own JWT is own-row on it like everyone else's, and player_events is own-row
 * for EVERYONE including admins. Rather than loosen a policy (explicitly out of
 * scope) or make the client stitch two doors, both reads happen here with the
 * service role behind the one predicate, and the client shapes the result with
 * the SAME summariseVad it already uses for the admin board.
 *
 * HIDE, DON'T ZERO. The payload carries the FULL roster (`learnerIds`) and only
 * the rows that exist. A learner with no VAD row appears in the roster and in
 * no metric — never as a zero. A scope with no VAD learners returns an empty
 * `metrics` and an empty `prosody`, and the client's summary reports
 * withData === 0 with null aggregates. Nothing here invents a value.
 *
 * AGGREGATES ONLY for prosody — counts and means per learner, via
 * fetchProsodyAggs. No per-event row and no envelope contour crosses the wire,
 * for any caller, exactly as on the admin door.
 *
 * ?aggregate=1 — THE INSIGHTS PATH, WHICH CARRIES NO PUPIL (Tom, 2026-09-16
 * 16:31Z: "nothing in Insights names a pupil, on the glance or behind a tap").
 * A teacher's or leader's Insights page asks for this, and the response holds
 * the SUMMARY ONLY: no `names`, no `metrics`, no roster of learner ids, no
 * per-learner row anywhere — counts, means and denominators, and one uptake
 * row per class. Hiding the rows in the component was not enough: until this
 * flag, one leader's Insights page received 86 pupil names and 537
 * learner-keyed metric rows it never drew. The admin board calls without the
 * flag and still gets its named rows; ONE analysis serves both doors, because
 * the summary here is the very `summariseVad` the client uses.
 *
 * ?courseCode= — the card's own scope. The Insights card reads one course at a
 * time, so the panel below it must too: the classes and the roster narrow to
 * that course, and a panel can no longer report four classes while the card
 * reports one.
 *
 * THE IDENTITY TRAP (CLAUDE.md): learner ids in and out of here are learners.id.
 * learner_lego_metrics.learner_id holds learners.id; player_events.user_id is
 * uuid but ALSO holds learners.id, not the auth uid. Auth uids never appear in
 * the payload.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { resolveVadCaller, resolveVadScope, isDenied } from '../_utils/vadVisibility'
import { fetchProsodyAggs, type ProsodyAgg } from '../_utils/vadProsody'
import { summariseVad, type VadSummary, type MetricRow } from '../../packages/player-vue/src/insight/data/vadUptake'
import { chunk } from '../_utils/schoolScope'
import { applyCors } from '../_utils/cors'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

/** Cap on metric rows shipped in one response. Reported, never silent. */
const MAX_METRIC_ROWS = 60_000

export interface VadMetricRow {
  learner_id: string
  lego_id: string
  course_code: string | null
  mastery_state: string
  mean_latency_ms: number | null
  n_samples: number | null
  last_seen_at: string | null
}

export interface VadScopePayload {
  scope: {
    kind: 'group' | 'class' | 'learner'
    id: string
    label: string
    /** The FULL roster — the honest denominator every aggregate is taken over. */
    learnerIds: string[]
    classes: { classId: string; className: string; courseCode: string | null; learnerIds: string[] }[]
  }
  /** learners.id → display name, for the roster only. */
  names: Record<string, string>
  /** Only rows that EXIST. A learner absent from here has no data, not zero. */
  metrics: VadMetricRow[]
  prosody: Record<string, ProsodyAgg>
  prosodyAvailable: boolean
  /** true when a cap was hit — so the client can say so rather than imply completeness. */
  truncated: boolean
}

/**
 * The Insights-path payload: aggregates only. Every field here is a count, a
 * mean or a label — there is no learner id and no learner name to omit.
 */
export interface VadAggregatePayload {
  aggregate: true
  scope: {
    kind: 'group' | 'class' | 'learner'
    id: string
    label: string
    /** The FULL roster COUNT — the honest denominator, without the roster. */
    total: number
    classes: { classId: string; className: string; courseCode: string | null; total: number }[]
  }
  /** summariseVad's own output with the per-learner rows dropped. */
  summary: VadSummary
  /** One row per class for the uptake table; no learner behind it. */
  classUptake: {
    classId: string
    className: string
    courseCode: string | null
    total: number
    withData: number
    uptake: number | null
    legoSeries: number
    medianLatency: number | null
  }[]
  prosodyAvailable: boolean
  truncated: boolean
}

/** learners.id → display_name, for a roster. */
async function namesForLearnerIds(svc: SupabaseClient, ids: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  await Promise.all(chunk(ids).map(async (batch) => {
    const { data } = await svc.from('learners').select('id, display_name').in('id', batch)
    for (const l of (data ?? []) as { id: string; display_name: string | null }[]) {
      out[l.id] = l.display_name || 'Unnamed learner'
    }
  }))
  return out
}

async function metricsForLearnerIds(
  svc: SupabaseClient,
  ids: string[],
): Promise<{ rows: VadMetricRow[]; truncated: boolean }> {
  const rows: VadMetricRow[] = []
  let truncated = false
  for (const batch of chunk(ids)) {
    if (rows.length >= MAX_METRIC_ROWS) { truncated = true; break }
    const { data, error } = await svc
      .from('learner_lego_metrics')
      .select('learner_id, lego_id, course_code, mastery_state, mean_latency_ms, n_samples, last_seen_at')
      .in('learner_id', batch)
    if (error) throw error
    rows.push(...((data ?? []) as VadMetricRow[]))
  }
  return { rows: rows.slice(0, MAX_METRIC_ROWS), truncated: truncated || rows.length > MAX_METRIC_ROWS }
}

/** The resolved scope, as both this handler and the aggregate builder read it. */
interface ResolvedScope {
  kind: 'group' | 'class' | 'learner'
  id: string
  label: string
  learnerIds: string[]
  classes: { classId: string; className: string; courseCode: string | null; learnerIds: string[] }[]
}

/**
 * Narrow a resolved scope to ONE course — the course the Insights card is
 * reading. Only classes on that course survive, and the roster becomes their
 * members: a learner outside them is outside the question being asked, so they
 * are absent rather than counted as a learner with no data.
 */
function narrowToCourse(scope: ResolvedScope, courseCode: string): ResolvedScope {
  const classes = scope.classes.filter((c) => c.courseCode === courseCode)
  const ids = new Set(classes.flatMap((c) => c.learnerIds))
  return { ...scope, classes, learnerIds: scope.learnerIds.filter((id) => ids.has(id)) }
}

/** The aggregate payload for a scope with nobody in it — a real answer. */
function emptyAggregate(scope: ResolvedScope): VadAggregatePayload {
  return buildAggregate(scope, [], {}, false)
}

/**
 * The Insights payload. The summary is `summariseVad` — the SAME function the
 * admin board's client calls, so there is one analysis behind two doors — with
 * its per-learner rows dropped on the way out, and an empty name map going in
 * because no name was read.
 */
function buildAggregate(
  scope: ResolvedScope,
  metrics: VadMetricRow[],
  prosodyByLearner: Record<string, ProsodyAgg>,
  truncated: boolean,
): VadAggregatePayload {
  const byLearner = new Map<string, MetricRow[]>()
  for (const row of metrics) {
    const list = byLearner.get(row.learner_id) ?? []
    list.push(row as MetricRow)
    byLearner.set(row.learner_id, list)
  }
  const prosody = new Map(Object.entries(prosodyByLearner))
  const noNames = new Map<string, string>()
  const summarise = (ids: string[]): VadSummary =>
    ({ ...summariseVad(ids, noNames, byLearner, prosody, true), learners: [] })

  return {
    aggregate: true,
    scope: {
      kind: scope.kind,
      id: scope.id,
      label: scope.label,
      total: scope.learnerIds.length,
      classes: scope.classes.map((c) => ({
        classId: c.classId,
        className: c.className,
        courseCode: c.courseCode,
        total: c.learnerIds.length,
      })),
    },
    summary: summarise(scope.learnerIds),
    classUptake: scope.classes.map((c) => {
      const s = summarise(c.learnerIds)
      return {
        classId: c.classId,
        className: c.className,
        courseCode: c.courseCode,
        total: s.total,
        withData: s.withData,
        uptake: s.uptake,
        legoSeries: s.legoSeries,
        medianLatency: s.medianLatency,
      }
    }),
    prosodyAvailable: true,
    truncated,
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  // Cross-origin policy and preflight both live in `api/_utils/cors.ts`.
  // Without this the native WebView's preflight for the `Authorization`
  // header goes unanswered and the call fails there while working on the web.
  if (applyCors(req, res, { methods: 'GET' })) return

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }
  if (!supabaseUrl || !supabaseServiceKey) {
    res.status(500).json({ error: 'Server misconfigured' })
    return
  }
  const svc = createClient(supabaseUrl, supabaseServiceKey)

  const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)
  const groupId = str(req.query.groupId)
  const classId = str(req.query.classId)
  const learnerId = str(req.query.learnerId)
  const aggregate = str(req.query.aggregate) === '1' || str(req.query.aggregate) === 'true'
  const courseCode = str(req.query.courseCode)
  if (!groupId && !classId && !learnerId) {
    res.status(400).json({ error: 'One of groupId, classId or learnerId is required' })
    return
  }

  try {
    const caller = await resolveVadCaller(req, res, svc)
    if (!caller) return                                   // 401 already written

    const resolved = await resolveVadScope(svc, caller, { groupId, classId, learnerId })
    if (isDenied(resolved)) {
      res.status(resolved.status).json({ error: resolved.error })
      return
    }

    // THE CARD'S SCOPE, when the caller names it: the Insights card reads one
    // course, so the panel under it reads the same one. A learner who is in no
    // class of that course is outside the scope entirely — not a zero in it.
    const scope = courseCode && resolved.kind !== 'learner'
      ? narrowToCourse(resolved, courseCode)
      : resolved

    // A legitimate scope with an empty roster is a real answer, not an error:
    // an empty class, or a node whose classes carry no students yet.
    if (scope.learnerIds.length === 0) {
      if (aggregate) {
        res.status(200).json(emptyAggregate(scope))
        return
      }
      const payload: VadScopePayload = {
        scope: { kind: scope.kind, id: scope.id, label: scope.label, learnerIds: [], classes: scope.classes },
        names: {}, metrics: [], prosody: {}, prosodyAvailable: true, truncated: false,
      }
      res.status(200).json(payload)
      return
    }

    const [names, metricsResult, prosody] = await Promise.all([
      // The Insights path never renders a name, so it never reads one either.
      aggregate ? Promise.resolve({} as Record<string, string>) : namesForLearnerIds(svc, scope.learnerIds),
      metricsForLearnerIds(svc, scope.learnerIds),
      // The authorized set, never client input — fetchProsodyAggs treats an
      // empty array as "nobody", never as "no filter".
      fetchProsodyAggs(svc, scope.learnerIds),
    ])

    if (aggregate) {
      res.status(200).json(buildAggregate(
        scope,
        metricsResult.rows,
        prosody.byLearner,
        metricsResult.truncated || prosody.truncated,
      ))
      return
    }

    const payload: VadScopePayload = {
      scope: {
        kind: scope.kind,
        id: scope.id,
        label: scope.label,
        learnerIds: scope.learnerIds,
        classes: scope.classes,
      },
      names,
      metrics: metricsResult.rows,
      prosody: prosody.byLearner,
      prosodyAvailable: true,
      truncated: metricsResult.truncated || prosody.truncated,
    }
    res.status(200).json(payload)
  } catch (e: unknown) {
    console.error('[org/vad]', e)
    res.status(500).json({ error: e instanceof Error ? e.message : 'Failed to read VAD scope' })
  }
}
