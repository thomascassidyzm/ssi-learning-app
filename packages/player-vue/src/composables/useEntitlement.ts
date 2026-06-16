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
import { useSharedUserEntitlements } from './useUserEntitlements'
import { useUserRole } from './useUserRole'
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
  known_lang?: string
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
  /** Can the user START an offline download? Open to everyone — the 30-day lease
   *  governs longevity (renews for payers, a one-off taste otherwise). */
  canDownloadOffline: (course: CourseInfo) => boolean
  /** Does this user's offline access RENEW (active sub / full or course
   *  entitlement / admin)? False = a non-payer on the 30-day offline taste. */
  offlineRenews: (course: CourseInfo) => boolean
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

  // Get user entitlements from entitlement codes
  const { entitlements: userEntitlements } = useSharedUserEntitlements()

  // Get user role (ssi_admin/god bypasses all access checks)
  const { platformRole } = useUserRole()

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
   * Check localStorage dev flags for testing.
   * Checks both legacy ssi-dev-paid-user and new ssi-dev-tier.
   */
  function checkDevPaidStatus(): boolean {
    try {
      // Demo flow (TryLinkGateway / DemoLauncher) sets ssi-demo-tier in
      // sessionStorage — honoured everywhere, dev and prod.
      if (sessionStorage.getItem('ssi-demo-tier') === 'paid') return true
      // The localStorage flags below are dev convenience only; in a prod
      // build they'd be a client-side paywall bypass (anyone could set
      // them from devtools), so we hard-deny.
      if (import.meta.env.PROD) return false
      const tier = localStorage.getItem('ssi-dev-tier')
      if (tier === 'paid') return true
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
      course_code: course.course_code,
      pricing_tier: pricingTier,
      is_community: isCommunity,
    }

    const subscription = getSubscriptionStatus()
    return checkCourseAccess(courseWithPricing, subscription, userEntitlements.value, platformRole.value)
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

  /**
   * Can the user START an offline download right now?
   *
   * MODEL (2026-06-16): offline download is OPEN TO EVERYONE — on every course,
   * including free/community. We don't sell the content (community is free to
   * learn forever); we sell the CONVENIENCE of offline. So the door is open and
   * the 30-day LEASE governs longevity: payers re-validate online and keep it
   * forever; non-payers get a single 30-day taste, then must subscribe (the lease
   * lapses → offline locks, bytes preserved). Hence this returns true. The
   * trial-exhaustion paywall (re-download after the taste lapses) lives at the
   * download trigger in LearningPlayer, which holds the per-course lease state
   * this stateless check doesn't.
   */
  function canDownloadOffline(_course: CourseInfo): boolean {
    return true
  }

  /**
   * Does this user's offline access RENEW, rather than being a one-off 30-day
   * taste? True for an admin/tester/god role, an active paid subscription, or an
   * entitlement (full access, or this specific course). Drives the trial-vs-
   * permanent UI and whether a re-download after the taste lapses is free or hits
   * the paywall. (This is the OLD canDownloadOffline gate, repurposed.)
   */
  function offlineRenews(course: CourseInfo): boolean {
    const role = platformRole.value
    if (role === 'ssi_admin' || role === 'tester') return true

    const sub = getSubscriptionStatus()
    if (sub.isActive && sub.tier === 'paid') return true

    const now = new Date()
    return (userEntitlements.value || []).some((e) => {
      if (e.expiresAt && new Date(e.expiresAt) <= now) return false
      if (e.accessType === 'full') return true
      if (e.accessType === 'courses' && e.grantedCourses && course.course_code) {
        return e.grantedCourses.includes(course.course_code)
      }
      return false
    })
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
    } else if (access.reason === 'subscribed' || access.reason === 'entitled') {
      // Paid user or entitled (admin/entitlement code) - full access
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
    canDownloadOffline,
    offlineRenews,
  }
}

export type EntitlementComposable = ReturnType<typeof useEntitlement>
