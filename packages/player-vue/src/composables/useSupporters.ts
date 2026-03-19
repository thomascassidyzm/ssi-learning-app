/**
 * useSupporters - Supporter data composable
 *
 * Follows the same caching pattern as useSubscription:
 * - localStorage for instant load
 * - Background fetch from Supabase for fresh data
 * - 5-minute cache TTL
 */

import { ref, computed, inject, type Ref, type ComputedRef } from 'vue'
import type { SupabaseClient } from '@supabase/supabase-js'

// ============================================================================
// STORAGE KEYS
// ============================================================================

const SUPPORTERS_KEY = 'ssi_supporters'
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

// ============================================================================
// TYPES
// ============================================================================

export interface Supporter {
  display_name: string
  type: 'one-off' | 'monthly'
  first_supported_at: string
}

interface CachedSupporters {
  supporters: Supporter[]
  cachedAt: number
}

export interface UseSupportersReturn {
  supporters: Ref<Supporter[]>
  isSupporter: ComputedRef<boolean>
  supporterSince: ComputedRef<string | null>
  isLoading: Ref<boolean>
  fetchSupporters: () => Promise<void>
  initialize: () => Promise<void>
}

// ============================================================================
// COMPOSABLE
// ============================================================================

export function useSupporters(): UseSupportersReturn {
  const supabaseRef = inject<{ value: SupabaseClient | null }>('supabase')
  const auth = inject<any>('auth', null)

  const supporters = ref<Supporter[]>([])
  const isLoading = ref(false)

  // Check if current learner is a supporter (linked via email match in webhook)
  const isSupporter = computed(() => {
    if (!auth?.learnerId?.value) return false
    // We check via a separate query or rely on the learner_id link
    // For now, check if any supporter email matches current user
    return _currentLearnerIsSupporter.value
  })

  const _currentLearnerIsSupporter = ref(false)
  const _supporterSince = ref<string | null>(null)

  const supporterSince = computed(() => _supporterSince.value)

  // ============================================================================
  // CACHE MANAGEMENT
  // ============================================================================

  function loadFromCache(): CachedSupporters | null {
    try {
      const cached = localStorage.getItem(SUPPORTERS_KEY)
      if (!cached) return null
      const data: CachedSupporters = JSON.parse(cached)
      if (Date.now() - data.cachedAt > CACHE_TTL_MS) return null
      return data
    } catch {
      return null
    }
  }

  function saveToCache(list: Supporter[]): void {
    try {
      const data: CachedSupporters = { supporters: list, cachedAt: Date.now() }
      localStorage.setItem(SUPPORTERS_KEY, JSON.stringify(data))
    } catch {
      // Ignore storage errors
    }
  }

  // ============================================================================
  // DATA FETCHING
  // ============================================================================

  async function fetchSupporters(): Promise<void> {
    const client = supabaseRef?.value
    if (!client) return

    isLoading.value = true

    try {
      // Fetch supporters for the wall (public data only)
      const { data, error } = await client
        .from('supporters')
        .select('display_name, type, first_supported_at')
        .eq('is_active', true)
        .order('last_supported_at', { ascending: false })
        .limit(200)

      if (error) {
        console.error('[useSupporters] Fetch error:', error)
        return
      }

      supporters.value = data || []
      saveToCache(supporters.value)

      // Check if current learner is a supporter
      await checkCurrentLearnerSupporter(client)
    } catch (err) {
      console.error('[useSupporters] Error:', err)
    } finally {
      isLoading.value = false
    }
  }

  async function checkCurrentLearnerSupporter(client: SupabaseClient): Promise<void> {
    const learnerId = auth?.learnerId?.value
    if (!learnerId) {
      _currentLearnerIsSupporter.value = false
      return
    }

    try {
      const { data } = await client
        .from('supporters')
        .select('first_supported_at')
        .eq('learner_id', learnerId)
        .eq('is_active', true)
        .order('first_supported_at', { ascending: true })
        .limit(1)
        .maybeSingle()

      _currentLearnerIsSupporter.value = !!data
      _supporterSince.value = data?.first_supported_at || null
    } catch {
      _currentLearnerIsSupporter.value = false
    }
  }

  // ============================================================================
  // INITIALIZATION
  // ============================================================================

  // Load from cache immediately
  const cached = loadFromCache()
  if (cached) {
    supporters.value = cached.supporters
  }

  async function initialize(): Promise<void> {
    if (supabaseRef?.value) await fetchSupporters()
  }

  return {
    supporters,
    isSupporter,
    supporterSince,
    isLoading,
    fetchSupporters,
    initialize,
  }
}

// ============================================================================
// SHARED INSTANCE
// ============================================================================

let sharedInstance: ReturnType<typeof useSupporters> | null = null

export function useSharedSupporters(): UseSupportersReturn {
  if (!sharedInstance) {
    sharedInstance = useSupporters()
  }
  return sharedInstance
}
