/**
 * THE ONE practice-time formatter for every school-facing surface.
 *
 * Two founder rulings, the later one refining the earlier:
 *
 * Tom on staging 2026-09-11 (job #265): "Why the fuck is hours a thing
 * anyway?" — repeated after the same correction on 2026-07-18 ("0h" for a
 * school whose staff had practised for minutes). A number of minutes never
 * rounds to a lying zero.
 *
 * Tom on staging 2026-09-14 16:17Z (job #683): "maybe round up to the nearest
 * minute, not down. because learners who start playing and do 20-30s are
 * showing as 0 mins" and "0 hours? it shouldn't round down to the nearest
 * full hour. it should just give the mins. 0 h 14 mins. or something like
 * that when it's hours played".
 *
 * Tom on production 2026-09-18 (job #207), reading Chepstow's school average
 * as "0m" beside a class showing 8 min: "The school average is the misleading
 * one. It can't be zero if the class I'm looking at has 8m." An AVERAGE is a
 * fraction, and 11.7 minutes over 33 classes is 0.35 — a real number that the
 * insight cards' own round-to-nearest turned into a flat zero. So:
 *
 *   - a value that is more than nothing and less than a minute reads
 *     "<1 min", never "0 min" and never a rounded-up "1 min" that overstates
 *     a whole school's week by three times;
 *   - the ceiling above still governs everything from a minute up, so a class
 *     that practised for 7 min 22 s reads "8 min" on every page it appears on.
 *
 * So, as applied here:
 *   - any positive number of seconds is at least 1 min (ceiling); zero stays 0;
 *   - a fraction of a minute reads "<1 min" — a real number never reads zero;
 *   - under an hour the figure is "N min";
 *   - at or over an hour it is "1 h 14 min";
 *   - "0 h" never appears.
 *
 * Every school view formats through this file; a second formatter is the bug.
 * The insight week cards each carried one until 2026-09-18, which is exactly
 * how the school average came to say a different thing from the class page.
 */

// Round up, but only past a REAL fraction: 256.6 h × 60 is 15396.000000000002
// in floating point, and a ceiling that reads that as "15397 min" invents a
// minute nobody practised. Anything within a millionth of a whole is whole.
function ceilPositive(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0
  const nearest = Math.round(n)
  if (Math.abs(n - nearest) < 1e-6) return nearest
  return Math.ceil(n)
}

/** DB views (school_summary, group_summary) still carry hours. Convert at the boundary. */
export function hoursToMinutes(hours: number | string | null | undefined): number {
  return ceilPositive((Number(hours) || 0) * 60)
}

/** Seconds → whole minutes, rounding UP: 25 seconds of play is 1 min, never 0. */
export function secondsToMinutes(seconds: number | string | null | undefined): number {
  return ceilPositive((Number(seconds) || 0) / 60)
}

/**
 * More than nothing, less than a minute. An AVERAGE lands here all the time —
 * a school's week spread over every class that has started — and it is the one
 * band where both a floor and a ceiling lie: "0 min" denies practice that
 * happened, "1 min" claims three times the practice there was.
 */
function isSubMinute(n: number): boolean {
  return Number.isFinite(n) && n > 0 && n < 1
}

/** "14 min" under an hour, "1 h 14 min" from an hour up — the only way practice time is written on a school page. */
export function formatPracticeMinutes(minutes: number | string | null | undefined): string {
  const raw = Number(minutes) || 0
  if (isSubMinute(raw)) return '<1 min'
  const m = ceilPositive(raw)
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  const rest = m % 60
  return rest === 0 ? `${h} h` : `${h} h ${rest} min`
}

/**
 * The SAME rule, in the tight form the insight week cards need: "8m", "<1m",
 * "1h 25m". Two columns of numbers on a phone have no room for "1 h 14 min",
 * which is the only reason this exists — the rounding, the ceiling and the
 * sub-minute band are the one rule above, shared, so a card and a page can
 * never again disagree about the same class's week.
 */
export function formatPracticeMinutesCompact(minutes: number | string | null | undefined): string {
  const raw = Number(minutes) || 0
  if (isSubMinute(raw)) return '<1m'
  const m = ceilPositive(raw)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  const rest = m % 60
  return rest === 0 ? `${h}h` : `${h}h ${rest}m`
}

/**
 * A COUNT that is an average — new phrases across a cohort — under the same
 * law. 0.6 phrases is not 1 and 0.4 phrases is not 0; both are "<1".
 */
export function formatAverageCount(n: number | string | null | undefined): string {
  const raw = Number(n) || 0
  if (isSubMinute(raw)) return '<1'
  return String(Math.round(raw))
}
