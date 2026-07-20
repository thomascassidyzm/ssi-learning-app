/**
 * rateCompare — pure math over analytics_class_sessions_scoped rows.
 *
 * The RPC returns raw ordinal-mapped session rows (no pre-aggregation) so
 * the "rate of progress" math lives here, in TypeScript, tested — the same
 * split insight/data/coverage.ts already uses for the admin Coverage board.
 *
 * Rate of progress (LEGOs/week) = legos advanced over a window, divided by
 * the span from FIRST activity in the window to NOW (floored at 1 day so a
 * single-session class doesn't divide by ~0). Anchoring the denominator to
 * now — not to the last session — keeps the headline honest for entities
 * that have gone quiet: a burst 9 weeks ago decays instead of headlining a
 * hero "per week" rate while the weekly trend chart truthfully reads ~0.
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
  furthestOrd: number // raw ordinal behind furthestLegoId — comparable across classes on the SAME course
}

/** Window-level pace for one class: legos advanced / weeks from first activity to NOW, floored at 1 day. */
export function windowPaceForClass(
  rows: ScopedSessionRow[],
  classId: string,
  days: number,
  now: Date,
): WindowPace {
  const since = now.getTime() - days * MS_PER_DAY
  const own = rows.filter((r) => r.class_id === classId && new Date(r.started_at).getTime() >= since)
  if (own.length === 0) return { pace: 0, legosAdvanced: 0, hasData: false, furthestLegoId: null, furthestOrd: 0 }

  let furthestOrd = 0
  let furthestLegoId: string | null = null
  let earliestOrd = Infinity
  let firstAt = Infinity

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
  }

  const legosAdvanced = Math.max(furthestOrd - (earliestOrd === Infinity ? furthestOrd : earliestOrd), 0)
  // Anchored to NOW: idle time since the last session counts against the rate.
  const weeks = Math.max((now.getTime() - firstAt) / MS_PER_WEEK, 1 / 7)
  return { pace: round1(legosAdvanced / weeks), legosAdvanced, hasData: true, furthestLegoId, furthestOrd }
}

/**
 * Aggregate pace for an ENTITY that spans multiple classes (a school = its
 * classes, a group = its subtree's classes) — mean of each member class's
 * own window pace, over members that have data in the window. For a
 * single-class set this is identical to windowPaceForClass (mean of one).
 * Same primitive doubles as a COHORT member's value when the cohort being
 * compared against is itself made of schools or groups, not bare classes.
 */
export function aggregateWindowPace(
  rows: ScopedSessionRow[],
  classIds: string[],
  days: number,
  now: Date,
): WindowPace {
  const active = classIds.map((id) => windowPaceForClass(rows, id, days, now)).filter((w) => w.hasData)
  if (active.length === 0) return { pace: 0, legosAdvanced: 0, hasData: false, furthestLegoId: null, furthestOrd: 0 }
  const pace = round1(active.reduce((s, w) => s + w.pace, 0) / active.length)
  const legosAdvanced = Math.round(active.reduce((s, w) => s + w.legosAdvanced, 0) / active.length)
  const furthest = active.reduce((best, w) => (w.furthestOrd > best.furthestOrd ? w : best), active[0])
  return { pace, legosAdvanced, hasData: true, furthestLegoId: furthest.furthestLegoId, furthestOrd: furthest.furthestOrd }
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
 * LEGO-progress pace trend, oldest -> newest, exactly `periods` points at
 * `periodDays` granularity. Needs one extra period of history as a delta
 * baseline (the caller must fetch >= (periods+1)*periodDays days), else the
 * oldest point would have nothing to diff against. Generalizes the old
 * weekly-only trend to any window's granularity (THE LENS windows contract:
 * daily/7pt, weekly/4 or 12pt, monthly/12pt).
 */
export function periodTrendForClass(
  rows: ScopedSessionRow[],
  classId: string,
  periods: number,
  periodDays: number,
  now: Date,
): number[] {
  if (!rows.some((r) => r.class_id === classId)) return []
  const nowMs = now.getTime()
  const periodMs = periodDays * MS_PER_DAY
  const cum: number[] = []
  for (let i = 0; i <= periods; i++) {
    const periodsBack = periods - i
    cum.push(cumulativeMaxAt(rows, classId, nowMs - periodsBack * periodMs))
  }
  const trend: number[] = []
  for (let i = 1; i < cum.length; i++) trend.push(Math.max(cum[i] - cum[i - 1], 0))
  return trend
}

/** Weekly pace trend — the periodDays=7 case of periodTrendForClass. Kept as its own export: every existing caller (api/school/rate-compare.ts) passes `weeks` and expects exactly this shape. */
export function weeklyTrendForClass(rows: ScopedSessionRow[], classId: string, weeks: number, now: Date): number[] {
  return periodTrendForClass(rows, classId, weeks, 7, now)
}

