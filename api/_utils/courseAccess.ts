/**
 * Server-side course access resolution
 *
 * The one place that decides whether a request to a course-content endpoint
 * (bundle, cycles, infplay-cycles, ...) gets full content or the free-preview
 * slice. Reuses the same `checkCourseAccess` decision table the client uses
 * (`@ssi/core` pricing module) so server and client never disagree about what
 * "preview" means — the server is just the authoritative version of the same
 * check, done with real subscription/entitlement data instead of optimistic
 * client-side state.
 *
 * Free / community courses never touch auth — full content for everyone.
 * Premium courses require a valid Supabase Auth token to unlock full access;
 * anonymous or unsubscribed callers get `checkCourseAccess`'s preview-only
 * result (canAccess: false, previewMaxSeed set), never a hard 401 — content
 * endpoints use this to slice the response down, not to reject it, so the
 * legitimate free-preview experience keeps working.
 */

import type { VercelRequest } from '@vercel/node'
import type { SupabaseClient } from '@supabase/supabase-js'
import { verifyAuthToken } from './auth'
import { resolveEffectiveSubscription } from './familyAccess'
import { resolveActiveEntitlements } from './resolveEntitlements'
import {
  checkCourseAccess,
  inferPricingTier,
  type CourseAccessResult,
  type CoursePricingTier,
  type UserSubscriptionStatus,
  type UserEntitlement,
} from '../../packages/core/src/pricing'

export interface CourseAccessInput {
  course_code: string
  pricing_tier: string | null | undefined
  is_community: boolean | null | undefined
  target_lang?: string | null
}

/**
 * Resolve the caller's access to a course, querying subscription/entitlement
 * state fresh from the DB (never trusting client-supplied flags).
 */
export async function resolveServerCourseAccess(
  req: VercelRequest,
  supabase: SupabaseClient,
  course: CourseAccessInput,
): Promise<CourseAccessResult> {
  const pricingTier: CoursePricingTier =
    (course.pricing_tier as CoursePricingTier | null | undefined) ??
    inferPricingTier(course.target_lang ?? '', course.course_code)
  const isCommunity = course.is_community ?? course.course_code.startsWith('community_')

  const courseWithPricing = {
    course_code: course.course_code,
    pricing_tier: pricingTier,
    is_community: isCommunity,
  }

  // Free/community: never gated, no need to touch auth at all.
  if (isCommunity || pricingTier === 'community' || pricingTier === 'free') {
    return checkCourseAccess(courseWithPricing, null)
  }

  const authResult = await verifyAuthToken(req)
  if (!authResult.valid || !authResult.userId) {
    // No/invalid token on a premium course — falls through to
    // checkCourseAccess's preview-only branch (never a full unlock).
    return checkCourseAccess(courseWithPricing, { isActive: false, tier: 'free' })
  }

  const { data: learner } = await supabase
    .from('learners')
    .select('id, platform_role, educational_role')
    .eq('user_id', authResult.userId)
    .maybeSingle()

  const platformRole =
    learner?.platform_role === 'ssi_admin' || learner?.educational_role === 'god'
      ? 'ssi_admin'
      : (learner?.platform_role ?? null)

  let subscription: UserSubscriptionStatus = { isActive: false, tier: 'free' }
  let entitlements: UserEntitlement[] = []

  if (learner?.id) {
    const subResult = await resolveEffectiveSubscription(supabase, learner.id, 'status, current_period_end')

    if (subResult.sub) {
      const isActive =
        subResult.sub.status === 'active' &&
        (!subResult.sub.current_period_end || new Date(subResult.sub.current_period_end) > new Date())
      subscription = { isActive, tier: isActive ? 'paid' : 'free' }
    }

    // ENTITLEMENT SCOPE (Tom, 2026-09-10): an INSTITUTION seat — behind a
    // class or a staff membership, funded by the org — plays the languages the
    // institution licenses; a £5 payment from ANY learner opens all courses,
    // all languages. The paid check above answers the second half. The first
    // half lives in the coverage layers of resolveEntitlements.ts — class,
    // org, school-staff — which this gate did NOT consult until today: it read
    // only stored rows and the entitlement_grants cascade, and a self-serve
    // school writes no grant (provision.ts), so an institution seat was
    // sliced to the free preview here while the player said it could play.
    // One resolver, same as /api/entitlement/user and the admin view, so the
    // gate and the player can never disagree about one account.
    const active = await resolveActiveEntitlements(supabase, authResult.userId, learner.id)
    entitlements = active.map((e) => ({
      accessType: e.access_type as UserEntitlement['accessType'],
      grantedCourses: e.granted_courses,
      expiresAt: e.expires_at,
    }))
  }

  return checkCourseAccess(courseWithPricing, subscription, entitlements, platformRole)
}
