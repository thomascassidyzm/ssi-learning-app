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
 * So, as applied here:
 *   - any positive number of seconds is at least 1 min (ceiling); zero stays 0;
 *   - under an hour the figure is "N min";
 *   - at or over an hour it is "1 h 14 min";
 *   - "0 h" never appears.
 *
 * Every school view formats through this file; a second formatter is the bug.
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

/** "14 min" under an hour, "1 h 14 min" from an hour up — the only way practice time is written on a school page. */
export function formatPracticeMinutes(minutes: number | string | null | undefined): string {
  const m = ceilPositive(Number(minutes) || 0)
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  const rest = m % 60
  return rest === 0 ? `${h} h` : `${h} h ${rest} min`
}
