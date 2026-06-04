// ============================================================================
// INSIGHT ENGINE — retention metric resolver
//
// Metric:  'retention'
// Kind:    'time-series'   (canonical) | altWidgets: 'cohort-grid', 'stat'
// Frames:  'group', 'world'
//
// Data sources (read-only, admin-only RPCs, SECURITY DEFINER + is_god_user):
//   analytics_retention_cohorts(p_weeks)     — existing RPC; weekly cohort heatmap
//   analytics_retention_days_active(p_weeks) — NEW migration (unapplied):
//     supabase/migrations/20260602_analytics_retention_days_active.sql
//     Needed because learner_speaking_opportunities has own-row RLS that blocks
//     admin direct SELECT. The new function aggregates avg_days_active + 7d/30d
//     return-rates into a weekly time-series.
//
// Resolver contract (from registry.ts):
//   type Resolver<K> = (client: SupabaseClient, q: DataQuery) => Promise<DataForKind<K>>
//   default export must be Resolver<'time-series'>
//   NEVER throws; ALWAYS returns a well-formed zero/empty shape on no-data or error.
// ============================================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import type { DataQuery, TimeSeriesData, CohortGridData } from '../spec'

// ---- Raw RPC row types (mirror the SQL RETURNS TABLE columns exactly) ------

interface RetentionCohortsRow {
  cohort_week:  string   // ISO date string e.g. "2026-01-06"
  cohort_size:  number
  w1_pct:       number
  w2_pct:       number
  w4_pct:       number
  w8_pct:       number
}

interface RetentionDaysActiveRow {
  week_start:      string   // ISO date string e.g. "2026-01-06"
  avg_days_active: number
  w7_return_rate:  number
  w30_return_rate: number
}

// ---- Public result type (exported so boards can import for type-checking) ---

/**
 * The full resolved payload for the 'retention' metric.
 *
 * primary  — TimeSeriesData: three series over the requested window
 *              · "Days active / week" (avg distinct days per learner)
 *              · "7-day return rate %"
 *              · "30-day return rate %"
 * cohorts  — CohortGridData: weekly cohort heatmap (W1/W2/W4/W8)
 *              Suitable for the altWidget 'cohort-grid'.
 */
export interface RetentionResolverResult {
  primary: TimeSeriesData
  cohorts: CohortGridData
}

// ---- Helpers ----------------------------------------------------------------

/** Format an ISO date string to a short human label ("06 Jan"). */
function fmtWeek(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
  } catch {
    return iso
  }
}

/** Derive p_weeks from the DataQuery window string, defaulting to 12. */
function parseWeeks(window?: string): number {
  if (!window) return 12
  const m = window.match(/^(\d+)w$/)
  if (m) return Math.max(1, Math.min(52, parseInt(m[1], 10)))
  // Accept numeric strings too ("12" -> 12)
  const n = parseInt(window, 10)
  if (!isNaN(n) && n > 0) return Math.min(52, n)
  return 12
}

// ---- Zero shapes (returned when data is absent or an RPC errors) ------------

function emptyTimeSeries(): TimeSeriesData {
  return {
    kind: 'time-series',
    x: [],
    series: [
      { name: 'Days active / week', points: [], tone: 'neutral' },
      { name: '7-day return %',     points: [], tone: 'good' },
      { name: '30-day return %',    points: [], tone: 'neutral' },
    ],
    yLabel: 'Rate / days',
  }
}

function emptyCohortGrid(): CohortGridData {
  return {
    kind: 'cohort-grid',
    xLabels: ['W1', 'W2', 'W4', 'W8'],
    yLabels: [],
    cells: [],
    min: 0,
    max: 100,
    unit: '%',
  }
}

// ---- Main resolver ----------------------------------------------------------

/**
 * Resolver<'time-series'> for the 'retention' metric.
 *
 * Returns RetentionResolverResult but typed as TimeSeriesData (the canonical
 * widget kind). The extra `cohorts` field is preserved on the object so an
 * altWidget='cohort-grid' board can cast and use it directly.
 *
 * On any error (RPC failure, empty table, cast failure) returns well-formed
 * zero shapes — the widget must stay renderable with no data.
 */
