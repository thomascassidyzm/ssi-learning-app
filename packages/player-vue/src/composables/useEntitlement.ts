/**
 * useEntitlement - Course access and download entitlements
 *
 * Two concerns handled here:
 * 1. **Course Access**: Can user access course content (and how much)?
 *    - Community/free courses: Full access
 *    - Premium courses: Free through Yellow Belt, then requires subscription
 *
 * 2. **Download Entitlement**: Can user download for offline use?
 *    - Free users: Auto-prefetch ~30 minutes ahead
 *    - Paid users: Full course download
 *
 * Access is checked at playback; entitlement is checked before caching.
 */

import { ref, computed, inject, type Ref, type ComputedRef } from 'vue'
import { useSharedSubscription } from './useSubscription'
import type { CoursePricingTier } from '@ssi/core'
import {
  checkCourseAccess,
  inferPricingTier,
  PREMIUM_PREVIEW_MAX_SEED,
  type CourseAccessResult,
} from '@ssi/core'

// ============================================================================
// TYPES
// ============================================================================

export interface EntitlementStatus {
  /** Can user download for offline use? */
  canDownload: boolean
  /** Is user authenticated? */
  isAuthenticated: boolean
  /** Does user have paid subscription? */
  isPaidUser: boolean
  /** Course-specific entitlement */
  courseEntitlement: 'free' | 'paid' | 'community'
  /** Maximum hours user can download (paid users get more) */
  maxDownloadHours: number
}

export interface CourseInfo {
  course_code: string
  target_lang?: string
  pricing_tier?: CoursePricingTier
  is_community?: boolean
}

export interface UseEntitlementReturn {
  /** Current entitlement status (for downloads) */
  entitlement: Ref<EntitlementStatus>
  /** Whether user can download this course */
  canDownload: ComputedRef<boolean>
  /** Maximum download hours allowed */
  maxDownloadHours: ComputedRef<number>
  /** Check entitlement for a course (legacy - for downloads) */
  checkEntitlement: (courseId: string, courseInfo?: CourseInfo) => Promise<EntitlementStatus>
  /** Refresh entitlement (e.g., after purchase) */
  refreshEntitlement: () => Promise<void>

  // New access control methods
  /** Check course access (for content gating) */
  checkCourseAccess: (course: CourseInfo) => CourseAccessResult
  /** Check if user can access a specific seed */
  canAccessSeed: (course: CourseInfo, seedNumber: number) => boolean
  /** Get preview limit for premium courses */
  getPreviewLimit: () => number
}

// ============================================================================
// CONSTANTS
// ============================================================================

/** Free users can auto-prefetch this many minutes ahead */
export const FREE_PREFETCH_MINUTES = 30

/** Paid users can download this many hours */
export const PAID_DOWNLOAD_HOURS = 10

/** Community courses are always free to download */
export const COMMUNITY_DOWNLOAD_HOURS = 10

// ============================================================================
// COMPOSABLE
// ============================================================================