/** Same generalization as aggregateWindowPace, for the trend line — mean-trend across member classes, at any period granularity. */
export function aggregatePeriodTrend(
  rows: ScopedSessionRow[],
  classIds: string[],
  periods: number,
  periodDays: number,
  now: Date,
): number[] {
  return meanTrend(classIds.map((id) => periodTrendForClass(rows, id, periods, periodDays, now)))
}

/** Weekly case of aggregatePeriodTrend — kept as its own export for backward compatibility (api/school/rate-compare.ts). */
export function aggregateWeeklyTrend(rows: ScopedSessionRow[], classIds: string[], weeks: number, now: Date): number[] {
  return aggregatePeriodTrend(rows, classIds, weeks, 7, now)
}

// ─────────────────────────────────────────────────────────────────────────
// MEASURES (THE LENS: rate | minutes_per_class | hours_total | active_classes)
//
// All computed from the SAME ScopedSessionRow[] the rate math already reads
// — no new fetch, no new RPC. `rate` keeps its existing pace primitives
// above; these three add the rest of the contract's measure set. Every
// measure follows the SAME grammar as rate: an ENTITY-level value/trend, and
// each COHORT MEMBER gets its own value/trend computed by the identical
// function over that member's own classIds — so "average" is always "mean of
// members' own entity-level metric," whether the metric itself is a mean
// (minutes_per_class) or a sum (hours_total, active_classes).
// ─────────────────────────────────────────────────────────────────────────

function periodBoundaries(periods: number, periodDays: number, now: Date): number[] {
  const periodMs = periodDays * MS_PER_DAY
  const nowMs = now.getTime()
  const bounds: number[] = []
  for (let i = 0; i <= periods; i++) bounds.push(nowMs - (periods - i) * periodMs)
  return bounds
}

export interface WindowMinutes {
  minutesPerWeek: number
  hasData: boolean
}

/** Mean weekly practice minutes for ONE class, NOW-anchored (idle time decays it) — the minutes analog of windowPaceForClass. */
export function windowMinutesForClass(rows: ScopedSessionRow[], classId: string, days: number, now: Date): WindowMinutes {
  const since = now.getTime() - days * MS_PER_DAY
  const own = rows.filter((r) => r.class_id === classId && new Date(r.started_at).getTime() >= since)
  if (own.length === 0) return { minutesPerWeek: 0, hasData: false }
  let totalSeconds = 0
  let firstAt = Infinity
  for (const r of own) {
    totalSeconds += r.duration_seconds ?? 0
    firstAt = Math.min(firstAt, new Date(r.started_at).getTime())
  }
  const weeks = Math.max((now.getTime() - firstAt) / MS_PER_WEEK, 1 / 7)
  return { minutesPerWeek: round1(totalSeconds / 60 / weeks), hasData: true }
}

/** Mean weekly practice minutes per active member class — the minutes analog of aggregateWindowPace. */
export function aggregateWindowMinutes(rows: ScopedSessionRow[], classIds: string[], days: number, now: Date): WindowMinutes {
  const active = classIds.map((id) => windowMinutesForClass(rows, id, days, now)).filter((w) => w.hasData)
  if (active.length === 0) return { minutesPerWeek: 0, hasData: false }
  return { minutesPerWeek: round1(active.reduce((s, w) => s + w.minutesPerWeek, 0) / active.length), hasData: true }
}

/** Per-class minutes trend, bucketed (not cumulative — minutes aren't monotonic like LEGO position). */
export function minutesTrendForClass(rows: ScopedSessionRow[], classId: string, periods: number, periodDays: number, now: Date): number[] {
  if (!rows.some((r) => r.class_id === classId)) return []
  const bounds = periodBoundaries(periods, periodDays, now)
  const trend: number[] = []
  for (let i = 1; i < bounds.length; i++) {
    let secs = 0
    for (const r of rows) {
      if (r.class_id !== classId) continue
      const t = new Date(r.started_at).getTime()
      if (t > bounds[i - 1] && t <= bounds[i]) secs += r.duration_seconds ?? 0
    }
    trend.push(round1(secs / 60))
  }
  return trend
}

/** Mean-trend across member classes' own minutes trend — the minutes analog of aggregatePeriodTrend. */
export function aggregateMinutesTrend(rows: ScopedSessionRow[], classIds: string[], periods: number, periodDays: number, now: Date): number[] {
  return meanTrend(classIds.map((id) => minutesTrendForClass(rows, id, periods, periodDays, now)))
}

