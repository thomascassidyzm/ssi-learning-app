// ============================================================================
// vadScope — the HIERARCHY-SCOPED VAD read for the node surfaces.
//
// FOUNDER RULING, 2026-08-20: VAD follows the ordinary visibility hierarchy —
// students < teachers < school leaders < group leaders. This module is what a
// group leader's browser calls; vadUptake.ts stays the admin board's whole-
// forest read.
//
// WHY A SERVER ENDPOINT AND NOT THE DIRECT READ vadUptake USES: the direct
// browser read of learner_lego_metrics works on the admin board only because
// the caller is an ssi_admin. A group leader's own JWT is own-row on it like
// everyone else's, and player_events is own-row for EVERYONE including admins.
// Loosening either policy was explicitly out of scope, and is the wrong answer
// anyway (the RLS doctrine: own-row in the policy, hierarchy authz in an
// endpoint with a test). So both reads come through GET /api/org/vad behind the
// one server-side predicate.
//
// THE SHAPING IS NOT DUPLICATED. This module only ADAPTS the wire payload into
// the exact inputs summariseVad already takes; every aggregate, denominator and
// bin still comes from vadUptake.ts. One analysis, two doors.
//
// HIDE, DON'T ZERO travels with the payload: the endpoint sends the FULL roster
// (`learnerIds`) and only the metric rows that exist, so summariseVad's
// withData/total gap survives the wire intact. A learner with no rows arrives
// on the roster and in no map — absent, never zero.
//
// THE IDENTITY TRAP (CLAUDE.md): every id crossing this wire is learners.id.
// learner_lego_metrics.learner_id holds it, and player_events.user_id holds it
// too despite the name. No auth uid appears in the payload.
// ============================================================================

import type { MetricRow, ProsodyAgg, MasteryState } from './vadUptake'

/** One class under the requested scope. */
export interface VadScopeClass {
  classId: string
  className: string
  courseCode: string | null
  learnerIds: string[]
}

export interface VadScopeInfo {
  kind: 'group' | 'class' | 'learner'
  id: string
  label: string
  /** The FULL roster — the honest denominator. */
  learnerIds: string[]
  classes: VadScopeClass[]
}

/** What the panel needs, in the shape summariseVad already consumes. */
export interface VadScopePayload {
  scope: VadScopeInfo
  names: Map<string, string>
  metricsByLearner: Map<string, MetricRow[]>
  prosodyByLearner: Map<string, ProsodyAgg>
  /** false when the read failed — the panel states the gap rather than showing dashes. */
  prosodyAvailable: boolean
  /** true when the server hit a row cap; surfaced so completeness is never implied. */
  truncated: boolean
}

interface WireMetricRow {
  learner_id: string
  lego_id: string
  course_code: string | null
  mastery_state: string
  mean_latency_ms: number | null
  n_samples: number | null
  last_seen_at: string | null
}

interface WirePayload {
  scope: VadScopeInfo
  names: Record<string, string>
  metrics: WireMetricRow[]
  prosody: Record<string, ProsodyAgg>
  prosodyAvailable: boolean
  truncated: boolean
}

export type VadTarget =
  | { groupId: string }
  | { classId: string }
  | { learnerId: string }

function queryFor(target: VadTarget): string {
  if ('groupId' in target) return `groupId=${encodeURIComponent(target.groupId)}`
  if ('classId' in target) return `classId=${encodeURIComponent(target.classId)}`
  return `learnerId=${encodeURIComponent(target.learnerId)}`
}

/**
 * Fetch one scope's VAD read.
 *
 * A 403 is a REAL answer, not a crash: it means the caller sits outside this
 * scope, and the panel says so plainly. It is deliberately distinguished from a
 * network failure, which is a gap.
 */
export async function fetchVadScope(
  target: VadTarget,
  authToken?: string | null,
): Promise<VadScopePayload> {
  const res = await fetch(`/api/org/vad?${queryFor(target)}`, {
    headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
  })
  if (!res.ok) {
    let message = `VAD read failed (${res.status})`
    if (res.status === 403) message = 'You do not have access to this scope.'
    else if (res.status === 404) message = 'That scope no longer exists.'
    else {
      try {
        const body = await res.json()
        if (body?.error) message = String(body.error)
      } catch { /* keep the status-derived message */ }
    }
    throw new Error(message)
  }

  const body = (await res.json()) as WirePayload
  return adaptVadScopePayload(body)
}

/**
 * Pure adapter, exported so it can be tested with literal wire rows — the same
 * separation vadUptake.ts keeps between its shaping and its fetch.
 */
export function adaptVadScopePayload(body: WirePayload): VadScopePayload {
  const metricsByLearner = new Map<string, MetricRow[]>()
  for (const row of body.metrics ?? []) {
    const list = metricsByLearner.get(row.learner_id) ?? []
    list.push({
      learner_id: row.learner_id,
      lego_id: row.lego_id,
      course_code: row.course_code,
      mastery_state: row.mastery_state as MasteryState,
      mean_latency_ms: row.mean_latency_ms,
      n_samples: row.n_samples,
      last_seen_at: row.last_seen_at,
    })
    metricsByLearner.set(row.learner_id, list)
  }

  return {
    scope: {
      kind: body.scope?.kind ?? 'group',
      id: body.scope?.id ?? '',
      label: body.scope?.label ?? '—',
      learnerIds: body.scope?.learnerIds ?? [],
      classes: body.scope?.classes ?? [],
    },
    names: new Map(Object.entries(body.names ?? {})),
    metricsByLearner,
    prosodyByLearner: new Map(Object.entries(body.prosody ?? {})),
    prosodyAvailable: body.prosodyAvailable !== false,
    truncated: body.truncated === true,
  }
}
