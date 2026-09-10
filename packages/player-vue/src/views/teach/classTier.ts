/**
 * Which price tier a class sells its student seat at — the client's copy of
 * the rule the webhook enforces (api/teacher/paddle-webhook.ts,
 * handleStudentSubscription, and api/teacher/by-code.ts): school_id OR
 * group_id set = organisation-owned = the £5 school seat; neither = tutor
 * class = £10. Display and checkout only; the webhook re-derives and locks.
 *
 * NO GROUP PRICE (Tom, 2026-09-10, settled): there is no third number. A
 * class under a group is school-priced through this same rule.
 */
export function isOrgOwnedClass(
  cls: { school_id?: string | null; group_id?: string | null } | null | undefined,
): boolean {
  if (!cls) return false
  return !!cls.school_id || !!cls.group_id
}
