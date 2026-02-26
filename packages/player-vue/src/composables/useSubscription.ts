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
import type {
  Subscription,
  SubscriptionStatus,
  SubscriptionResponse,
  CheckoutResponse,
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
  /** Start checkout for a plan */
  checkout: (planId: string) => Promise<void>
  /** Open customer portal */
  openPortal: () => Promise<void>
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
    const client = supabaseRef?.value
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
  // CHECKOUT
  // ============================================================================

  async function checkout(planId: string): Promise<void> {
    const token = await getAuthToken()
    if (!token) {
      error.value = 'Please sign in to subscribe'
      return
    }

    isLoading.value = true
    error.value = null

    try {
      const response = await fetch('/api/subscription/checkout', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ planId }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Checkout failed')
      }

      const data: CheckoutResponse = await response.json()

      // Redirect to checkout
      window.location.href = data.checkoutUrl
    } catch (err) {
      console.error('[useSubscription] Checkout error:', err)
      error.value = err instanceof Error ? err.message : 'Checkout failed'
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

      // Open portal in new tab
      window.open(data.portalUrl, '_blank')
    } catch (err) {
      console.error('[useSubscription] Portal error:', err)
      error.value = err instanceof Error ? err.message : 'Failed to open portal'
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

  // Fetch fresh data in background (if we have a client)
  if (supabaseRef?.value) {
    fetchSubscription()
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
    checkout,
    openPortal,
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
