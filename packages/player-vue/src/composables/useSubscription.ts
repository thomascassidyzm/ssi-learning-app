/**
 * useSubscription - Subscription status composable
 *
 * Provider-agnostic subscription management with localStorage caching.
 * Pattern follows useBeltProgress:
 * - localStorage is primary for instant UX
 * - Background fetch from API for fresh data
 * - 5-minute cache TTL
 *
 * The app only interacts with this composable, never with LemonSqueezy directly.
 * This allows easy provider swap (to Stripe, etc.) by only changing API endpoints.
 */

import { ref, computed, inject, type Ref, type ComputedRef } from 'vue'
import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveSupabase } from './schools/client'
import { CHECKOUT_COMPLETED_EVENT } from '../lib/checkoutEvents'
import type {
  Subscription,
  SubscriptionStatus,
  SubscriptionResponse,
  PortalResponse,
  OrgFreeAccess,
} from '../types/Subscription'

// ============================================================================
// STORAGE KEYS
// ============================================================================

export { CHECKOUT_COMPLETED_EVENT as CHECKOUT_COMPLETED_EVENT_NAME }

const SUBSCRIPTION_KEY = 'ssi_subscription'
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

// Bounds the "hasHydrated stays false" grace period on the initial fetch.
// isPending (derived from !hasHydrated in useEntitlement) optimistically
// unlocks premium UI while a legitimate fetch is in flight — necessary
// because a page-load race shouldn't bounce a paying subscriber to the
// paywall. But that same optimism fails OPEN forever if /api/subscription
// is simply never allowed to resolve (blocked request, dead connection).
// After this timeout we declare hydration done (fail closed — not
// subscribed) regardless; the in-flight fetch keeps running in the
// background and will correct `subscription` the moment it actually
// resolves. Real content enforcement is server-side (checkCourseAccess
// here is UI-only), so this only bounds how long the cosmetic grace
// period can be held open.
const HYDRATION_TIMEOUT_MS = 8000

// ============================================================================
// TYPES
// ============================================================================

interface CachedSubscription {
  subscription: Subscription | null
  isSubscribed: boolean
  /** Free-through-a-funded-org grant, cached with the same TTL as the
   *  subscription so a reload doesn't flash an upgrade prompt at a learner
   *  whose year is paid for. */
  freeAccess?: OrgFreeAccess | null
  cachedAt: number
}

export interface UseSubscriptionReturn {
  /** Current subscription (null if none) */
  subscription: Ref<Subscription | null>
  /** Whether user has active subscription */
  isSubscribed: ComputedRef<boolean>
  /** Whether we're loading subscription data */
  isLoading: Ref<boolean>
  /** True once the first fetch attempt (or a no-auth short-circuit) has
   *  completed — before this, `isSubscribed` is not yet a trustworthy
   *  "not subscribed" signal. */
  hasHydrated: Ref<boolean>
  /** Error message if any */
  error: Ref<string | null>
  /** Subscription status for display */
  status: ComputedRef<SubscriptionStatus>
  /** Initialize — call from App.vue after supabase + auth are ready */
  initialize: () => Promise<void>
  /** Open customer portal */
  openPortal: () => Promise<void>
  /** Cancel the subscription at period end (returns the end date if known) */
  cancelSubscription: () => Promise<{ ok: boolean; effectiveAt?: string | null; error?: string }>
  /** Refresh subscription from API */
  refresh: () => Promise<void>
  /** Re-read until the API reports an active subscription (or timeout). */
  pollUntilActive: (timeoutMs?: number) => Promise<void>
  /** Clear local cache */
  clearCache: () => void
  /** True when this learner IS a parent-minted child account — never offered a
   *  checkout (job #376·F, D7). */
  isChildAccount: Ref<boolean>
  /** True when the SERVER says this learner is an ssi_admin. Suppresses every
   *  upgrade affordance: a platform admin outranks Premium and is never sold
   *  anything (Tom, 2026-09-08). Read from /api/subscription, which resolves it
   *  from the learner row — deliberately NOT from useUserRole, whose cache is
   *  localStorage and is writable by the browser. */
  isPlatformAdmin: Ref<boolean>
  /** The funded-org grant paying for this learner's access, if any. */
  freeAccess: Ref<OrgFreeAccess | null>
  /** NOBODY WHOSE ACCESS IS ALREADY FREE IS EVER SHOWN A PRICE.
   *  True while a funded org enrolment (Canolfan's free year) is still
   *  running. Every upgrade prompt is suppressed by this one signal, so a
   *  new surface asks the same question as the old ones instead of inventing
   *  its own idea of "free". */
  hasFreeAccess: ComputedRef<boolean>
}

// ============================================================================
// COMPOSABLE
// ============================================================================