export function useEntitlement(): UseEntitlementReturn {
  // Get auth from app context
  const auth = inject<{ isAuthenticated: Ref<boolean>; learnerId: Ref<string | null> } | null>('auth', null)

  // Get subscription status
  const { isSubscribed: hasActiveSubscription } = useSharedSubscription()

  // Entitlement state
  const entitlement = ref<EntitlementStatus>({
    canDownload: false,
    isAuthenticated: false,
    isPaidUser: false,
    courseEntitlement: 'free',
    maxDownloadHours: 0,
  })

  // Current course being checked
  const currentCourseId = ref<string | null>(null)
  const currentCourseInfo = ref<CourseInfo | null>(null)

  // ============================================================================
  // COMPUTED
  // ============================================================================

  const canDownload = computed(() => entitlement.value.canDownload)
  const maxDownloadHours = computed(() => entitlement.value.maxDownloadHours)

  // ============================================================================
  // SUBSCRIPTION HELPERS
  // ============================================================================

  /**
   * Get subscription status for access checks
   */
  function getSubscriptionStatus() {
    const isPaid = hasActiveSubscription.value || checkDevPaidStatus()
    return {
      isActive: isPaid,
      tier: isPaid ? 'paid' as const : 'free' as const,
    }
  }

  /**
   * Check localStorage dev flag for testing
   */
  function checkDevPaidStatus(): boolean {
    try {
      return localStorage.getItem('ssi-dev-paid-user') === 'true'
    } catch {
      return false
    }
  }

  // ============================================================================
  // ACCESS CONTROL (new - database-driven)
  // ============================================================================

  /**
   * Check course access using database pricing_tier or inferred tier
   *
   * @param course - Course with pricing info (from database or inferred)
   * @returns CourseAccessResult with access level and reason
   */
  function checkAccess(course: CourseInfo): CourseAccessResult {
    // Use database pricing_tier if available, otherwise infer from course code
    const pricingTier = course.pricing_tier
      ?? inferPricingTier(course.target_lang ?? '', course.course_code)

    const isCommunity = course.is_community ?? course.course_code.startsWith('community_')

    const courseWithPricing = {
      pricing_tier: pricingTier,
      is_community: isCommunity,
    }

    const subscription = getSubscriptionStatus()
    return checkCourseAccess(courseWithPricing, subscription)
  }

  /**
   * Check if user can access a specific seed
   *
   * @param course - Course info
   * @param seedNumber - Seed number (1-based)
   * @returns true if user can access this seed
   */
  function canAccessSeedCheck(course: CourseInfo, seedNumber: number): boolean {
    const access = checkAccess(course)

    // Full access
    if (access.canAccess) {
      return true
    }

    // Preview mode - check limit
    if (access.canPreview && access.previewMaxSeed) {
      return seedNumber <= access.previewMaxSeed
    }

    return false
  }

  /**
   * Get the preview limit (max seed for free preview)
   */
  function getPreviewLimit(): number {
    return PREMIUM_PREVIEW_MAX_SEED
  }

  // ============================================================================
  // DOWNLOAD ENTITLEMENT (legacy interface - still needed for offline)
  // ============================================================================

  /**
   * Check download entitlement for a specific course.
   *
   * Entitlement logic:
   * 1. Community courses: Always free to download
   * 2. Paid user: Full download access
   * 3. Free user: Limited prefetch only (no explicit download)
   */
  async function checkEntitlement(
    courseId: string,
    courseInfo?: CourseInfo
  ): Promise<EntitlementStatus> {
    currentCourseId.value = courseId
    currentCourseInfo.value = courseInfo ?? { course_code: courseId }
    const isAuthenticated = auth?.isAuthenticated.value ?? false

    // Use new access check to determine entitlement
    const access = checkAccess(currentCourseInfo.value)

    // Map access result to entitlement
    if (access.reason === 'community') {
      entitlement.value = {
        canDownload: true,
        isAuthenticated,
        isPaidUser: false,
        courseEntitlement: 'community',
        maxDownloadHours: COMMUNITY_DOWNLOAD_HOURS,
      }
    } else if (access.reason === 'free') {
      // Free tier courses - full download access
      entitlement.value = {
        canDownload: true,
        isAuthenticated,
        isPaidUser: false,
        courseEntitlement: 'free',
        maxDownloadHours: COMMUNITY_DOWNLOAD_HOURS,
      }
    } else if (access.reason === 'subscribed') {
      // Paid user - full access
      entitlement.value = {
        canDownload: true,
        isAuthenticated,
        isPaidUser: true,
        courseEntitlement: 'paid',
        maxDownloadHours: PAID_DOWNLOAD_HOURS,
      }
    } else {
      // Preview only - no explicit download, just prefetch
      entitlement.value = {
        canDownload: false,
        isAuthenticated,
        isPaidUser: false,
        courseEntitlement: 'free',
        maxDownloadHours: 0,
      }
    }

    return entitlement.value
  }

  /**
   * Refresh entitlement (e.g., after user upgrades)
   */
  async function refreshEntitlement(): Promise<void> {
    if (currentCourseId.value) {
      await checkEntitlement(currentCourseId.value, currentCourseInfo.value ?? undefined)
    }
  }

  // ============================================================================
  // RETURN
  // ============================================================================

  return {
    // Download entitlement (legacy)
    entitlement,
    canDownload,
    maxDownloadHours,
    checkEntitlement,
    refreshEntitlement,

    // Access control (new)
    checkCourseAccess: checkAccess,
    canAccessSeed: canAccessSeedCheck,
    getPreviewLimit,
  }
}

export type EntitlementComposable = ReturnType<typeof useEntitlement>
