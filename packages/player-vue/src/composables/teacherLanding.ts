/**
 * teacherLanding — "We need teacher accounts to open with the dashboard and
 * not the player." (Tom, 2026-09-14 13:03Z, job #662.)
 *
 * A signed-in TEACHER account that opens the app lands on the teacher home,
 * /schools — her classes and Play as class in front of her — not on the
 * Library player, where a lesson pressed from habit lands on her own account
 * (Chepstow, job #651: thirteen teachers in one week). Her own play stays one
 * deliberate step away: the schools shell's Learn / My player buttons reach
 * the player exactly as before, because this rule fires ONLY on the app's
 * first navigation — the cold open — never on an in-app tap.
 *
 * Scope, deliberately narrow:
 *   - the educational role `teacher` only. School admins and group leaders
 *     are not in the ruling and keep the 2026-07-24 default (everyone lands
 *     in the player); tutors have their own shell.
 *   - the bare player path with no query: a deep link (?course=, ?class=,
 *     ?reset=1, ?screen=, Popty's round links) is an intention and is kept.
 *   - the first navigation of the session only.
 * The role is the CACHED one (localStorage, written on every learner-row
 * fetch), so a brand-new device's very first sign-in still reaches the
 * player once; from the next open, the dashboard.
 *
 * This supersedes, for teachers only, the 2026-07-24 ruling on the player
 * route ("everyone lands in the player by default").
 */

export interface TeacherLandingInput {
  /** The EFFECTIVE educational role from the role cache (the persona's under View-as). */
  role: string | null | undefined
  /** True when this is the router's first navigation — the app opening. */
  isFirstNavigation: boolean
  /** The path being entered. */
  path: string
  /** Number of query keys on the target location. */
  queryKeys: number
}

export const TEACHER_HOME = '/schools'

/** The path to send the navigation to instead, or null to let it through. */
export function teacherLandingTarget(input: TeacherLandingInput): string | null {
  if (input.role !== 'teacher') return null
  if (!input.isFirstNavigation) return null
  if (input.path !== '/') return null
  if (input.queryKeys > 0) return null
  return TEACHER_HOME
}
