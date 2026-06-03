/**
 * courseValue resolver — Insight Engine
 *
 * Metric: LTV-proxy = reach × stickiness × retention, per course.
 * Canonical widget: treemap (nodes sized by ltvProxy).
 * Alt widgets:      ranked-bar, stat (handled by boards from the same data).
 *
 * Data source: analytics_course_value() RPC (SECURITY DEFINER, is_god_user-gated,
 * anon-callable via admin client). Migration: 20260602_analytics_course_value.sql.
 *
 * NEVER throws. Returns well-formed zeros when the table is empty or the RPC is blocked.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { TreemapData, DataQuery, Tone } from '../spec'

// ── Rich per-course shape (exported for boards and narrative cards) ──────────

export interface CourseValueRow {
  courseCode: string
  /** Distinct learners active in last 30 days */
  reach: number
  /** Total enrolled learners (denominator for retention) */
  enrolled: number
  /** Median total practice hours per active learner over last 30 days */
  stickinessHours: number
  /** % of the prior-window active cohort who returned (rolling 30d return rate) */
  retentionPct: number
  /** reach × stickinessHours × (retentionPct / 100) — the composite score */
  ltvProxy: number
}

/**
 * Full resolver result.
 *
 * Extends TreemapData so it satisfies the Resolver<'treemap'> contract while
 * also carrying the rich per-course rows for boards that want more detail
 * (e.g. ranked-bar, table, narrative card).
 *
 * nodes[i].value === rows[i].ltvProxy
 * nodes[i].id    === rows[i].courseCode
 */
export interface CourseValueData extends TreemapData {
  rows: CourseValueRow[]
}

// ── RPC row shape returned by analytics_course_value() ──────────────────────

interface RpcRow {
  course_code: string
  reach: number | string
  enrolled: number | string
  stickiness_hours: number | string
  retention_pct: number | string
  ltv_proxy: number | string
}

// ── Tone assignment based on LTV proxy relative to peers ────────────────────

function assignTone(ltvProxy: number, maxLtv: number): Tone {
  if (maxLtv === 0) return 'neutral'
  const ratio = ltvProxy / maxLtv
  if (ratio >= 0.6) return 'good'
  if (ratio >= 0.25) return 'neutral'
  if (ratio > 0) return 'warn'
  return 'neutral' // zero = no data yet, not alarming
}

// ── Zero-result guard ────────────────────────────────────────────────────────

function emptyResult(): CourseValueData {
  return {
    kind: 'treemap',
    nodes: [],
    unit: 'LTV-proxy',
    rows: [],
  }
}

// ── Resolver ─────────────────────────────────────────────────────────────────

const resolver = async (
  client: SupabaseClient,
  _q: DataQuery,
): Promise<CourseValueData> => {
  let rpcRows: RpcRow[] = []

  try {
    const { data, error } = await client.rpc('analytics_course_value')
    if (error) {
      // RPC blocked or function missing — return zeros rather than throwing
      console.warn('[courseValue] analytics_course_value RPC failed:', error.message)
      return emptyResult()
    }
    rpcRows = (data as RpcRow[]) || []
  } catch (e: unknown) {
    console.warn('[courseValue] unexpected error calling analytics_course_value:', e)
    return emptyResult()
  }

  if (!rpcRows.length) return emptyResult()

  // Coerce Postgres numeric strings to JS numbers
  const rows: CourseValueRow[] = rpcRows.map((r) => ({
    courseCode: r.course_code,
    reach: Number(r.reach) || 0,
    enrolled: Number(r.enrolled) || 0,
    stickinessHours: Number(r.stickiness_hours) || 0,
    retentionPct: Number(r.retention_pct) || 0,
    ltvProxy: Number(r.ltv_proxy) || 0,
  }))

  // Sort descending by ltvProxy so treemap + ranked-bar both get natural order
  rows.sort((a, b) => b.ltvProxy - a.ltvProxy)

  const maxLtv = rows[0]?.ltvProxy ?? 0

  const nodes: TreemapData['nodes'] = rows.map((r) => ({
    id: r.courseCode,
    name: r.courseCode,
    value: r.ltvProxy,
    tone: assignTone(r.ltvProxy, maxLtv),
    // muted = zero activity (no data yet); the treemap can render these as ghost tiles
    muted: r.reach === 0,
  }))

  return {
    kind: 'treemap',
    nodes,
    unit: 'LTV-proxy',
    rows,
  }
}

export default resolver
