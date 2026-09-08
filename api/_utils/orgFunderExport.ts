/**
 * The funder export's arithmetic, with no database in it.
 * ======================================================
 *
 * Everything here is a pure function over rows, so the rules Kai will be
 * checking — the month window, the higher-of-dialects rule, the thresholds —
 * are testable without a Supabase mock and cannot drift from what the
 * endpoint does, because the endpoint has no arithmetic of its own.
 *
 * THE MINUTE. Every second counted here comes from
 * learner_speaking_opportunities.play_seconds: seconds in which the app was
 * actually playing audio to the learner. That is the one honest counter,
 * app-wide, since the founder ruling of 2026-08-19 and migrations
 * 20260908c/d. sessions.duration_seconds is wall clock on any row whose
 * accumulator never closed — one real session banked seven days — and is
 * never read here.
 *
 * THE HIGHER OF SOUTHERN AND NORTHERN, NEVER THE SUM. A learner who has done
 * both dialects is one learner, counted at whichever dialect total is higher.
 * Summing would double-count exactly the most engaged people.
 */

/**
 * Seconds per learner per course, already summed over the window by the
 * database — what org_enrolment_window_seconds returns.
 *
 * This is the shape a LARGE cohort must be read in. The raw per-day shape
 * below is still supported and still tested, because it is what the fallback
 * path produces when the aggregate function is not yet deployed, but a
 * 10,000-learner cohort must never travel as days.
 */
export interface CourseTotal {
  learner_id: string
  course_code: string
  seconds: number
}

/** One day of one learner's playback, straight off the ledger. */
export interface LedgerDay {
  learner_id: string
  course_code: string
  /** UTC date, 'YYYY-MM-DD'. */
  day: string
  play_seconds: number
}

/** A person on the roster, whether or not they have ever played. */
export interface EnrolledLearner {
  learner_id: string
  /** The minutes-from-zero baseline for this learner, UTC 'YYYY-MM-DD'. */
  reporting_from: string
  age_band_16_24: boolean
  /** UTC date they enrolled, 'YYYY-MM-DD' — decides who is "registered" in a window. */
  enrolled_on: string
}

export interface Window {
  /** Inclusive, UTC 'YYYY-MM-DD'. */
  from: string
  /** Inclusive, UTC 'YYYY-MM-DD'. */
  to: string
  label: string
}

export interface Measures {
  registered: number
  overFiveMinutes: number
  overSixtyMinutes: number
  overHundredMinutes: number
  /** Mean minutes across EVERY registered learner, zero-minute learners included. */
  averageMinutesAll: number
  /** Mean minutes across only those who did more than three minutes. */
  averageMinutesOverThree: number
  /** The denominator behind averageMinutesOverThree, so the number can be read honestly. */
  learnersOverThreeMinutes: number
  totalMinutes: number
}

export interface WindowResult {
  window: Window
  all: Measures
  aged16to24: Measures
}

/** Strictly greater than, in seconds — a learner on exactly 5.0 minutes is not "over 5". */
const MIN = 60

/**
 * The calendar month as an inclusive UTC day range.
 *
 * Windows built this way are disjoint and exhaustive: 2026-04-30 belongs to
 * April and to nothing else, and 2026-05-01 to May. The ledger's own `day`
 * column is a UTC date, so no timezone conversion happens anywhere and a
 * learner playing at 23:50 on the 30th cannot land in two months or neither.
 */
export function monthWindow(month: string): Window {
  const m = /^(\d{4})-(\d{2})$/.exec(month)
  if (!m) throw new Error(`month must be YYYY-MM, got "${month}"`)
  const year = Number(m[1])
  const mon = Number(m[2])
  if (mon < 1 || mon > 12) throw new Error(`month out of range: "${month}"`)
  // Day 0 of the NEXT month is the last day of this one, leap years included.
  const last = new Date(Date.UTC(year, mon, 0)).getUTCDate()
  return {
    from: `${m[1]}-${m[2]}-01`,
    to: `${m[1]}-${m[2]}-${String(last).padStart(2, '0')}`,
    label: month,
  }
}

