/**
 * Pricing Constants
 *
 * SSi pricing model is based on USER subscription tier, not per-course.
 * - Free tier: Access ALL courses with non-Big-10 target languages
 * - Paid tier: Access Big 10 target languages too
 *
 * Community courses are ALWAYS free regardless of language.
 */

/**
 * The "Big 10" languages that require a paid subscription
 * These are the most commercially valuable target languages.
 *
 * If the course TARGET language is in this list, user needs paid tier.
 * If user only learns non-Big-10 targets, they get full access on free tier.
 */
export const BIG_10_LANGUAGES = [
  'eng', // English
  'spa', // Spanish
  'fra', // French
  'deu', // German
  'ita', // Italian
  'por', // Portuguese
  'zho', // Chinese (Mandarin)
  'jpn', // Japanese
  'ara', // Arabic
  'kor', // Korean
] as const;

export type Big10Language = typeof BIG_10_LANGUAGES[number];

/**
 * Check if a language code is in the Big 10
 */
export function isBig10Language(langCode: string): boolean {
  return (BIG_10_LANGUAGES as readonly string[]).includes(langCode);
}

/**
 * User subscription tier
 */
export type SubscriptionTier = 'free' | 'paid';

/**
 * Course type for pricing decisions
 */
export type CourseType = 'official' | 'community';

/**
 * Check if a user can access a course based on their subscription tier
 *
 * Rules:
 * - Community courses are ALWAYS accessible (free forever)
 * - If target language is NOT in Big 10, course is accessible on free tier
 * - If target language IS in Big 10, user needs paid tier
 *
 * @param user User with subscription_tier
 * @param course Course with target_lang and optional course_type
 * @returns true if user can access the course
 */
export function canAccessCourse(
  user: { subscription_tier: SubscriptionTier },
  course: { target_lang: string; course_type?: CourseType }
): boolean {
  // Community courses are always free
  if (course.course_type === 'community') {
    return true;
  }

  // Check if target language requires paid subscription
  const requiresPaid = isBig10Language(course.target_lang);

  if (!requiresPaid) {
    return true; // Non-Big-10 targets are free for everyone
  }

  return user.subscription_tier === 'paid';
}

/**
 * Get display text for course access
 * Used in UI to show lock status or upgrade prompts
 */
export function getCourseAccessStatus(
  user: { subscription_tier: SubscriptionTier },
  course: { target_lang: string; course_type?: CourseType }
): 'free' | 'locked' | 'accessible' {
  if (course.course_type === 'community') {
    return 'free';
  }

  const requiresPaid = isBig10Language(course.target_lang);

  if (!requiresPaid) {
    return 'free';
  }

  return user.subscription_tier === 'paid' ? 'accessible' : 'locked';
}
