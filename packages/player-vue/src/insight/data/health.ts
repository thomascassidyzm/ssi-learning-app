// ============================================================================
// METRIC: health — Platform health resolver
//
// Primary stat : overall audio_failed rate (%) — the most actionable headline.
// Donut variant: build-sha spread across active learners (is my fix live?).
//
// Full data returned by analytics_health() RPC is exported as HealthPayload
// so boards can wire up the altWidget time-series path by reading
// failureTrend, or build a richer table from buildShaSpread / deviceSpread.
//
// Source: analytics_health(p_days) RPC (SECURITY DEFINER, is_god_user-gated).
// Migration file: supabase/migrations/20260602_analytics_health_rpc.sql
// (UNAPPLIED — author it via the Supabase SQL editor or migration runner).
//
// Never throws. Returns well-formed zeros/empties on 0-row tables or RPC error.
// ============================================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import type { StatData, TimeSeriesData, Tone } from '../spec'
import type { DataQuery } from '../spec'

// ── Raw RPC row shapes ────────────────────────────────────────────────────

interface DayRow {
  day: string       // 'YYYY-MM-DD'
  plays: number
  failures: number
  fail_rate: number // 0-1
}

interface DeviceRow {
  device: string
  plays: number
  failures: number
  fail_rate: number
}

interface VersionRow {
  version: string
  plays: number
  failures: number
  fail_rate: number
}

interface ShaRow {
  sha: string
  learners: number
}

interface DeviceLearnerRow {
  device: string
  learners: number
}

interface HealthRpcResult {
  failure_trend:      DayRow[]
  failure_by_device:  DeviceRow[]
  failure_by_version: VersionRow[]
  cache_hit_rate:     number
  build_sha_spread:   ShaRow[]
  device_spread:      DeviceLearnerRow[]
  total_plays:        number
  total_failures:     number
  overall_fail_rate:  number
}

// ── Exported full payload (for boards / altWidget wiring) ─────────────────

export interface HealthFailureTrendPoint {
  day: string
  plays: number
  failures: number
  /** 0–100 percentage */
  failRatePct: number
}

export interface HealthVersionStat {
  version: string
  plays: number
  failures: number
  failRatePct: number
}

export interface HealthDeviceStat {
  device: string
  /** active learner count in the window */
  learners: number
  failRatePct: number
}

export interface HealthPayload {
  /** StatData shape (the spec-registered widget kind for this metric) */
  stat: StatData

  /** Full day-by-day series for altWidget time-series boards */
  failureTrend: HealthFailureTrendPoint[]

  /** Per-build-sha failure breakdown (triage: is my fix live + clean?) */
  buildShaSpread: HealthVersionStat[]

  /** Cache hit rate 0-1 */
  cacheHitRate: number

  /** Device spread: learner count per device_type */
  deviceSpread: HealthDeviceStat[]

  /** Raw play / failure totals in the window */
  totalPlays: number
  totalFailures: number
  /** 0-100 percentage */
  overallFailRatePct: number
}

// ── Helpers ───────────────────────────────────────────────────────────────

function failTone(rate: number): Tone {
  // rate is 0-1 fraction
  if (rate >= 0.05) return 'alarm'
  if (rate >= 0.02) return 'warn'
  return 'good'
}

function windowDays(q: DataQuery): number {
  const w = q.window ?? '30d'
  const m = w.match(/^(\d+)d$/)
  return m ? parseInt(m[1], 10) : 30
}

// ── EMPTY SAFE DEFAULTS ───────────────────────────────────────────────────

const EMPTY_STAT: StatData = {
  kind: 'stat',
  label: 'Audio failure rate',
  value: 0,
  unit: '%',
  delta: 0,
  deltaWindow: '30d',
  deltaTone: 'neutral',
  donut: [],
}

const EMPTY_PAYLOAD: HealthPayload = {
  stat: EMPTY_STAT,
  failureTrend: [],
  buildShaSpread: [],
  cacheHitRate: 0,
  deviceSpread: [],
  totalPlays: 0,
  totalFailures: 0,
  overallFailRatePct: 0,
}