export interface WindowHours {
  hours: number
  hasData: boolean
}

/** Total practice hours for an ENTITY (a set of classIds) inside the window — a straight sum, no NOW-anchored decay (it's a total, not a rate). */
export function windowHoursForEntity(rows: ScopedSessionRow[], classIds: string[], days: number, now: Date): WindowHours {
  const since = now.getTime() - days * MS_PER_DAY
  const idSet = new Set(classIds)
  let totalSeconds = 0
  let any = false
  for (const r of rows) {
    if (!idSet.has(r.class_id)) continue
    if (new Date(r.started_at).getTime() < since) continue
    totalSeconds += r.duration_seconds ?? 0
    any = true
  }
  return { hours: round1(totalSeconds / 3600), hasData: any }
}

/** Bucketed total-hours trend for an ENTITY (a set of classIds) — sum per period, not per-class-then-averaged. */
export function hoursTrendForEntity(rows: ScopedSessionRow[], classIds: string[], periods: number, periodDays: number, now: Date): number[] {
  const idSet = new Set(classIds)
  const bounds = periodBoundaries(periods, periodDays, now)
  const trend: number[] = []
  for (let i = 1; i < bounds.length; i++) {
    let secs = 0
    for (const r of rows) {
      if (!idSet.has(r.class_id)) continue
      const t = new Date(r.started_at).getTime()
      if (t > bounds[i - 1] && t <= bounds[i]) secs += r.duration_seconds ?? 0
    }
    trend.push(round1(secs / 3600))
  }
  return trend
}

export interface ActiveClassesShare {
  pct: number
  hasData: boolean
}

/** % of an ENTITY's own classes (a set of classIds) with >=1 session in the window. */
export function activeClassesShareForEntity(rows: ScopedSessionRow[], classIds: string[], days: number, now: Date): ActiveClassesShare {
  if (classIds.length === 0) return { pct: 0, hasData: false }
  const idSet = new Set(classIds)
  const since = now.getTime() - days * MS_PER_DAY
  const activeSet = new Set<string>()
  for (const r of rows) {
    if (!idSet.has(r.class_id)) continue
    if (new Date(r.started_at).getTime() < since) continue
    activeSet.add(r.class_id)
  }
  return { pct: Math.round((activeSet.size / classIds.length) * 1000) / 10, hasData: true }
}

/** Bucketed active-classes-share trend for an ENTITY — % of its classIds active per period. */
export function activeClassesTrendForEntity(rows: ScopedSessionRow[], classIds: string[], periods: number, periodDays: number, now: Date): number[] {
  if (classIds.length === 0) return []
  const idSet = new Set(classIds)
  const bounds = periodBoundaries(periods, periodDays, now)
  const trend: number[] = []
  for (let i = 1; i < bounds.length; i++) {
    const activeSet = new Set<string>()
    for (const r of rows) {
      if (!idSet.has(r.class_id)) continue
      const t = new Date(r.started_at).getTime()
      if (t > bounds[i - 1] && t <= bounds[i]) activeSet.add(r.class_id)
    }
    trend.push(Math.round((activeSet.size / classIds.length) * 1000) / 10)
  }
  return trend
}

export type MeasureId = 'rate' | 'minutes_per_class' | 'hours_total' | 'active_classes'

export interface MeasureResult {
  value: number
  trend: number[]
}

/**
 * Dispatch: compute ONE measure's value + trend for a set of classIds (an
 * entity or a single cohort member) — the shared entry point the endpoint
 * calls once for the entity and once per active cohort member, so every
 * measure rides the identical cohort-computation shape.
 */
export function computeMeasureForClassIds(
  measure: MeasureId,
  rows: ScopedSessionRow[],
  classIds: string[],
  days: number,
  periods: number,
  periodDays: number,
  now: Date,
): MeasureResult {
  switch (measure) {
    case 'rate': {
      const w = aggregateWindowPace(rows, classIds, days, now)
      return { value: w.pace, trend: aggregatePeriodTrend(rows, classIds, periods, periodDays, now) }
    }
    case 'minutes_per_class': {
      const w = aggregateWindowMinutes(rows, classIds, days, now)
      return { value: w.minutesPerWeek, trend: aggregateMinutesTrend(rows, classIds, periods, periodDays, now) }
    }
    case 'hours_total': {
      const w = windowHoursForEntity(rows, classIds, days, now)
      return { value: w.hours, trend: hoursTrendForEntity(rows, classIds, periods, periodDays, now) }
    }
    case 'active_classes': {
      const w = activeClassesShareForEntity(rows, classIds, days, now)
      return { value: w.pct, trend: activeClassesTrendForEntity(rows, classIds, periods, periodDays, now) }
    }
  }
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