export function useSubscription(): UseSubscriptionReturn {
  // Supabase client for auth token
  const supabaseRef = inject<{ value: SupabaseClient | null }>('supabase')

  // Subscription state
  const subscription = ref<Subscription | null>(null)
  const isLoading = ref(false)
  const hasHydrated = ref(false)
  const error = ref<string | null>(null)
  // A parent-minted child account: no email of their own, no way to pay, so
  // no checkout is ever opened for them (job #376·F, D7).
  const isChildAccount = ref(false)
  // Server-decided; see the interface note. Defaults false, so a failed or
  // unauthenticated fetch never quietly grants anybody the admin treatment.
  const isPlatformAdmin = ref(false)
  // Free through a funded org enrolment (Canolfan's free year) — see
  // api/_utils/orgFreeAccess.ts. Drives prompt suppression, never access:
  // the courses the grant unlocks are carried by user_entitlements, which
  // checkCourseAccess already honours.
  const freeAccess = ref<OrgFreeAccess | null>(null)

  // Computed
  const isSubscribed = computed(() => {
    if (!subscription.value) return false
    if (subscription.value.status !== 'active') return false

    // Check if within active period
    if (subscription.value.currentPeriodEnd) {
      const periodEnd = new Date(subscription.value.currentPeriodEnd)
      if (periodEnd < new Date()) return false
    }

    return true
  })

  const hasFreeAccess = computed(() => {
    const until = freeAccess.value?.until
    if (!until) return false
    const ends = new Date(until)
    return !Number.isNaN(ends.getTime()) && ends > new Date()
  })

  const status = computed((): SubscriptionStatus => {
    return subscription.value?.status ?? 'none'
  })

  // ============================================================================
  // CACHE MANAGEMENT
  // ============================================================================

  function loadFromCache(): CachedSubscription | null {
    try {
      const cached = localStorage.getItem(SUBSCRIPTION_KEY)
      if (!cached) return null

      const data: CachedSubscription = JSON.parse(cached)

      // Check if cache is fresh
      if (Date.now() - data.cachedAt > CACHE_TTL_MS) {
        return null
      }

      return data
    } catch {
      return null
    }
  }

  function saveToCache(sub: Subscription | null, subscribed: boolean, grant: OrgFreeAccess | null): void {
    try {
      const data: CachedSubscription = {
        subscription: sub,
        isSubscribed: subscribed,
        freeAccess: grant,
        cachedAt: Date.now(),
      }
      localStorage.setItem(SUBSCRIPTION_KEY, JSON.stringify(data))
    } catch {
      // Ignore storage errors
    }
  }

  function clearCache(): void {
    // Reset in-memory state too, not just the persisted copy — otherwise the
    // previous user's subscription lingers in the ref after sign-out (useAuth
    // calls this on logout) until a reload. isSubscribed is computed from
    // `subscription`, so it follows automatically.
    subscription.value = null
    freeAccess.value = null
    isPlatformAdmin.value = false
    try {
      localStorage.removeItem(SUBSCRIPTION_KEY)
    } catch {
      // Ignore
    }
  }

  // ============================================================================
  // API CALLS
  // ============================================================================

  async function getAuthToken(): Promise<string | null> {
    const client = resolveSupabase(supabaseRef)
    if (!client) return null

    try {
      const { data: { session } } = await client.auth.getSession()
      return session?.access_token || null
    } catch {
      return null
    }
  }

  async function fetchSubscription(): Promise<void> {
    try {
      const token = await getAuthToken()
      if (!token) {
        // Not authenticated - clear subscription. This IS a resolved state
        // (guest), so hydration is complete.
        subscription.value = null
        isChildAccount.value = false
        isPlatformAdmin.value = false
        freeAccess.value = null
        hasHydrated.value = true
        return
      }

      const response = await fetch('/api/subscription', {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      })

      if (!response.ok) {
        if (response.status === 401) {
          // Auth issue - clear cache and state
          clearCache()
          subscription.value = null
          freeAccess.value = null
          hasHydrated.value = true
          return
        }
        throw new Error(`API error: ${response.status}`)
      }

      const data: SubscriptionResponse = await response.json()

      subscription.value = data.subscription
      isChildAccount.value = !!data.isChildAccount
      isPlatformAdmin.value = !!data.isPlatformAdmin
      freeAccess.value = data.freeAccess ?? null
      saveToCache(data.subscription, data.isSubscribed, freeAccess.value)
      hasHydrated.value = true
    } catch (err) {
      console.error('[useSubscription] Fetch error:', err)
      error.value = err instanceof Error ? err.message : 'Failed to fetch subscription'
      // A network/API failure leaves hydration incomplete on purpose — we
      // don't know the real status, so don't downgrade a possibly-active
      // subscriber to "unsubscribed" (isPending stays true; the gate keeps
      // optimistically allowing access until a real answer arrives).
    }
  }

  async function refresh(): Promise<void> {
    isLoading.value = true
    error.value = null

    try {
      await fetchSubscription()
    } finally {
      isLoading.value = false
    }
  }

  // ============================================================================
  // PORTAL
  // ============================================================================

  async function openPortal(): Promise<void> {
    const token = await getAuthToken()
    if (!token) {
      error.value = 'Please sign in'
      return
    }

    isLoading.value = true
    error.value = null

    try {
      const response = await fetch('/api/subscription/portal', {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to open portal')
      }

      const data: PortalResponse = await response.json()

      // Open portal in a new tab. The fetch above outlives the click gesture,
      // so iOS Safari may block the popup (returns null) — fall back to a
      // same-tab navigation so the button never silently does nothing.
      const win = window.open(data.portalUrl, '_blank')
      if (!win) window.location.href = data.portalUrl
    } catch (err) {
      console.error('[useSubscription] Portal error:', err)
      error.value = err instanceof Error ? err.message : 'Failed to open portal'
    } finally {
      isLoading.value = false
    }
  }

  async function cancelSubscription(): Promise<{ ok: boolean; effectiveAt?: string | null; error?: string }> {
    const token = await getAuthToken()
    if (!token) return { ok: false, error: 'Please sign in' }

    isLoading.value = true
    error.value = null
    try {
      const response = await fetch('/api/subscription/cancel', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        const msg = data?.error || 'Failed to cancel subscription'
        error.value = msg
        return { ok: false, error: msg }
      }
      // Optimistically reflect the scheduled cancellation, then refresh from the
      // API so the webhook-confirmed state wins once it lands.
      if (subscription.value) {
        subscription.value = { ...subscription.value, cancelAtPeriodEnd: true }
      }
      await fetchSubscription()
      return { ok: true, effectiveAt: data?.effectiveAt ?? null }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to cancel subscription'
      error.value = msg
      return { ok: false, error: msg }
    } finally {
      isLoading.value = false
    }
  }

  // ============================================================================
  // INITIALIZATION
  // ============================================================================

  // Load from cache immediately
  const cached = loadFromCache()
  if (cached) {
    subscription.value = cached.subscription
    freeAccess.value = cached.freeAccess ?? null
  }

  /**
   * Poll the subscription API until it reports active (or timeout). Used right
   * after a Paddle checkout redirect, where the activating webhook may lag the
   * page load by a few seconds — without this the just-subscribed learner would
   * briefly re-hit the paywall. Money capture is unchanged; this only re-reads
   * the already-written subscription state.
   */
  async function pollUntilActive(timeoutMs = 30000): Promise<void> {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      await fetchSubscription()
      if (isSubscribed.value) return
      await new Promise((r) => setTimeout(r, 2000))
    }
  }

  async function initialize(): Promise<void> {
    if (!resolveSupabase(supabaseRef)) return
    await Promise.race([
      fetchSubscription(),
      new Promise<void>((resolve) => setTimeout(resolve, HYDRATION_TIMEOUT_MS)),
    ])
    // Timed out before fetchSubscription set it itself — fail closed rather
    // than leave isPending optimistically true indefinitely.
    if (!hasHydrated.value) hasHydrated.value = true
    // Just came back from Paddle checkout — keep polling until the activating
    // webhook lands so the learner doesn't bounce off the paywall mid-redirect.
    try {
      const justSubscribed = new URLSearchParams(window.location.search).get('just_subscribed') === '1'
      if (justSubscribed && !isSubscribed.value) await pollUntilActive()
    } catch { /* URL parse is best-effort */ }
  }

  // ============================================================================
  // RETURN
  // ============================================================================

  return {
    isChildAccount,
    isPlatformAdmin,
    freeAccess,
    hasFreeAccess,
    subscription,
    isSubscribed,
    isLoading,
    hasHydrated,
    error,
    status,
    initialize,
    pollUntilActive,
    openPortal,
    cancelSubscription,
    refresh,
    clearCache,
  }
}