/**
 * 1 April of the funding year containing `ref` — the Welsh funding year runs
 * April to March, so a report pulled in February 2027 baselines on 1 April
 * 2026, not 1 April 2027. Never hardcoded to a year: Kai has not named the
 * switchover date and this must still be right whenever he does.
 */
export function fundingYearStart(ref: Date = new Date()): string {
  const y = ref.getUTCFullYear()
  const startYear = ref.getUTCMonth() >= 3 ? y : y - 1
  return `${startYear}-04-01`
}

export function baselineWindow(from: string, to: string, label = 'baseline'): Window {
  return { from, to, label }
}

/**
 * Per-learner seconds inside a window, taking the HIGHER of the course
 * families rather than their sum.
 *
 * `familyMap` maps course_code -> family key. A code absent from the map is
 * not counted, and is returned in `unmappedCourses` so a silently-dropped
 * dialect is impossible to miss — the live estate has already produced stray
 * codes (`cym_for_eng_north`, `cym_for_eng`) that no course row backs, and a
 * Northern rebuild (`cym_nnew_for_eng`) waiting in the wings.
 *
 * `reportingFrom` per learner is applied here, not by the caller: a ledger day
 * earlier than that learner's own baseline is out of window even if it falls
 * inside the month. That is the clean break, enforced in one place.
 */
export function secondsByLearner(
  ledger: LedgerDay[],
  roster: EnrolledLearner[],
  window: Window,
  familyMap: Record<string, string>,
): { seconds: Map<string, number>; unmappedCourses: string[] } {
  const baseline = new Map(roster.map((r) => [r.learner_id, r.reporting_from]))
  const totals = new Map<string, CourseTotal>()

  for (const row of ledger) {
    const from = baseline.get(row.learner_id)
    if (from === undefined) continue // not on this roster
    if (row.day < window.from || row.day > window.to) continue
    if (row.day < from) continue // before this learner's own clean break
    const key = `${row.learner_id}\u0000${row.course_code}`
    const found = totals.get(key)
    if (found) found.seconds += Number(row.play_seconds) || 0
    else totals.set(key, { learner_id: row.learner_id, course_code: row.course_code, seconds: Number(row.play_seconds) || 0 })
  }

  // The window filter and the per-learner baseline are the only work unique to
  // the raw path; the dialect rule below is the SAME code the aggregated path
  // runs, so the two can never disagree about what "the higher of Southern and
  // Northern" means.
  return foldCourseTotals([...totals.values()], roster, familyMap)
}

/**
 * The higher of the course families, per learner — the one and only copy.
 *
 * Both paths end here: the raw per-day path above after it has filtered and
 * summed, and the aggregated path after the database has done the summing.
 * A rule implemented twice is a rule that drifts, and this is the rule the
 * funder's numbers turn on.
 */
export function foldCourseTotals(
  totals: CourseTotal[],
  roster: EnrolledLearner[],
  familyMap: Record<string, string>,
): { seconds: Map<string, number>; unmappedCourses: string[] } {
  const onRoster = new Set(roster.map((r) => r.learner_id))
  // learner -> family -> seconds
  const byFamily = new Map<string, Map<string, number>>()
  const unmapped = new Set<string>()

  for (const row of totals) {
    if (!onRoster.has(row.learner_id)) continue
    const family = familyMap[row.course_code]
    if (!family) {
      unmapped.add(row.course_code)
      continue
    }
    let fams = byFamily.get(row.learner_id)
    if (!fams) {
      fams = new Map()
      byFamily.set(row.learner_id, fams)
    }
    fams.set(family, (fams.get(family) ?? 0) + (Number(row.seconds) || 0))
  }

  const seconds = new Map<string, number>()
  for (const learner of roster) {
    const fams = byFamily.get(learner.learner_id)
    // THE RULE: max across families, never the sum. A learner with no ledger
    // rows at all still appears, at zero — "registered" includes people who
    // never played.
    seconds.set(learner.learner_id, fams ? Math.max(...fams.values()) : 0)
  }
  return { seconds, unmappedCourses: [...unmapped].sort() }
}

