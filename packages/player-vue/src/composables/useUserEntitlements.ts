/**
 * useUserEntitlements - Fetches and caches user entitlements from entitlement codes
 *
 * Same pattern as useSubscription:
 * - localStorage cache with 5-min TTL for instant UX
 * - Background fetch for fresh data
 * - Singleton instance via useSharedUserEntitlements()
 */

import { ref, computed, inject, type Ref, type ComputedRef } from 'vue'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { UserEntitlement } from '@ssi/core'

// ============================================================================
// STORAGE
// ============================================================================

const CACHE_KEY = 'ssi_user_entitlements'
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

interface CachedEntitlements {
  entitlements: UserEntitlement[]
  cachedAt: number
}

// ============================================================================
// COMPOSABLE
// ============================================================================

export interface UseUserEntitlementsReturn {
  /** Current active entitlements */
  entitlements: Ref<UserEntitlement[]>
  /** Whether user has any active entitlement */
  hasEntitlement: ComputedRef<boolean>
  /** Whether we're loading */
  isLoading: Ref<boolean>
  /** Initialize — call from App.vue after supabase + auth are ready */
  initialize: () => Promise<void>
  /** Refresh from API */
  refresh: () => Promise<void>
  /** Clear local cache */
  clearCache: () => void
}

export function useUserEntitlements(): UseUserEntitlementsReturn {
  const supabaseRef = inject<{ value: SupabaseClient | null }>('supabase')

  const entitlements = ref<UserEntitlement[]>([])
  const isLoading = ref(false)

  const hasEntitlement = computed(() => entitlements.value.length > 0)

  // ============================================================================
  // CACHE
  // ============================================================================

  function loadFromCache(): CachedEntitlements | null {
    try {
      const cached = localStorage.getItem(CACHE_KEY)
      if (!cached) return null
      const data: CachedEntitlements = JSON.parse(cached)
      if (Date.now() - data.cachedAt > CACHE_TTL_MS) return null
      return data
    } catch {
      return null
    }
  }

  function saveToCache(items: UserEntitlement[]): void {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({
        entitlements: items,
        cachedAt: Date.now(),
      }))
    } catch {
      // Ignore storage errors
    }
  }

  function clearCache(): void {
    try {
      localStorage.removeItem(CACHE_KEY)
    } catch {
      // Ignore
    }
  }

  // ============================================================================
  // API
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

  async function fetchEntitlements(): Promise<void> {
    const token = await getAuthToken()
    if (!token) {
      entitlements.value = []
      return
    }

    try {
      const response = await fetch('/api/entitlement/user', {
        headers: { 'Authorization': `Bearer ${token}` },
      })

      if (!response.ok) {
        if (response.status === 401) {
          clearCache()
          entitlements.value = []
          return
        }
        throw new Error(`API error: ${response.status}`)
      }

      const data = await response.json()
      const items: UserEntitlement[] = (data.entitlements || []).map((e: any) => ({
        accessType: e.access_type,
        grantedCourses: e.granted_courses,
        expiresAt: e.expires_at,
      }))

      entitlements.value = items
      saveToCache(items)
    } catch (err) {
      console.error('[useUserEntitlements] Fetch error:', err)
    }
  }

  async function refresh(): Promise<void> {
    isLoading.value = true
    try {
      await fetchEntitlements()
    } finally {
      isLoading.value = false
    }
  }

  // ============================================================================
  // INIT
  // ============================================================================

  const cached = loadFromCache()
  if (cached) {
    entitlements.value = cached.entitlements
  }

  async function initialize(): Promise<void> {
    if (supabaseRef?.value) await fetchEntitlements()
  }

  return {
    entitlements,
    hasEntitlement,
    isLoading,
    initialize,
    refresh,
    clearCache,
  }
}

// ============================================================================
// SHARED INSTANCE
// ============================================================================

let sharedInstance: ReturnType<typeof useUserEntitlements> | null = null

export function useSharedUserEntitlements(): UseUserEntitlementsReturn {
  if (!sharedInstance) {
    sharedInstance = useUserEntitlements()
  }
  return sharedInstance
}
