/**
 * THE ONE practice-time unit on every school-facing surface is MINUTES.
 *
 * Founder ruling, Tom on staging 2026-09-11 (job #265): "Why the fuck is
 * hours a thing anyway?" — repeated after the same correction on 2026-07-18
 * ("0h" for a school whose staff had practised for minutes). A trial school
 * practises for minutes, a busy school for hundreds of minutes, and a number
 * of minutes never rounds to a lying zero. Hours are not a unit here: no
 * "1.2h", no "h m", nothing else. Every school view formats through this
 * file; a second formatter is the bug.
 */

/** DB views (school_summary, group_summary) still carry hours. Convert at the boundary. */
export function hoursToMinutes(hours: number | string | null | undefined): number {
  return Math.round((Number(hours) || 0) * 60)
}

export function secondsToMinutes(seconds: number | string | null | undefined): number {
  return Math.round((Number(seconds) || 0) / 60)
}

/** "352 min" — the only way practice time is written on a school page. */
export function formatPracticeMinutes(minutes: number | string | null | undefined): string {
  return `${Math.round(Number(minutes) || 0)} min`
}