function measure(learners: EnrolledLearner[], seconds: Map<string, number>): Measures {
  const values = learners.map((l) => seconds.get(l.learner_id) ?? 0)
  const total = values.reduce((a, b) => a + b, 0)
  const overThree = values.filter((s) => s > 3 * MIN)
  const round1 = (n: number) => Math.round(n * 10) / 10
  return {
    registered: learners.length,
    overFiveMinutes: values.filter((s) => s > 5 * MIN).length,
    overSixtyMinutes: values.filter((s) => s > 60 * MIN).length,
    overHundredMinutes: values.filter((s) => s > 100 * MIN).length,
    averageMinutesAll: learners.length ? round1(total / MIN / learners.length) : 0,
    averageMinutesOverThree: overThree.length
      ? round1(overThree.reduce((a, b) => a + b, 0) / MIN / overThree.length)
      : 0,
    learnersOverThreeMinutes: overThree.length,
    totalMinutes: round1(total / MIN),
  }
}

/**
 * "Registered" for a window means everyone who had signed up by the END of it
 * — including people who never played, which is the whole point of driving
 * this from the enrolment roster rather than from the ledger. Somebody who
 * enrols in May is not in April's registered count; somebody who enrolled in
 * April and never returned still is, in May and forever after.
 */
export function rosterAsAt(roster: EnrolledLearner[], window: Window): EnrolledLearner[] {
  return roster.filter((r) => r.enrolled_on <= window.to)
}

export function measureWindow(
  ledger: LedgerDay[],
  roster: EnrolledLearner[],
  window: Window,
  familyMap: Record<string, string>,
): { result: WindowResult; unmappedCourses: string[] } {
  const registered = rosterAsAt(roster, window)
  return measureFolded(secondsByLearner(ledger, registered, window, familyMap), registered, window)
}

/**
 * The same measurement, from totals the database already aggregated. This is
 * the path a real cohort takes.
 */
export function measureWindowFromTotals(
  totals: CourseTotal[],
  roster: EnrolledLearner[],
  window: Window,
  familyMap: Record<string, string>,
): { result: WindowResult; unmappedCourses: string[] } {
  const registered = rosterAsAt(roster, window)
  return measureFolded(foldCourseTotals(totals, registered, familyMap), registered, window)
}

function measureFolded(
  folded: { seconds: Map<string, number>; unmappedCourses: string[] },
  registered: EnrolledLearner[],
  window: Window,
): { result: WindowResult; unmappedCourses: string[] } {
  const { seconds, unmappedCourses } = folded
  return {
    result: {
      window,
      all: measure(registered, seconds),
      // The 16-24 breakdown is a SUBSET of the same roster measured the same
      // way — reported separately, never subtracted from or added to `all`.
      aged16to24: measure(registered.filter((r) => r.age_band_16_24), seconds),
    },
    unmappedCourses,
  }
}

/** CSV, one row per window per cohort. Excel-safe: no formula-leading cells. */
export function toCsv(results: WindowResult[]): string {
  const header = [
    'window', 'cohort', 'registered', 'over_5_minutes', 'over_60_minutes',
    'over_100_minutes', 'average_minutes_all', 'average_minutes_over_3',
    'learners_over_3_minutes', 'total_minutes',
  ]
  const line = (w: string, cohort: string, m: Measures) => [
    w, cohort, m.registered, m.overFiveMinutes, m.overSixtyMinutes,
    m.overHundredMinutes, m.averageMinutesAll, m.averageMinutesOverThree,
    m.learnersOverThreeMinutes, m.totalMinutes,
  ].join(',')
  const rows: string[] = [header.join(',')]
  for (const r of results) {
    rows.push(line(r.window.label, 'all', r.all))
    rows.push(line(r.window.label, 'aged_16_24', r.aged16to24))
  }
  return rows.join('\n') + '\n'
}
