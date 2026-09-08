/**
 * The dialect hint on an enrolment link.
 *
 * The Canolfan grants two courses under one policy — North Welsh and South
 * Welsh — so a learner following the org's one sign-up link is asked, once
 * they are in, which of the two they want. Kai's cohorts are not mixed like
 * that: a North Wales tutor's whole class wants North Welsh, and being asked
 * is a question with a known answer.
 *
 * So the LINK can carry the answer: `/enrol/ABC-123?course=cym_n_for_eng`
 * lands that learner straight in North Welsh and never opens the picker. It is
 * the SAME code, the same cohort and the same enrolment record — one link
 * still, per api/admin/org-enrolment-setup.ts's ONE LINK rule. The dialect is
 * a hint about where to land, not a second door.
 *
 * WHAT THE HINT CANNOT DO. It cannot widen the grant. The free year unlocks
 * exactly the policy's `granted_courses`, written server-side by
 * api/org/enrol.ts from the policy row, and this function only ever returns a
 * course that is already on that list. A hand-edited `?course=spa_for_eng`
 * resolves to nothing and the learner gets the ordinary picker — the query
 * string chooses between granted courses, it never adds one.
 */

/** Codes are compared the way the rest of the app writes them: lower, trimmed. */
function normalise(code: unknown): string {
  return String(code ?? '').trim().toLowerCase()
}

/**
 * The course an enrolment link asks us to land in, or null for "no usable
 * hint" — which is every existing link, and any hint naming a course this
 * policy does not grant.
 */
export function resolveHintedCourse(
  hint: unknown,
  grantedCourses: readonly string[] | null | undefined,
): string | null {
  const wanted = normalise(hint)
  if (!wanted) return null
  for (const granted of grantedCourses ?? []) {
    if (normalise(granted) === wanted) return granted
  }
  return null
}
