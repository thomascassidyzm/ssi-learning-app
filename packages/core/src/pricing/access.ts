/**
 * Course Access Control
 *
 * Determines user access to courses based on:
 * - Course pricing tier (free | premium | community)
 * - User subscription status
 * - Belt-based preview limits for premium courses
 */

import type {
  CourseWithPricing,
  CourseAccessResult,
  UserSubscriptionStatus,
  CoursePricingTier,
} from './types';
import {
  PREMIUM_PREVIEW_BELT,
  PREMIUM_PREVIEW_MAX_SEED,
} from './types';

/**
 * Check what access a user has to a specific course
 *
 * Access rules:
 * 1. Community courses: Always full access (free forever)
 * 2. Free tier courses: Always full access (endangered languages)
 * 3. Premium courses with subscription: Full access
 * 4. Premium courses without subscription: Preview through Yellow Belt (seed 19)
 *
 * @param course - Course with pricing metadata
 * @param subscription - User's subscription status
 * @returns CourseAccessResult with access level and reason
 */
export function checkCourseAccess(
  course: Pick<CourseWithPricing, 'pricing_tier' | 'is_community'>,
  subscription: UserSubscriptionStatus | null
): CourseAccessResult {
  // Community courses are always free
  if (course.is_community || course.pricing_tier === 'community') {
    return {
      canAccess: true,
      canPreview: true,
      reason: 'community',
      upgradeRequired: false,
    };
  }

  // Free tier courses are always accessible
  if (course.pricing_tier === 'free') {
    return {
      canAccess: true,
      canPreview: true,
      reason: 'free',
      upgradeRequired: false,
    };
  }

  // Premium course - check subscription
  const isSubscribed = subscription?.isActive && subscription?.tier === 'paid';

  if (isSubscribed) {
    return {
      canAccess: true,
      canPreview: true,
      reason: 'subscribed',
      upgradeRequired: false,
    };
  }

  // Not subscribed - preview through Yellow Belt only
  return {
    canAccess: false,
    canPreview: true,
    previewBeltLimit: PREMIUM_PREVIEW_BELT,
    previewMaxSeed: PREMIUM_PREVIEW_MAX_SEED,
    reason: 'preview_only',
    upgradeRequired: true,
  };
}

/**
 * Check if a user can access a specific seed in a course
 *
 * @param course - Course with pricing metadata
 * @param subscription - User's subscription status
 * @param seedNumber - The seed number to check (1-based)
 * @returns true if user can access this seed
 */
export function canAccessSeed(
  course: Pick<CourseWithPricing, 'pricing_tier' | 'is_community'>,
  subscription: UserSubscriptionStatus | null,
  seedNumber: number
): boolean {
  const access = checkCourseAccess(course, subscription);

  // Full access - can access any seed
  if (access.canAccess) {
    return true;
  }

  // Preview mode - check if seed is within preview limit
  if (access.canPreview && access.previewMaxSeed) {
    return seedNumber <= access.previewMaxSeed;
  }

  return false;
}

/**
 * Get the upgrade prompt message for a course
 *
 * @param pricingTier - The course's pricing tier
 * @returns Upgrade prompt message or null if no upgrade needed
 */
export function getUpgradePrompt(
  pricingTier: CoursePricingTier
): string | null {
  if (pricingTier === 'premium') {
    return 'Upgrade to continue learning beyond Yellow Belt';
  }
  return null;
}

/**
 * Determine course pricing tier from language codes
 * Used for backwards compatibility when database fields aren't available
 *
 * @param targetLang - Target language code (3-letter)
 * @param courseCode - Course code (may have 'community_' prefix)
 * @returns The appropriate pricing tier
 */
export function inferPricingTier(
  targetLang: string,
  courseCode: string
): CoursePricingTier {
  // Community prefix takes precedence
  if (courseCode.startsWith('community_')) {
    return 'community';
  }

  // Big 10 languages are premium
  const BIG_10 = ['eng', 'spa', 'fra', 'deu', 'ita', 'por', 'zho', 'jpn', 'ara', 'kor'];
  if (BIG_10.includes(targetLang)) {
    return 'premium';
  }

  // Everything else is free (endangered languages)
  return 'free';
}
