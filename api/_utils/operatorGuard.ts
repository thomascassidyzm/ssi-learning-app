/**
 * Operator-capture guard (founder incident, 2026-07-18).
 *
 * Self-service role-granting flows (invite-code redemption, onboarding
 * provisioning) mutate the SIGNED-IN account: educational_role, teachers/
 * schools rows, school tags, display_name. That's correct for real users —
 * and a trap for the platform operator, whose ssi_admin account gets
 * "captured" into a teacher/tutor identity whenever they test one of these
 * flows while signed in (live case: the operator's main account picked up
 * educational_role='teacher' + a school tag from a test teacher invite, plus
 * a tutor-test teachers row/class — and the schools shell then swallowed
 * every login).
 *
 * Rule: roles are additive facets of one account, but an OPERATOR account
 * (platform_role='ssi_admin') never takes on educational roles through
 * self-service flows. Testing happens from separate test accounts (which are
 * intentional and plentiful — see CLAUDE.md). Deliberate role grants to an
 * admin's own account go through admin tooling, not signup paths.
 */

import type { createClient } from '@supabase/supabase-js'

export const OPERATOR_CAPTURE_ERROR =
  "You're signed in as a platform admin — test signup and invite links from a separate test account (e.g. a private window), so they can't capture your real roles."

/** True when the signed-in account is a platform operator (ssi_admin). */
export async function isOperatorAccount(
  supabase: ReturnType<typeof createClient>,
  userId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from('learners')
    .select('platform_role')
    .eq('user_id', userId)
    .maybeSingle()
  return (data as { platform_role?: string | null } | null)?.platform_role === 'ssi_admin'
}
