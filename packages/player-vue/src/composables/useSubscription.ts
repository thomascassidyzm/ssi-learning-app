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
import type {
  Subscription,
  SubscriptionStatus,
  SubscriptionResponse,
  PortalResponse,
} from '../types/Subscription'

// ============================================================================
// STORAGE KEYS
// ============================================================================

const SUBSCRIPTION_KEY = 'ssi_subscription'
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

// ============================================================================
// TYPES
// ============================================================================

interface CachedSubscription {
  subscription: Subscription | null
  isSubscribed: boolean
  cachedAt: number
}

export interface UseSubscriptionReturn {
  /** Current subscription (null if none) */
  subscription: Ref<Subscription | null>
  /** Whether user has active subscription */
  isSubscribed: ComputedRef<boolean>
  /** Whether we're loading subscription data */
  isLoading: Ref<boolean>
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
  /** Clear local cache */
  clearCache: () => void
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
  const error = ref<string | null>(null)

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

  function saveToCache(sub: Subscription | null, subscribed: boolean): void {
    try {
      const data: CachedSubscription = {
        subscription: sub,
        isSubscribed: subscribed,
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
    const token = await getAuthToken()
    if (!token) {
      // Not authenticated - clear subscription
      subscription.value = null
      return
    }

    try {
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
          return
        }
        throw new Error(`API error: ${response.status}`)
      }

      const data: SubscriptionResponse = await response.json()

      subscription.value = data.subscription
      saveToCache(data.subscription, data.isSubscribed)
    } catch (err) {
      console.error('[useSubscription] Fetch error:', err)
      error.value = err instanceof Error ? err.message : 'Failed to fetch subscription'
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
    await fetchSubscription()
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
    subscription,
    isSubscribed,
    isLoading,
    error,
    status,
    initialize,
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
  }
  return sharedInstance
}
