/**
 * rateCompare — pure math over analytics_class_sessions_scoped rows.
 *
 * The RPC returns raw ordinal-mapped session rows (no pre-aggregation) so
 * the "rate of progress" math lives here, in TypeScript, tested — the same
 * split insight/data/coverage.ts already uses for the admin Coverage board.
 *
 * Rate of progress (LEGOs/week) = legos advanced over a window, divided by
 * the wall-clock span of activity in that window (floored at 1 day so a
 * single-session class doesn't divide by ~0) — identical math to
 * analytics_class_coverage / coverage.ts, just re-derived per caller-scoped
 * class instead of admin-wide.
 */

export interface ScopedSessionRow {
  class_id: string
  course_code: string | null
  start_lego_id: string | null
  end_lego_id: string | null
  start_ord: number | null
  end_ord: number | null
  duration_seconds: number | null
  started_at: string
}

export const K_FLOOR = 5 // matches spec.ts Sovereignty.kFloor default — a band of one/few can't leak

const MS_PER_DAY = 86_400_000
const MS_PER_WEEK = MS_PER_DAY * 7

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

export interface WindowPace {
  pace: number // LEGOs/week over the window
  legosAdvanced: number
  hasData: boolean
  furthestLegoId: string | null // human label for the furthest position reached
}

/** Window-level pace for one class: legos advanced / weeks spanned, floored at 1 day. */
export function windowPaceForClass(
  rows: ScopedSessionRow[],
  classId: string,
  days: number,
  now: Date,
): WindowPace {
  const since = now.getTime() - days * MS_PER_DAY
  const own = rows.filter((r) => r.class_id === classId && new Date(r.started_at).getTime() >= since)
  if (own.length === 0) return { pace: 0, legosAdvanced: 0, hasData: false, furthestLegoId: null }

  let furthestOrd = 0
  let furthestLegoId: string | null = null
  let earliestOrd = Infinity
  let firstAt = Infinity
  let lastAt = -Infinity

  for (const r of own) {
    const endOrd = r.end_ord ?? 0
    const startOrd = r.start_ord ?? 0
    const reachedOrd = Math.max(endOrd, startOrd)
    if (reachedOrd > furthestOrd) {
      furthestOrd = reachedOrd
      furthestLegoId = endOrd >= startOrd ? r.end_lego_id ?? r.start_lego_id : r.start_lego_id ?? r.end_lego_id
    }
    const beginOrd = r.start_ord ?? r.end_ord ?? 0
    earliestOrd = Math.min(earliestOrd, beginOrd)
    const t = new Date(r.started_at).getTime()
    firstAt = Math.min(firstAt, t)
    lastAt = Math.max(lastAt, t)
  }

  const legosAdvanced = Math.max(furthestOrd - (earliestOrd === Infinity ? furthestOrd : earliestOrd), 0)
  const weeks = Math.max((lastAt - firstAt) / MS_PER_WEEK, 1 / 7)
  return { pace: round1(legosAdvanced / weeks), legosAdvanced, hasData: true, furthestLegoId }
}

/** Cumulative furthest ordinal reached by `classId` at or before `cutoffMs`. */
function cumulativeMaxAt(rows: ScopedSessionRow[], classId: string, cutoffMs: number): number {
  let m = 0
  for (const r of rows) {
    if (r.class_id !== classId) continue
    if (new Date(r.started_at).getTime() > cutoffMs) continue
    const ord = Math.max(r.end_ord ?? 0, r.start_ord ?? 0)
    if (ord > m) m = ord
  }
  return m
}

/**
 * Weekly pace trend, oldest -> newest, exactly `weeks` points. Needs one extra
 * week of history as a delta baseline (the caller must fetch >= (weeks+1)*7
 * days), else the oldest point would have nothing to diff against.
 */
export function weeklyTrendForClass(rows: ScopedSessionRow[], classId: string, weeks: number, now: Date): number[] {
  if (!rows.some((r) => r.class_id === classId)) return []
  const nowMs = now.getTime()
  const cum: number[] = []
  for (let i = 0; i <= weeks; i++) {
    const weeksBack = weeks - i
    cum.push(cumulativeMaxAt(rows, classId, nowMs - weeksBack * MS_PER_WEEK))
  }
  const trend: number[] = []
  for (let i = 1; i < cum.length; i++) trend.push(Math.max(cum[i] - cum[i - 1], 0))
  return trend
}

export interface DistributionStats {
  values: number[] // sorted ascending
  min: number
  q1: number
  median: number
  q3: number
  max: number
  percentileOf: (v: number) => number // 0..100, fraction of values <= v
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  if (lo === hi) return sorted[lo]
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}

export function distributionStats(values: number[]): DistributionStats {
  const sorted = [...values].sort((a, b) => a - b)
  const percentileOf = (v: number): number => {
    if (sorted.length === 0) return 0
    const countLE = sorted.filter((x) => x <= v).length
    return Math.round((countLE / sorted.length) * 100)
  }
  return {
    values: sorted,
    min: sorted.length ? sorted[0] : 0,
    q1: quantile(sorted, 0.25),
    median: quantile(sorted, 0.5),
    q3: quantile(sorted, 0.75),
    max: sorted.length ? sorted[sorted.length - 1] : 0,
    percentileOf,
  }
}

export function deltaPct(entityValue: number, averageValue: number): number {
  if (averageValue === 0) return entityValue > 0 ? 100 : 0
  return Math.round(((entityValue - averageValue) / averageValue) * 1000) / 10
}

/** Element-wise mean of same-length trend arrays (ragged arrays padded with nothing — shortest wins). */
export function meanTrend(trends: number[][]): number[] {
  const nonEmpty = trends.filter((t) => t.length > 0)
  if (nonEmpty.length === 0) return []
  const len = Math.min(...nonEmpty.map((t) => t.length))
  const out: number[] = []
  for (let i = 0; i < len; i++) {
    const sum = nonEmpty.reduce((s, t) => s + t[t.length - len + i], 0)
    out.push(round1(sum / nonEmpty.length))
  }
  return out
}

/** "S1234 · L02" from a lego_id like "S1234L02"; '—' when absent/unparseable. */
export function coverageLabel(legoId: string | null): string {
  if (!legoId) return '—'
  const m = /^S(\d+)L(\d+)$/.exec(legoId.trim())
  if (!m) return legoId
  return `S${Number(m[1])} · L${Number(m[2])}`
}
