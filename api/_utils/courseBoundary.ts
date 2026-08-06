/**
 * courseBoundary — where a course's BUILT content actually ends.
 *
 * `courses.seed_count` is the AUTHORED length (668 for most courses); it is
 * not the same thing as "we have generated the audio for this". Several
 * courses are shipped as MVPs: the seeds exist, the presentation audio does
 * not. Serving a learner past that line walks them into rounds whose intro
 * has no clip — silence that reads as a broken app rather than as the end of
 * the course.
 *
 * Measured 2026-08-04 (course_legos.presentation_audio_id coverage):
 *   ara_lb_for_eng — 1546 legos to seed 668, presentation clean through 300,
 *                    then NULL for every lego from seed 301 on (907 total).
 *   ara_eg_for_eng — same shape: clean through 300, nothing after (701 NULL).
 *   ita_for_eng / spa_for_eng — populated all the way to 668; NOT capped.
 *
 * Owner decision (Tom, 2026-08-04): "we'll just stop at 300 seeds. That's an
 * MVP course and that's absolutely fine" — do not regenerate the missing
 * clips; stop the course at the boundary and let the learner reach a clean
 * end-of-course instead.
 *
 * Raising a course to the full 668 later is ONE edit here (drop it from the
 * map, or change its value), because both the round-map and the cycles
 * endpoint read the boundary from this module.
 */

/**
 * The MVP course length. Free courses stop here in general; premium courses
 * extend to the full authored length once the content is built.
 */
export const MVP_MAX_SEED = 300

/**
 * Courses whose built content stops short of their authored seed_count.
 * Key = course_code, value = the last seed that is genuinely playable.
 *
 * Only list a course here when its content is verifiably absent past the
 * boundary — a course with scattered gaps (ita_for_eng has 74 legos with no
 * presentation audio, spread across the whole course) is NOT a boundary
 * case: those degrade per-lego via the known-audio fallback on intro cycles
 * and must keep playing to the end.
 */
const COURSE_MAX_SEED: Readonly<Record<string, number>> = {
  ara_lb_for_eng: MVP_MAX_SEED,
  ara_eg_for_eng: MVP_MAX_SEED,
}

/**
 * Last playable seed for a course, or null when the course runs to its full
 * authored length (the common case — no cap applied).
 */
export function courseMaxSeed(courseCode: string): number | null {
  return COURSE_MAX_SEED[courseCode] ?? null
}

/**
 * True iff `seedNumber` is past the course's built boundary.
 */
export function isPastCourseBoundary(courseCode: string, seedNumber: number): boolean {
  const max = courseMaxSeed(courseCode)
  return max !== null && seedNumber > max
}
