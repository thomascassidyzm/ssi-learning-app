/**
 * Pricing module exports
 */

// Legacy exports (still used by some components)
export {
  type SubscriptionTier,
  type CourseType,
  canAccessCourse,
} from './constants';

// New visibility/pricing types and access control
export {
  type CourseVisibility,
  type CoursePricingTier,
  type BeltColor,
  type CourseWithPricing,
  type CourseAccessResult,
  type UserSubscriptionStatus,
  type UserEntitlement,
  PREMIUM_PREVIEW_MAX_SEED,
} from './types';

export {
  checkCourseAccess,
  canAccessSeed,
  inferPricingTier,
} from './access';
