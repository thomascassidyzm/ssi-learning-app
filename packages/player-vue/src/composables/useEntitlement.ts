/**
 * useEntitlement - Check user entitlements for offline downloads
 *
 * Entitlement model:
 * - Free users: Auto-prefetch ~30 minutes ahead during learning (background, non-blocking)
 * - Paid users: Explicit "Download for offline" with full course download
 *
 * Entitlement is checked BEFORE caching, not at playback time.
 * Once cached, audio plays without online checks.
 * Entitlement re-checked on next sync when online.
 */

import { ref, computed, inject, type Ref, type ComputedRef } from 'vue'

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

export interface UseEntitlementReturn {
  /** Current entitlement status */
  entitlement: Ref<EntitlementStatus>
  /** Whether user can download this course */
  canDownload: ComputedRef<boolean>
  /** Maximum download hours allowed */
  maxDownloadHours: ComputedRef<number>
  /** Check entitlement for a course */
  checkEntitlement: (courseId: string) => Promise<EntitlementStatus>
  /** Refresh entitlement (e.g., after purchase) */
  refreshEntitlement: () => Promise<void>
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

  // ============================================================================
  // COMPUTED
  // ============================================================================

  const canDownload = computed(() => entitlement.value.canDownload)
  const maxDownloadHours = computed(() => entitlement.value.maxDownloadHours)

  // ============================================================================
  // METHODS
  // ============================================================================

  /**
   * Check entitlement for a specific course.
   *
   * Entitlement logic:
   * 1. Community courses: Always free to download
   * 2. Paid user: Full download access
   * 3. Free user: Limited prefetch only (no explicit download)
   */
  async function checkEntitlement(courseId: string): Promise<EntitlementStatus> {
    currentCourseId.value = courseId
    const isAuthenticated = auth?.isAuthenticated.value ?? false

    // Determine course type (in production, this would come from course metadata)
    const courseEntitlement = determineCourseEntitlement(courseId)

    // Community courses are always free
    if (courseEntitlement === 'community') {
      entitlement.value = {
        canDownload: true,
        isAuthenticated,
        isPaidUser: false,
        courseEntitlement: 'community',
        maxDownloadHours: COMMUNITY_DOWNLOAD_HOURS,
      }
      return entitlement.value
    }

    // Check paid status (in production, this would query Clerk/Stripe)
    const isPaidUser = await checkPaidStatus()

    if (isPaidUser) {
      entitlement.value = {
        canDownload: true,
        isAuthenticated,
        isPaidUser: true,
        courseEntitlement: 'paid',
        maxDownloadHours: PAID_DOWNLOAD_HOURS,
      }
    } else {
      // Free users can't explicitly download, but auto-prefetch happens during learning
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
      await checkEntitlement(currentCourseId.value)
    }
  }

  // ============================================================================
  // HELPERS
  // ============================================================================

  /**
   * Determine course entitlement type from course metadata.
   *
   * In production, this would check:
   * - Course pricing tier from Supabase
   * - Big 10 language pairs (paid)
   * - Community flag (free)
   */
  function determineCourseEntitlement(courseId: string): 'free' | 'paid' | 'community' {
    // Placeholder logic - in production, query course metadata
    // Community courses have 'community_' prefix or are flagged in database
    if (courseId.startsWith('community_')) {
      return 'community'
    }

    // Big 10 language courses are paid
    const bigTenPrefixes = ['spa_', 'fre_', 'ger_', 'ita_', 'por_', 'chi_', 'jap_', 'ara_', 'kor_', 'eng_']
    if (bigTenPrefixes.some(prefix => courseId.startsWith(prefix))) {
      return 'paid'
    }

    // Default to free for unknown courses
    return 'free'
  }

  /**
   * Check if user has paid subscription.
   *
   * In production, this would:
   * 1. Check Clerk session metadata
   * 2. Query Stripe subscription status
   * 3. Check entitlement grants
   */
  async function checkPaidStatus(): Promise<boolean> {
    // Placeholder - in production, integrate with Clerk/Stripe
    // For now, check localStorage for development/testing
    try {
      const devPaidStatus = localStorage.getItem('ssi-dev-paid-user')
      if (devPaidStatus === 'true') {
        return true
      }
    } catch {
      // Ignore localStorage errors
    }

    // In production: return await clerk.user?.publicMetadata?.isPaidSubscriber ?? false
    return false
  }

  // ============================================================================
  // RETURN
  // ============================================================================

  return {
    entitlement,
    canDownload,
    maxDownloadHours,
    checkEntitlement,
    refreshEntitlement,
  }
}

export type EntitlementComposable = ReturnType<typeof useEntitlement>
