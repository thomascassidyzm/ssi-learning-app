/**
 * Pricing module exports
 */

// Legacy exports (still used by some components)
export {
  BIG_10_LANGUAGES,
  type Big10Language,
  type SubscriptionTier,
  type CourseType,
  isBig10Language,
  canAccessCourse,
  getCourseAccessStatus,
} from './constants';

// New visibility/pricing types and access control
export {
  type CourseVisibility,
  type CoursePricingTier,
  type BeltColor,
  type CourseWithPricing,
  type CourseAccessResult,
  type UserSubscriptionStatus,
  BELT_MAX_SEEDS,
  PREMIUM_PREVIEW_BELT,
  PREMIUM_PREVIEW_MAX_SEED,
} from './types';

export {
  checkCourseAccess,
  canAccessSeed,
  getUpgradePrompt,
  inferPricingTier,
} from './access';
