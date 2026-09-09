/**
 * The ONE resolver for "what can this account actually play".
 *
 * Extracted 2026-09-09 (founder report, Chepstow) because two admin screens
 * disagreed about the same teacher: the user LIST tagged her "School" from her
 * `educational_role`, while the DETAIL page read the raw `user_entitlements`
 * table straight from the browser and said DEFAULT / no entitlements. Neither
 * asked the question the PLAYER asks, and the player's answer is the only one
 * that decides what she hears — three of its four layers (the cascade RPC,
 * class coverage, org coverage) are DERIVED and have no row to read.
 *
 * So the resolution lives here, `api/entitlement/user.ts` serves it to the
 * account itself, and `api/admin/effective-access.ts` serves it to an admin
 * looking at that account. One derivation, two callers, no drift.
 *
 * Every derived layer is additive and individually fail-soft: a broken cascade
 * must never cost a learner the entitlements they hold in a row.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveClassCourseCoverage } from './classCoverage'
import { resolveOrgCourseCoverage } from './orgCoverage'
import { resolveSchoolStaffCourseCoverage } from './schoolCoverage'

export interface ResolvedEntitlement {
  id: string
  access_type: string
  granted_courses: string[] | null
  expires_at: string | null
  redeemed_at: string | null
  entitlement_code_id: string | null
}

/**
 * Resolve every ACTIVE entitlement for `authUid` (which MUST come from a
 * verified JWT, or from an admin-verified lookup of the target account).
 *
 * Layer 1 — stored `user_entitlements` rows, expired ones filtered out.
 * Layer 2 — the group → school → class cascade RPC.
 * Layer 3 — class coverage: the course of a class you are in, as student or
 *           teacher, while that class's school has live platform coverage.
 * Layer 4 — org coverage: every live course while your org has coverage.
 * Layer 5 — school-staff coverage: the courses YOUR SCHOOL has cover for, on
 *           YOUR SCHOOL'S OWN CLOCK, because you are its admin or one of its
 *           teachers, whether or not you hold a class (founder ruling
 *           2026-09-09). The only layer that carries an expiry, because it is
 *           the school's date, not one minted for the person.
 */
export async function resolveActiveEntitlements(
  supabase: SupabaseClient,
  authUid: string,
  learnerId: string,
): Promise<ResolvedEntitlement[]> {
  const { data: entitlements, error } = await supabase
    .from('user_entitlements')
    .select('id, access_type, granted_courses, expires_at, redeemed_at, entitlement_code_id')
    .eq('learner_id', learnerId)
  if (error) throw new Error(error.message)

  const now = new Date()
  const active: ResolvedEntitlement[] = ((entitlements || []) as ResolvedEntitlement[]).filter((e) => {
    if (!e.expires_at) return true // lifetime
    return new Date(e.expires_at) > now
  })

  try {
    const { data: cascadeCourses } = await supabase.rpc('get_cascade_courses', { p_user_id: authUid })
    if (cascadeCourses && cascadeCourses.length > 0) {
      active.push(derived('cascade', cascadeCourses))
    }
  } catch (cascadeErr) {
    console.error('[resolveEntitlements] Cascade error (non-fatal):', cascadeErr)
  }

  try {
    const classCourses = await resolveClassCourseCoverage(supabase, authUid)
    if (classCourses.length > 0) active.push(derived('class-coverage', classCourses))
  } catch (classCoverageErr) {
    console.error('[resolveEntitlements] Class-coverage error (non-fatal):', classCoverageErr)
  }

  try {
    const orgCourses = await resolveOrgCourseCoverage(supabase, authUid)
    if (orgCourses.length > 0) active.push(derived('org-coverage', orgCourses))
  } catch (orgCoverageErr) {
    console.error('[resolveEntitlements] Org-coverage error (non-fatal):', orgCoverageErr)
  }

  try {
    const staff = await resolveSchoolStaffCourseCoverage(supabase, authUid)
    if (staff.courses.length > 0) {
      active.push(derived('school-membership', staff.courses, staff.expiresAt))
    }
  } catch (schoolCoverageErr) {
    console.error('[resolveEntitlements] School-staff-coverage error (non-fatal):', schoolCoverageErr)
  }

  return active
}

/** The synthetic entitlement a derived layer contributes. Never a stored row. */
function derived(id: string, courses: string[], expiresAt: string | null = null): ResolvedEntitlement {
  return {
    id,
    access_type: 'courses',
    granted_courses: courses,
    // Derived layers are open-ended by default: they are recomputed on every
    // check, so there is nothing for a date to protect. School-staff coverage
    // is the exception — it reports the SCHOOL'S window, so the account can be
    // told when its access ends by the same row that grants it.
    expires_at: expiresAt,
    redeemed_at: null,
    entitlement_code_id: null,
  }
}

/** True for the synthetic ids above — the rows an admin cannot revoke. */
export function isDerivedEntitlementId(id: string): boolean {
  return (
    id === 'cascade' || id === 'class-coverage' || id === 'org-coverage' || id === 'school-membership'
  )
}