const resolver = async (
  client: SupabaseClient,
  q: DataQuery,
): Promise<TimeSeriesData> => {
  const weeks = parseWeeks(q.window)

  // ---- 1. Fetch days-active time-series (new migration RPC) ----------------
  let daysActiveRows: RetentionDaysActiveRow[] = []
  try {
    const { data: daData, error: daErr } = await client.rpc(
      'analytics_retention_days_active',
      { p_weeks: weeks },
    )
    if (daErr) {
      console.error('[retention] analytics_retention_days_active error', daErr)
    } else {
      daysActiveRows = (daData as RetentionDaysActiveRow[]) || []
    }
  } catch (e) {
    console.error('[retention] analytics_retention_days_active threw', e)
  }

  // ---- 2. Fetch cohort heatmap (existing RPC) -------------------------------
  let cohortRows: RetentionCohortsRow[] = []
  try {
    const { data: cohData, error: cohErr } = await client.rpc(
      'analytics_retention_cohorts',
      { p_weeks: weeks },
    )
    if (cohErr) {
      console.error('[retention] analytics_retention_cohorts error', cohErr)
    } else {
      cohortRows = (cohData as RetentionCohortsRow[]) || []
    }
  } catch (e) {
    console.error('[retention] analytics_retention_cohorts threw', e)
  }

  // ---- 3. Build TimeSeriesData from days-active rows -----------------------
  if (daysActiveRows.length === 0) {
    // Still attach cohorts so altWidget board can access them
    const result: RetentionResolverResult = {
      primary: emptyTimeSeries(),
      cohorts: buildCohortGrid(cohortRows),
    }
    return result as unknown as TimeSeriesData
  }

  const x = daysActiveRows.map(r => fmtWeek(r.week_start))
  const daysPoints       = daysActiveRows.map(r => Number(r.avg_days_active) || 0)
  const w7Points         = daysActiveRows.map(r => Number(r.w7_return_rate)  || 0)
  const w30Points        = daysActiveRows.map(r => Number(r.w30_return_rate) || 0)

  const primary: TimeSeriesData = {
    kind: 'time-series',
    x,
    series: [
      { name: 'Days active / week', points: daysPoints, tone: 'neutral' },
      { name: '7-day return %',     points: w7Points,   tone: 'good'    },
      { name: '30-day return %',    points: w30Points,  tone: 'neutral' },
    ],
    yLabel: 'Rate / days',
  }

  // ---- 4. Attach cohort grid as extra field for altWidget use --------------
  const result: RetentionResolverResult = {
    primary,
    cohorts: buildCohortGrid(cohortRows),
  }

  // Cast: the registry expects DataForKind<'time-series'> === TimeSeriesData.
  // The extra `cohorts` field is inert to the time-series widget; a board that
  // wants the grid casts to RetentionResolverResult before accessing it.
  return result as unknown as TimeSeriesData
}

// ---- Cohort grid builder (extracted so it's reachable for altWidget) --------

function buildCohortGrid(cohortRows: RetentionCohortsRow[]): CohortGridData {
  if (cohortRows.length === 0) return emptyCohortGrid()

  const xLabels = ['W1', 'W2', 'W4', 'W8']
  const yLabels = cohortRows.map(r => fmtWeek(r.cohort_week))

  const cells = cohortRows.flatMap(r => [
    { x: 'W1', y: fmtWeek(r.cohort_week), value: Number(r.w1_pct) || 0 },
    { x: 'W2', y: fmtWeek(r.cohort_week), value: Number(r.w2_pct) || 0 },
    { x: 'W4', y: fmtWeek(r.cohort_week), value: Number(r.w4_pct) || 0 },
    { x: 'W8', y: fmtWeek(r.cohort_week), value: Number(r.w8_pct) || 0 },
  ])

  const allValues = cells.map(c => c.value)
  const min = allValues.length ? Math.min(...allValues) : 0
  const max = allValues.length ? Math.max(...allValues) : 100

  return { kind: 'cohort-grid', xLabels, yLabels, cells, min, max, unit: '%' }
}

/** Exported helper so an altWidget='cohort-grid' board can call this directly. */
export { buildCohortGrid }

export default resolver
