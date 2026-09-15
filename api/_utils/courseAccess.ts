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
import { resolveActiveEntitlements, type ResolvedEntitlement } from './resolveEntitlements'
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
    // ONE resolver for "what can this account play" (api/_utils/resolveEntitlements.ts):
    // stored rows, the cascade RPC, class coverage, org coverage and
    // school-staff coverage. This gate used to read only the first two, so a
    // teacher whom /api/entitlement/user told "you hold cym_s_for_eng through
    // your class" was then served the preview-only bundle and a 403 on every
    // cycle past Yellow — and, with her saved LEGO missing from the preview
    // round map, the player fell back to the start of the course with no wall
    // at all (job #745 probe, 2026-09-14; Tom's Y7 Welsh case). The player's
    // gate and the account's own entitlement list now cannot disagree.
    // Fail-soft: a resolver error is preview-only for this request, never a
    // full unlock — and never a 500 for a free-preview caller.
    const [subResult, resolved] = await Promise.all([
      resolveEffectiveSubscription(supabase, learner.id, 'status, current_period_end, provider, provider_subscription_id'),
      resolveActiveEntitlements(supabase, authResult.userId, learner.id).catch((err) => {
        console.error('[courseAccess] entitlement resolution failed (preview-only for this request):', err)
        return [] as ResolvedEntitlement[]
      }),
    ])

    let grantOwnsSubscription = false
    if (subResult.sub && !subResult.viaFamily && subResult.sub.provider === 'paddle') {
      const { data: grant, error: grantError } = await supabase.from('user_entitlements')
        .select('id').eq('source', 'paddle')
        .eq('source_ref', subResult.sub.provider_subscription_id).maybeSingle()
      // Once migrated, only the grant's active window can open this door.
      // Legacy subscribers still use the old path until their grant exists.
      grantOwnsSubscription = !!grant || !!grantError
    }
    if (subResult.sub && !grantOwnsSubscription) {
      const isActive =
        subResult.sub.status === 'active' &&
        (!subResult.sub.current_period_end || new Date(subResult.sub.current_period_end) > new Date())
      subscription = { isActive, tier: isActive ? 'paid' : 'free' }
    }

    entitlements = resolved.map((e) => ({
      accessType: e.access_type as UserEntitlement['accessType'],
      grantedCourses: e.granted_courses,
      expiresAt: e.expires_at,
    }))
  }

  return checkCourseAccess(courseWithPricing, subscription, entitlements, platformRole)
}
