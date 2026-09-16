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
  /**
   * WHO played (job #989). 'class' = the class's own account, whole-class play
   * from the front — Tom's X. 'pupil' = a pupil's own account on that class —
   * Tom's Y. Absent on the legacy RPC rows, which are class-account play by
   * construction, so `?? 'class'` is the read everywhere.
   */
  actor?: 'class' | 'pupil'
  course_code: string | null
  start_lego_id: string | null
  end_lego_id: string | null
  start_ord: number | null
  end_ord: number | null
  duration_seconds: number | null
  started_at: string
}

/**
 * PRIVACY FLOOR — by COHORT KIND, never by caller role (Tom's ruling,
 * 2026-09-15: "the comparison limit to 5 was for INDIVIDUAL users, to not be
 * identified for GDPR purposes — not to prevent classes being compared").
 *
 *   · individuals — a cohort made of PEOPLE (me/insights: other learners on
 *     my course). Fewer than 5 and a person could be read off the average.
 *     Held for every role, admins included.
 *   · entities — a cohort made of CLASSES / SCHOOLS / GROUPS as entities
 *     (both rate-compare engines). A class average is already an aggregate;
 *     one comparable class is a comparison. Floor 1, teacher included.
 *
 * K_FLOOR keeps its name and value (5) for the individual-cohort callers and
 * for spec.ts Sovereignty.kFloor parity; entity cohorts call cohortFloor().
 */
