/**
 * A school named per the team's own "ZZ ..." soak-test/E2E convention
 * (already used by every hand-created test school — see CLAUDE.md's
 * "Chepstow scenario" finding, 2026-08-07) should carry `is_test = true`
 * without anyone remembering to flag it by hand. Every real-user write path
 * that sets `schools.school_name` (self-serve wizard, admin tool, govt
 * admin tool) should OR this into whatever is_test value it was already
 * going to write — never downgrade an explicit true.
 */
export function isTestSchoolName(name: string): boolean {
  return /^zz[\s\-–—]/i.test(name.trim())
}
