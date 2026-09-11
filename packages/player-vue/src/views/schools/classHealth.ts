/**
 * classHealth — the ONE rule behind the health mark on the class list
 * (TeacherDashboard.vue), kept as a pure function so it can be proven.
 *
 * The Handbook sentence for that column: "Health is worked out from how many
 * of the last seven days the class practised on." Two records can say a class
 * practised: the legacy class report (class_activity_stats, pupil accounts
 * only) and the diary's in-app days from /api/school/class-practice-7d, which
 * is the ONLY record that sees whole-class play from the front. The higher
 * count wins. Until job #217 (2026-09-11) the rule said "no pupil accounts
 * means inactive" before it looked at either — so Ysgol Cas-gwent's 34
 * pupil-less classes all read Inactive next to a row saying hours in the app
 * this week.
 */
export type ClassHealth = 'excellent' | 'good' | 'needs-attention' | 'inactive'

export interface ClassHealthInputs {
  /** Pupil accounts on the class. */
  studentCount: number
  /** class_activity_stats.active_days_last_7 when a report exists, else null. */
  reportActiveDays: number | null
  /** Distinct days with any play in the last 7, class account and pupils together (activeDaysByClass). */
  inAppActiveDays: number
}

export function deriveClassHealth({ studentCount, reportActiveDays, inAppActiveDays }: ClassHealthInputs): ClassHealth {
  const days = Math.max(reportActiveDays ?? 0, inAppActiveDays || 0)
  if (days >= 5) return 'excellent'
  if (days >= 2) return 'good'
  if (days >= 1) return 'needs-attention'
  // No day of play in the window on either record.
  if (studentCount === 0) return 'inactive'
  if (reportActiveDays === null) return 'good'
  return 'needs-attention'
}