// ── Resolver ─────────────────────────────────────────────────────────────
//
// The registry binds this as Resolver<'stat'>, so the default export MUST
// return StatData. The richer HealthPayload is available to boards that
// import this module directly (e.g. a HealthBoard that wires the altWidget).

const resolve = async (
  client: SupabaseClient,
  q: DataQuery,
): Promise<StatData> => {
  const days = windowDays(q)

  let raw: HealthRpcResult | null = null
  try {
    const { data, error } = await client.rpc('analytics_health', { p_days: days })
    if (error) {
      console.error('[health resolver] RPC error', error)
    } else {
      raw = data as HealthRpcResult
    }
  } catch (e) {
    console.error('[health resolver] unexpected error', e)
  }

  if (!raw) return EMPTY_STAT

  const overallPct = Math.round((raw.overall_fail_rate ?? 0) * 10000) / 100 // 4dp → 2dp %

  // ── delta: compare last half of window vs first half ──────────────────
  // Split the trend at midpoint and compare average fail rates.
  const trend: DayRow[] = Array.isArray(raw.failure_trend) ? raw.failure_trend : []
  let deltaPct = 0
  if (trend.length >= 2) {
    const mid = Math.floor(trend.length / 2)
    const first = trend.slice(0, mid)
    const second = trend.slice(mid)
    const avgRate = (rows: DayRow[]) => {
      const totalPlays = rows.reduce((s, r) => s + (r.plays ?? 0), 0)
      const totalFail  = rows.reduce((s, r) => s + (r.failures ?? 0), 0)
      return totalPlays > 0 ? totalFail / totalPlays : 0
    }
    deltaPct = Math.round((avgRate(second) - avgRate(first)) * 10000) / 100
  }

  // ── donut: build-sha spread (learner count per sha) ───────────────────
  const shaRows: ShaRow[] = Array.isArray(raw.build_sha_spread) ? raw.build_sha_spread : []
  const totalLearners = shaRows.reduce((s, r) => s + (r.learners ?? 0), 0)
  const donut: StatData['donut'] = shaRows.map(r => {
    // Find the matching version row so we can show tone by fail rate
    const versionRow = (raw!.failure_by_version ?? []).find(v => v.version === r.sha)
    const shaFailRate = versionRow?.fail_rate ?? 0
    return {
      name: r.sha.length > 8 ? r.sha.slice(0, 8) : r.sha,
      value: totalLearners > 0 ? Math.round((r.learners / totalLearners) * 1000) / 10 : 0,
      tone: failTone(shaFailRate),
    }
  })

  const overallRate = raw.overall_fail_rate ?? 0

  return {
    kind: 'stat',
    label: 'Audio failure rate',
    value: overallPct,
    unit: '%',
    delta: deltaPct,
    deltaWindow: `${days}d`,
    deltaTone: deltaPct > 0 ? 'alarm' : deltaPct < 0 ? 'good' : 'neutral',
    donut: donut.length > 0 ? donut : undefined,
  }
}

export default resolve

// ── Re-exported helper so a HealthBoard can build the full payload ────────
//
// Usage in a board:
//   import resolveHealth, { resolveHealthFull } from '../data/health'
//   const payload = await resolveHealthFull(client, q)
//   // use payload.failureTrend for a time-series widget