// ============================================================================
// SHARED INSTANCE
// ============================================================================

let sharedInstance: ReturnType<typeof useSubscription> | null = null

export function useSharedSubscription(): UseSubscriptionReturn {
  if (!sharedInstance) {
    sharedInstance = useSubscription()
    listenForCheckoutCompletion(sharedInstance)
  }
  return sharedInstance
}

/**
 * CONVERGE ON THE PURCHASE WITHOUT THE REDIRECT.
 *
 * The success redirect (?just_subscribed=1) is the only thing that used to tell
 * this app somebody had paid, and it is not ours to guarantee: a standalone PWA,
 * a blocked top-level navigation, an Apple Pay sheet that returns in place, or a
 * buyer who taps away from the receipt all skip it. When it is skipped the app
 * keeps its pre-purchase state — subscription null, Settings offering the
 * Upgrade row — while the money is gone and the webhook has already written the
 * row. That is what a brand-new account buying SSi Family hit on 2026-09-07.
 *
 * Paddle fires checkout.completed in-page regardless. Here we take that as the
 * cue and poll the same API the boot path polls, so the app catches up within
 * seconds of the webhook landing, redirect or no redirect. Idempotent: polling
 * stops the moment the subscription reads active, and a checkout that DID
 * redirect simply finds it active on the first read.
 */
function listenForCheckoutCompletion(instance: UseSubscriptionReturn): void {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return
  window.addEventListener(CHECKOUT_COMPLETED_EVENT, () => {
    // Drop the cached pre-purchase answer first: the 5-minute TTL would
    // otherwise hand a stale "not subscribed" to the next page load.
    try {
      localStorage.removeItem(SUBSCRIPTION_KEY)
    } catch {
      // Storage unavailable — the poll below is what actually matters.
    }
    void instance.pollUntilActive()
  })
}
