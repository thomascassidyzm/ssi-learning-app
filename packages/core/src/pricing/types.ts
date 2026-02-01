/**
 * Course Visibility and Pricing Types
 *
 * Types for the course access control system that supports:
 * - Community courses: Always visible, always free
 * - Premium courses: Initially hidden, then visible with Yellow Belt free preview
 * - Free courses: Visible and free (non-Big-10 endangered languages)
 */

/**
 * Course visibility determines who can see the course in listings
 * - public: visible to all users
 * - hidden: only visible to admins (used for premium at launch)
 * - beta: visible but marked as beta testing
 */
export type CourseVisibility = 'public' | 'hidden' | 'beta';

/**
 * Pricing tier determines access rules
 * - free: always free for everyone (endangered languages)
 * - premium: free through Yellow Belt (seed 19), then requires subscription
 * - community: always free (community-created courses)
 */
export type CoursePricingTier = 'free' | 'premium' | 'community';

/**
 * Belt max seed thresholds for course progression
 * Maps belt color to the maximum seed number for that belt
 * Yellow Belt threshold is the free preview limit for premium courses
 */
export const BELT_MAX_SEEDS = {
  white: 7,    // Seeds 1-7
  yellow: 19,  // Seeds 8-19
  orange: 39,  // Seeds 20-39
  green: 79,   // Seeds 40-79
  blue: 149,   // Seeds 80-149
  purple: 279, // Seeds 150-279
  brown: 399,  // Seeds 280-399
  black: Infinity, // Seeds 400+
} as const;

export type BeltColor = keyof typeof BELT_MAX_SEEDS;

/**
 * The belt at which premium preview ends
 * After completing Yellow Belt (seed 19), subscription required
 */
export const PREMIUM_PREVIEW_BELT: BeltColor = 'yellow';
export const PREMIUM_PREVIEW_MAX_SEED = BELT_MAX_SEEDS[PREMIUM_PREVIEW_BELT];

/**
 * Course metadata with visibility and pricing fields
 * Extends the base course info from the database
 */
export interface CourseWithPricing {
  course_code: string;
  known_lang: string;
  target_lang: string;
  display_name?: string;

  /** Course visibility (public | hidden | beta) */
  visibility: CourseVisibility;

  /** Pricing tier (free | premium | community) */
  pricing_tier: CoursePricingTier;

  /** Whether this is a community-created course */
  is_community: boolean;

  /** When the course was made public */
  released_at?: string | null;

  /** Display order in course selector */
  featured_order?: number | null;
}

/**
 * Result of checking course access for a user
 */
export interface CourseAccessResult {
  /** Whether user has full access to all content */
  canAccess: boolean;

  /** Whether user can preview the course (at least through preview limit) */
  canPreview: boolean;

  /** The belt at which preview ends (for premium courses) */
  previewBeltLimit?: BeltColor;

  /** Maximum seed number accessible in preview mode */
  previewMaxSeed?: number;

  /** Reason for the access level */
  reason: 'free' | 'community' | 'subscribed' | 'preview_only';

  /** Whether an upgrade prompt should be shown */
  upgradeRequired: boolean;
}

/**
 * User subscription status from Clerk metadata
 */
export interface UserSubscriptionStatus {
  /** Whether user has an active subscription */
  isActive: boolean;

  /** Subscription tier */
  tier: 'free' | 'paid';

  /** When subscription expires (if any) */
  expiresAt?: string | null;

  /** Source of subscription */
  source?: 'stripe' | 'gift' | 'government' | 'admin_grant';
}