export async function resolveHealthFull(
  client: SupabaseClient,
  q: DataQuery,
): Promise<HealthPayload> {
  const days = windowDays(q)

  let raw: HealthRpcResult | null = null
  try {
    const { data, error } = await client.rpc('analytics_health', { p_days: days })
    if (error) {
      console.error('[health resolver] RPC error (full)', error)
    } else {
      raw = data as HealthRpcResult
    }
  } catch (e) {
    console.error('[health resolver] unexpected error (full)', e)
  }

  if (!raw) return EMPTY_PAYLOAD

  const overallPct = Math.round((raw.overall_fail_rate ?? 0) * 10000) / 100

  const failureTrend: HealthFailureTrendPoint[] = (raw.failure_trend ?? []).map(r => ({
    day: r.day,
    plays: r.plays ?? 0,
    failures: r.failures ?? 0,
    failRatePct: Math.round((r.fail_rate ?? 0) * 10000) / 100,
  }))

  const buildShaSpread: HealthVersionStat[] = (raw.failure_by_version ?? []).map(r => ({
    version: r.version,
    plays: r.plays ?? 0,
    failures: r.failures ?? 0,
    failRatePct: Math.round((r.fail_rate ?? 0) * 10000) / 100,
  }))

  const deviceSpreadMap: Record<string, number> = {}
  for (const r of raw.device_spread ?? []) {
    deviceSpreadMap[r.device] = r.learners ?? 0
  }
  const deviceSpread: HealthDeviceStat[] = (raw.failure_by_device ?? []).map(r => ({
    device: r.device,
    learners: deviceSpreadMap[r.device] ?? 0,
    failRatePct: Math.round((r.fail_rate ?? 0) * 10000) / 100,
  }))

  // Build stat for the full payload too
  const trend = failureTrend
  let deltaPct = 0
  if (trend.length >= 2) {
    const mid = Math.floor(trend.length / 2)
    const first = trend.slice(0, mid)
    const second = trend.slice(mid)
    const avgPct = (rows: HealthFailureTrendPoint[]) => {
      const totalPlays = rows.reduce((s, r) => s + r.plays, 0)
      const totalFail  = rows.reduce((s, r) => s + r.failures, 0)
      return totalPlays > 0 ? (totalFail / totalPlays) * 100 : 0
    }
    deltaPct = Math.round((avgPct(second) - avgPct(first)) * 100) / 100
  }

  const shaRows: ShaRow[] = Array.isArray(raw.build_sha_spread) ? raw.build_sha_spread : []
  const totalLearners = shaRows.reduce((s, r) => s + (r.learners ?? 0), 0)
  const donut: StatData['donut'] = shaRows.map(r => {
    const versionRow = (raw!.failure_by_version ?? []).find(v => v.version === r.sha)
    const shaFailRate = versionRow?.fail_rate ?? 0
    return {
      name: r.sha.length > 8 ? r.sha.slice(0, 8) : r.sha,
      value: totalLearners > 0 ? Math.round((r.learners / totalLearners) * 1000) / 10 : 0,
      tone: failTone(shaFailRate),
    }
  })

  const stat: StatData = {
    kind: 'stat',
    label: 'Audio failure rate',
    value: overallPct,
    unit: '%',
    delta: deltaPct,
    deltaWindow: `${days}d`,
    deltaTone: deltaPct > 0 ? 'alarm' : deltaPct < 0 ? 'good' : 'neutral',
    donut: donut.length > 0 ? donut : undefined,
  }

  return {
    stat,
    failureTrend,
    buildShaSpread,
    cacheHitRate: raw.cache_hit_rate ?? 0,
    deviceSpread,
    totalPlays: raw.total_plays ?? 0,
    totalFailures: raw.total_failures ?? 0,
    overallFailRatePct: overallPct,
  }
}

// ── altWidget helper: resolveHealthTimeSeries ─────────────────────────────
//
// When a board or spec picks altWidget 'time-series', call this instead.
// It returns the three failure-rate series (overall / mobile / desktop)
// shaped as TimeSeriesData.

export async function resolveHealthTimeSeries(
  client: SupabaseClient,
  q: DataQuery,
): Promise<TimeSeriesData> {
  const payload = await resolveHealthFull(client, q)

  const empty: TimeSeriesData = {
    kind: 'time-series',
    x: [],
    series: [],
    yLabel: 'Failure rate %',
  }

  if (payload.failureTrend.length === 0) return empty

  const x = payload.failureTrend.map(p => p.day)

  // Overall series from the trend
  const overallPoints = payload.failureTrend.map(p => p.failRatePct)
  const overallTone: Tone = failTone((payload.overallFailRatePct ?? 0) / 100)

  return {
    kind: 'time-series',
    x,
    series: [
      {
        name: 'Failure rate %',
        points: overallPoints,
        tone: overallTone,
      },
    ],
    yLabel: 'Failure rate %',
  }
}
