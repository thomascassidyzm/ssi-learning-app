/**
 * Class-course entitlement — MAY THIS NODE OPEN A CLASS ON THIS COURSE?
 *
 * THE HOLE THIS CLOSES (found 2026-09-10). A class's course_code is not
 * decoration: resolveClassCourseCoverage (classCoverage.ts) hands every
 * student tagged into a class that class's course_code, in full, for as long
 * as the class's school has live platform cover — and it never asks whether
 * the school had cover FOR THAT COURSE. Nothing on the write side asked
 * either. So a leader could create a school through api/govt/create-school.ts
 * (no course named → the heritage default, a 365-day platform trial from
 * trialPolicy.ts), open a class on a premium Big-10 course, and every student
 * in it played a paid course free for a year with no payment anywhere.
 *
 * THE RULE, and it is the settled commercial model rather than a new one —
 * the same ladder schoolCoverage.ts resolves staff cover with, read on the
 * write side:
 *
 *   1. A HERITAGE course (Welsh + the non-commercial minority languages) is
 *      always allowed. Premium-ness comes from isCommercialCourse
 *      (@ssi/core/pricing), the single premium-ness source — see
 *      trialPolicy.ts. There is no revenue at stake and a heritage class is
 *      exactly what a 365-day heritage trial is for, so this check refuses
 *      nothing that was ever free.
 *   2. A PREMIUM course needs one of, and nothing else:
 *      · the school is PAID (`platform_status` 'active') — a subscribed
 *        school is not language-locked, so it gets the whole catalogue;
 *      · the school's recorded `trial_course_code` IS that course — the one
 *        premium language it is genuinely trialling, on the 30-day clock
 *        provision.ts stamped for it;
 *      · a live `entitlement_grants` row on the school/group names it — the
 *        admin-granted path (api/entitlement/grant.ts) still cascades through
 *        get_cascade_courses, so a granted course is genuinely paid for;
 *      · on a CLASS-LESS group/org node, the nearest ancestor org carrying a
 *        platform status is live — the org trial is all-languages by founder
 *        ruling (2026-08-01), and it is 30 days, not 365.
 *
 * A SCHOOL NODE DELIBERATELY DOES NOT INHERIT ITS ANCESTOR ORG'S COVER here.
 * What a school's students play is decided by the SCHOOL's own row
 * (classCoverage.ts reads schools.platform_*), so letting a school borrow its
 * parent org's 30-day all-language trial to open a premium class would grant
 * that course on the school's own 365-day clock — the very hole above, one
 * level up.
 *
 * FAILS CLOSED ON A REFUSAL, OPEN ONLY ON A MISSING SCHEMA. Every other
 * platform-trial helper fails open because it is bookkeeping; this is a gate,
 * so a read it cannot complete is `unverifiable` (the caller answers 500)
 * rather than a silent yes. The one exception is the established one: if the
 * platform columns are absent (migration unapplied — isMissingPlatformSchema)
 * the gate no-ops, exactly as orgPlatform.ts and schoolPlatformTrial.ts do,
 * so an un-migrated database keeps working.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { isPlatformActive } from './platformStatus'
import { isMissingPlatformSchema } from './schoolPlatformTrial'
import { isCommercialCourse } from '../../packages/core/src/pricing'

/** Depth cap on the ancestry walk — a guard against a cyclic parent_id, not a real depth limit. */
const MAX_ANCESTRY_DEPTH = 24

export interface ClassCourseVerdict {
  allowed: boolean
  /** Learner-facing refusal, absent when allowed. */
  error?: string
  /** HTTP status the caller should answer with: 403 refusal, 500 unverifiable. */
  status?: 403 | 500
  /** True on a refusal a subscription would lift — the same flag provision.ts's 409 carries. */
  requiresCheckout?: boolean
}

const ALLOWED: ClassCourseVerdict = { allowed: true }

const REFUSED: ClassCourseVerdict = {
  allowed: false,
  status: 403,
  requiresCheckout: true,
  error: 'That course is not covered by this subscription. Subscribe to add it, or pick a course you already have.',
}

const UNVERIFIABLE: ClassCourseVerdict = {
  allowed: false,
  status: 500,
  error: 'Could not verify the course entitlement for this school',
}

/** A live `entitlement_grants` row on this node naming the course. */
async function grantCoversCourse(
  svc: SupabaseClient,
  column: 'school_id' | 'group_id',
  id: string,
  courseCode: string,
): Promise<boolean> {
  const { data } = await svc.from('entitlement_grants').select('granted_courses, expires_at').eq(column, id)
  const now = Date.now()
  for (const grant of (data ?? []) as any[]) {
    const expiry = grant?.expires_at
    if (expiry && new Date(expiry).getTime() <= now) continue
    if (Array.isArray(grant?.granted_courses) && grant.granted_courses.includes(courseCode)) return true
  }
  return false
}

/**
 * Walk up from a group node to the NEAREST ancestor carrying a platform
 * status, and report whether it is live. Same rule as orgCoverage.ts's
 * activeAncestorOrgWindow: a node with no status is not the billed node, so
 * keep climbing; a node WITH one answers for its whole subtree, live or not.
 */
async function nearestOrgIsLive(
  svc: SupabaseClient,
  groupId: string,
): Promise<{ live: boolean; schemaUnavailable?: boolean }> {
  const seen = new Set<string>([groupId])
  let current: string | null = groupId

  for (let depth = 0; depth < MAX_ANCESTRY_DEPTH && current; depth++) {
    const { data, error } = await svc
      .from('groups')
      .select('id, parent_id, platform_status, platform_expires_at, created_at')
      .eq('id', current)
      .maybeSingle()
    if (error) {
      if (isMissingPlatformSchema(error)) return { live: false, schemaUnavailable: true }
      return { live: false }
    }
    const row = data as any
    if (!row) return { live: false }
    if (row.platform_status) {
      return { live: isPlatformActive(row.platform_status, row.platform_expires_at, row.created_at) }
    }
    const parent = row.parent_id as string | null
    if (!parent || seen.has(parent)) return { live: false }
    seen.add(parent)
    current = parent
  }
  return { live: false }
}

/**
 * May a class be created on `courseCode` under this node? `schoolId` is the
 * school whose row will carry the class (null on a plain group node),
 * `groupId` the node the class is being created on.
 */
export async function checkClassCourseEntitlement(
  svc: SupabaseClient,
  { schoolId, groupId, courseCode }: { schoolId?: string | null; groupId?: string | null; courseCode: string },
): Promise<ClassCourseVerdict> {
  // Heritage courses are free to teach and always were — rule 1.
  if (!isCommercialCourse({ course_code: courseCode })) return ALLOWED

  if (schoolId) {
    const { data, error } = await svc
      .from('schools')
      .select('platform_status, trial_course_code')
      .eq('id', schoolId)
      .maybeSingle()
    if (error) return isMissingPlatformSchema(error) ? ALLOWED : UNVERIFIABLE
    const school = data as { platform_status?: string | null; trial_course_code?: string | null } | null
    if (!school) return UNVERIFIABLE

    if (school.platform_status === 'active') return ALLOWED
    if (school.trial_course_code === courseCode) return ALLOWED
    if (await grantCoversCourse(svc, 'school_id', schoolId, courseCode)) return ALLOWED
    return REFUSED
  }

  if (groupId) {
    if (await grantCoversCourse(svc, 'group_id', groupId, courseCode)) return ALLOWED
    const org = await nearestOrgIsLive(svc, groupId)
    if (org.schemaUnavailable) return ALLOWED
    return org.live ? ALLOWED : REFUSED
  }

  return REFUSED
}
