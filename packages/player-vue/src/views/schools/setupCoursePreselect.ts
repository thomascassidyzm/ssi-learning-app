/**
 * The language a school already answered for at sign-up.
 *
 * A head picks their language at the /schools1 door; provision.ts stores that
 * choice on `schools.trial_course_code` (api/_utils/schoolPlatformTrial.ts),
 * and /api/school/subscription hands it back to the client as
 * `useSchoolCourseCatalogue().schoolTrialCourse`. The setup wizard used to
 * open its course picker empty, so step 4 asked "Choose course" of somebody
 * who had already said Welsh ten minutes earlier.
 *
 * Derived from that ONE stored value — never carried along a second path from
 * the signup screen, which is how two representations of one choice start
 * disagreeing. Nothing is locked: the picker keeps every course the school can
 * use, filterable, so a school on its free year can still choose another.
 */
export function preselectedCourseCode(
  signupCourseCode: string | null | undefined,
  options: { course_code: string }[],
): string | null {
  if (!signupCourseCode) return null
  return options.some((o) => o.course_code === signupCourseCode) ? signupCourseCode : null
}
