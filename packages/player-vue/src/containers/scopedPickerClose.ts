/**
 * What a learner is left in when they close a SCOPED course picker.
 *
 * The org-enrolment flow opens the picker restricted to the courses the org
 * actually granted — for the Canolfan, North and South Welsh. Behind that
 * sheet sits whatever App.vue's ordinary resolution put there, and for a
 * first-ever visit through an enrolment link that is the anonymous-visitor
 * default: Chinese. Kai closed the sheet on staging on 2026-09-08 and was
 * looking at a language he has no connection to.
 *
 * So dismissing a scoped picker without tapping anything lands the learner in
 * the FIRST granted course, in the order the policy lists them. It is a
 * default we picked, not a choice they made, and it is stamped that way; the
 * picker is one tap away for the other dialect.
 *
 * NOT TOUCHED: the unscoped picker. `null` for an empty scope means "leave the
 * app exactly as it was", which is every ordinary close, and the general
 * anonymous-visitor default is a separate question that lives in App.vue.
 */
export function courseToFallBackTo(
  scopedCourses: readonly string[] | null | undefined,
  activeCourseCode: string | null | undefined,
): string | null {
  const scoped = (scopedCourses ?? []).filter(Boolean)
  if (scoped.length === 0) return null
  // Already in one of the granted courses — nothing to change.
  if (activeCourseCode && scoped.includes(activeCourseCode)) return null
  return scoped[0]
}