export const K_FLOOR = 5 // individuals — matches spec.ts Sovereignty.kFloor default; a band of one/few can't leak
export const K_FLOOR_ENTITIES = 1
export type CohortKind = 'individuals' | 'entities'
export function cohortFloor(kind: CohortKind): number {
  return kind === 'individuals' ? K_FLOOR : K_FLOOR_ENTITIES
}

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
 * own window pace, over EVERY member class. For a single-class set this is
 * identical to windowPaceForClass (mean of one). Same primitive doubles as a
 * COHORT member's value when the cohort being compared against is itself
 * made of schools or groups, not bare classes.
 *
 * EVERY MEMBER COUNTS, ACTIVE OR NOT (Tom's ruling 2026-09-16: "a set member
 * should ALWAYS be included in the average, not excluded"). A class that did
 * not practise in the window advanced 0 LEGOs, so its true pace is 0 and it
 * is averaged in at 0 — it is never dropped from the denominator. Before
 * this, a school's own rate was the mean over whichever of its classes
 * happened to practise, so the same school read differently window to window
 * for reasons that had nothing to do with how fast it was going.
 *
 * `hasData` still means "somebody in this set practised" — it gates the
 * furthest-LEGO context line, never the arithmetic.
 */
export function aggregateWindowPace(
  rows: ScopedSessionRow[],
  classIds: string[],
  days: number,
  now: Date,
): WindowPace {
  const all = classIds.map((id) => windowPaceForClass(rows, id, days, now))
  const active = all.filter((w) => w.hasData)
  if (all.length === 0) return { pace: 0, legosAdvanced: 0, hasData: false, furthestLegoId: null, furthestOrd: 0 }
  const pace = round1(all.reduce((s, w) => s + w.pace, 0) / all.length)
  const legosAdvanced = Math.round(all.reduce((s, w) => s + w.legosAdvanced, 0) / all.length)
  if (active.length === 0) return { pace, legosAdvanced, hasData: false, furthestLegoId: null, furthestOrd: 0 }
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
  // A class with no rows at all advanced 0 in every period — return that
  // honestly rather than an empty array, so it is averaged into the dashed
  // comparison series at 0 instead of silently dropping out of it (Tom's
  // ruling 2026-09-16: a set member is always in the average). An empty
  // return here used to make the dashed line disagree with the headline
  // average, which included the same member at 0.
  if (!rows.some((r) => r.class_id === classId)) return new Array(Math.max(periods, 0)).fill(0)
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

/** Same generalization as aggregateWindowPace, for the trend line — mean-trend across EVERY member class (a dormant one contributes zeros, never nothing), at any period granularity. */
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
// MEASURES (THE LENS: rate | minutes | active_classes)
//
// All computed from the SAME ScopedSessionRow[] the rate math already reads
// — no new fetch, no new RPC. `rate` keeps its existing pace primitives
// above; `minutes` is the in-app minutes TOTAL in the window (job #673,
// 2026-09-14 — it replaced a per-week rate, `minutes_per_class`, and a
// duplicate in hours, `hours_total`). Every measure follows the SAME grammar
// as rate: an ENTITY-level value/trend, and each COHORT MEMBER gets its own
// value/trend computed by the identical function over that member's own
// classIds — so "average" is always "mean of members' own entity-level
// metric," whether the metric itself is a rate or a sum.
// ─────────────────────────────────────────────────────────────────────────

function periodBoundaries(periods: number, periodDays: number, now: Date): number[] {
  const periodMs = periodDays * MS_PER_DAY
  const nowMs = now.getTime()
  const bounds: number[] = []
  for (let i = 0; i <= periods; i++) bounds.push(nowMs - (periods - i) * periodMs)
  return bounds
}

export interface WindowMinutes {
  minutes: number
  hasData: boolean
}

/**
 * IN-APP MINUTES for an ENTITY (a set of classIds) inside the window — a
 * straight SUM of the rows' seconds, no rate, no NOW-anchored decay. Tom,
 * 2026-09-14: "last 30 days can NEVER be less than last 7 days ... no, it
 * just can't be." A total in a rolling window is monotone in the window by
 * construction; the per-week rate this replaced (minutes ÷ weeks from first
 * activity to now) read 18.7 for a week and 11.5 for a month on one burst
 * of play. The rows are the class accounts' play-to-stop spans
 * (_utils/diarySessionRows.ts), the one minute definition in inAppTime.ts.
 */
export function windowMinutesForEntity(rows: ScopedSessionRow[], classIds: string[], days: number, now: Date): WindowMinutes {
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
  return { minutes: round1(totalSeconds / 60), hasData: any }
}

/** Bucketed minutes trend for an ENTITY — the sum per period, so the bars add up to the window total. A period with no play is a zero, never interpolated. */
export function minutesTrendForEntity(rows: ScopedSessionRow[], classIds: string[], periods: number, periodDays: number, now: Date): number[] {
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
    trend.push(round1(secs / 60))
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

export type MeasureId = 'rate' | 'minutes' | 'active_classes'

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
    case 'minutes': {
      const w = windowMinutesForEntity(rows, classIds, days, now)
      return { value: w.minutes, trend: minutesTrendForEntity(rows, classIds, periods, periodDays, now) }
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


// ─────────────────────────────────────────────────────────────────────────
// THE WEEK CARD (job #989, Tom 2026-09-16)
//
// Three numbers, in a school WEEK: "Play-as-class time = X, individual
// students time = Y, total effective learning time = X + Y", and progress as
// NEW PHRASES this week. No ratio, ever — the class's three numbers sit
// beside the school's same three and the reader does their own comparing
// (RBF's point, endorsed: a computed ratio decides for them, and decides
// wrongly whenever the denominator is small).
// ─────────────────────────────────────────────────────────────────────────

export interface WeekNumbers {
  /** Play-as-class minutes — the class account's own in-app time. */
  classMinutes: number
  /** Individual pupils' minutes — their own accounts, never summed into X. */
  pupilMinutes: number
  /** Total effective learning time: X + Y. */
  totalMinutes: number
  /** Phrases first reached inside the window — the class cursor's advance. */
  newPhrases: number
  hasData: boolean
}

function actorOf(r: ScopedSessionRow): 'class' | 'pupil' {
  return r.actor ?? 'class'
}

/** Minutes played by one actor kind, for a set of classes, inside [startMs, endMs). */
export function rangeMinutesByActor(
  rows: ScopedSessionRow[],
  classIds: string[],
  actor: 'class' | 'pupil',
  startMs: number,
  endMs: number,
): { minutes: number; hasData: boolean } {
  const idSet = new Set(classIds)
  let seconds = 0
  let any = false
  for (const r of rows) {
    if (!idSet.has(r.class_id)) continue
    if (actorOf(r) !== actor) continue
    const t = new Date(r.started_at).getTime()
    if (t < startMs || t >= endMs) continue
    seconds += r.duration_seconds ?? 0
    any = true
  }
  return { minutes: round1(seconds / 60), hasData: any }
}

/**
 * NEW PHRASES in the window — the CURSOR ADVANCE, not a count of what was
 * played: the furthest position reached by the end of the window minus the
 * furthest reached before it started, floored at 0. Re-treading old ground is
 * practice, not progress, so it counts zero here; a week spent consolidating
 * reads 0 new phrases and a healthy pile of minutes, which is the true shape
 * of that week.
 *
 * Read off the CLASS account's own journey (actor 'class'). A pupil racing
 * ahead on their own account does not move the class's cursor — see the
 * report's gap note.
 */
export function newPhrasesInRange(
  rows: ScopedSessionRow[],
  classIds: string[],
  startMs: number,
  endMs: number,
): number {
  const idSet = new Set(classIds)
  let total = 0
  for (const classId of idSet) {
    let before = 0
    let through = 0
    for (const r of rows) {
      if (r.class_id !== classId || actorOf(r) !== 'class') continue
      const t = new Date(r.started_at).getTime()
      if (t >= endMs) continue
      const ord = Math.max(r.end_ord ?? 0, r.start_ord ?? 0)
      if (ord > through) through = ord
      if (t < startMs && ord > before) before = ord
    }
    if (through > 0) total += Math.max(through - before, 0)
  }
  return total
}

/** The three numbers for one entity (a set of classes) in one week. */
export function weekNumbersForClassIds(
  rows: ScopedSessionRow[],
  classIds: string[],
  startMs: number,
  endMs: number,
): WeekNumbers {
  const x = rangeMinutesByActor(rows, classIds, 'class', startMs, endMs)
  const y = rangeMinutesByActor(rows, classIds, 'pupil', startMs, endMs)
  return {
    classMinutes: x.minutes,
    pupilMinutes: y.minutes,
    totalMinutes: round1(x.minutes + y.minutes),
    newPhrases: newPhrasesInRange(rows, classIds, startMs, endMs),
    hasData: x.hasData || y.hasData,
  }
}

/**
 * COHORT FOR A WEEK — the ONE definition of who the average divides by
 * (Tom via Watson, 2026-09-16). Every candidate class whose FIRST SESSION is
 * on or before `weekEndMs`, the viewed class included on the same terms as any
 * other. Three properties fall out of it, and all three are the point:
 *
 *   · a class that has NEVER played is in no denominator, in any week;
 *   · a STARTED class that was quiet counts at its true value, which for a sum
 *     is 0 — being quiet is a fact about the week, not grounds for exclusion
 *     (job #982's rule, preserved exactly);
 *   · the set only ever GROWS, and never retroactively: a class that first
 *     played in week 8 is absent from weeks 1-7 rather than a zero in them, so
 *     yesterday's bars say the same thing tomorrow.
 *
 * It is viewer-independent by construction — nothing here reads who is asking.
 * The card, the weekly bars and the school series all call THIS; a second
 * definition anywhere is a bug, not an optimisation.
 *
 * `weekEndMs` is EXCLUSIVE, exactly as the session sums are (rangeMinutesByActor
 * counts `t >= startMs && t < endMs`). A class whose very first play lands on
 * the stroke of Monday 00:00 belongs to the week that is starting, not to the
 * one that just closed: with `<=` it joined the PRECEDING week's denominator
 * while contributing no minutes to it, quietly dragging that week's average
 * down (job #989 fix-up).
 */
export function cohortFor(
  candidateClassIds: string[],
  firstPlayByClass: Map<string, number | null>,
  weekEndMs: number,
): string[] {
  return candidateClassIds.filter((id) => {
    const first = firstPlayByClass.get(id)
    return typeof first === 'number' && first < weekEndMs
  })
}

/**
 * The COHORT's three numbers — the mean over the cohort as `cohortFor` defines
 * it. Job #979b's self-inclusion is kept: the viewed class is one of the
 * members, so the average reads the same whoever opens it. A cohort of zero
 * members has no numbers at all rather than a zero that reads like a fact —
 * that is ABSENCE, and the card and the bars both render it as nothing.
 */
export function meanWeekNumbers(members: WeekNumbers[]): WeekNumbers {
  if (members.length === 0) {
    return { classMinutes: 0, pupilMinutes: 0, totalMinutes: 0, newPhrases: 0, hasData: false }
  }
  const mean = (pick: (w: WeekNumbers) => number): number =>
    round1(members.reduce((s, w) => s + pick(w), 0) / members.length)
  return {
    classMinutes: mean((w) => w.classMinutes),
    pupilMinutes: mean((w) => w.pupilMinutes),
    totalMinutes: mean((w) => w.totalMinutes),
    newPhrases: mean((w) => w.newPhrases),
    hasData: members.some((w) => w.hasData),
  }
}

/**
 * Weekly bars — total effective minutes (X + Y) per week bucket, oldest first.
 *
 * TWO DIFFERENT NOTHINGS, and telling them apart is the whole job:
 *   · 0 — this cohort existed that week and did not play. A real bar of zero
 *     height, and a real fact about the week. Never interpolated across: a
 *     school that took half term off did take half term off.
 *   · null — ABSENCE. Nobody in the cohort had started playing yet, so there
 *     is no number to draw and no zero to imply one. The chart leaves a gap.
 *
 * `cohortAt` is `cohortFor` bound to the candidates; pass it and each bucket
 * is drawn over the cohort as it stood THAT week. Omit it and the bars are the
 * given classes throughout, which is what the entity's own series wants once
 * its own absence has been decided by the caller.
 */
export function weeklyMinutesBars(
  rows: ScopedSessionRow[],
  classIds: string[],
  buckets: { startMs: number; endMs: number }[],
  cohortAt?: (weekEndMs: number) => string[],
): (number | null)[] {
  return buckets.map((b) => {
    const ids = cohortAt ? cohortAt(b.endMs) : classIds
    if (ids.length === 0) return null
    const x = rangeMinutesByActor(rows, ids, 'class', b.startMs, b.endMs)
    const y = rangeMinutesByActor(rows, ids, 'pupil', b.startMs, b.endMs)
    return round1(x.minutes + y.minutes)
  })
}

/** Element-wise mean of bar series, absence-aware: a bucket every series is absent from stays absent. */
export function meanBars(series: (number | null)[][]): (number | null)[] {
  if (series.length === 0) return []
  const len = Math.max(...series.map((s) => s.length))
  const out: (number | null)[] = []
  for (let i = 0; i < len; i++) {
    const present = series.map((s) => s[i]).filter((v): v is number => typeof v === 'number')
    out.push(present.length === 0 ? null : round1(present.reduce((a, b) => a + b, 0) / present.length))
  }
  return out
}
