/**
 * courseChoice — the remembered course, and WHETHER THE LEARNER CHOSE IT.
 *
 * `ssi-last-course` has always been written by two very different things and
 * read back as one. A learner tapping a course in the picker, following a
 * `?course=` link, or joining a class writes it — those are choices. But
 * App.vue's anonymous-visitor fallback also writes it, and from the second
 * visit onward an auto-assigned default was indistinguishable from a course
 * somebody actually picked (job #596, off the audit at /d/e06f51fc).
 *
 * So the code is now written WITH ITS ORIGIN, in a second key beside it:
 *
 *   ssi-last-course         zho_for_eng
 *   ssi-last-course-origin  default | chosen
 *
 * Two keys rather than a JSON blob on purpose — every existing reader of
 * `ssi-last-course`, including four e2e probes and the shell's own freshness
 * check, keeps working untouched, and a reader that wants to know asks.
 *
 * A value written before this existed carries NO origin, and that is read as
 * "unknown", never as "default": we cannot retroactively tell which of the two
 * wrote it, and guessing "default" would silently stop prewarming for people
 * who really did choose. Unknown behaves exactly as `chosen` did.
 */

export const LAST_COURSE_KEY = 'ssi-last-course'
export const LAST_COURSE_ORIGIN_KEY = 'ssi-last-course-origin'

/** `chosen` = the learner pointed at it. `default` = we picked for them. */
export type CourseChoiceOrigin = 'chosen' | 'default'

export interface RememberedCourse {
  /** The stored course code, or null when nothing is stored. */
  code: string | null
  /** How it got there; null for a value written before origins existed. */
  origin: CourseChoiceOrigin | null
}

/**
 * Write the remembered course down together with how it was arrived at.
 * Never throws — private browsing and blocked storage are ordinary here.
 */
export function rememberCourse(code: string | null | undefined, origin: CourseChoiceOrigin): void {
  if (!code) return
  try {
    localStorage.setItem(LAST_COURSE_KEY, code)
    localStorage.setItem(LAST_COURSE_ORIGIN_KEY, origin)
  } catch {
    /* no storage — the course resolves from scratch next boot, as before */
  }
}

/** The remembered course and its origin. `{ code: null, origin: null }` when unreadable. */
export function readRememberedCourse(): RememberedCourse {
  try {
    const code = localStorage.getItem(LAST_COURSE_KEY)
    if (!code) return { code: null, origin: null }
    const raw = localStorage.getItem(LAST_COURSE_ORIGIN_KEY)
    const origin = raw === 'chosen' || raw === 'default' ? raw : null
    return { code, origin }
  } catch {
    return { code: null, origin: null }
  }
}

/**
 * Did we pick the remembered course for the learner rather than they for us?
 *
 * The one question the prewarm path asks: warming a course nobody asked for
 * spends a round trip of somebody else's bandwidth on every enrol, redeem,
 * join and try-link visit. `false` for an unknown origin, deliberately.
 */
export function rememberedCourseWasAutoAssigned(): boolean {
  return readRememberedCourse().origin === 'default'
}
