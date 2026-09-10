/**
 * The one door the question pages use to reach the server.
 *
 * Every intelligence endpoint is admin-gated by verifyAdmin() and applies the
 * shared population resolver, so a page never filters on its own and never
 * talks to Supabase directly. `fetchedAt` comes back with the data because the
 * Updated stamp reads the moment the fetch COMPLETED, not the moment the page
 * drew itself.
 */
import { ref, type Ref } from 'vue'
import { useAdminClient } from '@/composables/useAdminClient'

export interface IntelFetch<T> {
  data: Ref<T | null>
  error: Ref<string | null>
  isLoading: Ref<boolean>
  fetchedAt: Ref<Date | null>
  load: (query?: Record<string, string>) => Promise<void>
}

export function useIntelApi<T>(path: string): IntelFetch<T> {
  const { getAuthToken } = useAdminClient()
  const data = ref(null) as Ref<T | null>
  const error = ref<string | null>(null)
  const isLoading = ref(false)
  const fetchedAt = ref<Date | null>(null)

  async function load(query: Record<string, string> = {}): Promise<void> {
    isLoading.value = true
    error.value = null
    // Values blank while the new scope loads — the old scope's numbers are
    // never shown against the new name (the 2026-07-30 stability ruling).
    data.value = null
    fetchedAt.value = null
    try {
      const token = await getAuthToken()
      const qs = new URLSearchParams(query).toString()
      const res = await fetch(`${path}${qs ? `?${qs}` : ''}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (!res.ok) {
        error.value = res.status === 403 ? 'You do not have access to this.' : 'Could not read this just now.'
        return
      }
      data.value = (await res.json()) as T
      fetchedAt.value = new Date()
    } catch {
      error.value = 'Could not reach the server.'
    } finally {
      isLoading.value = false
    }
  }

  return { data, error, isLoading, fetchedAt, load }
}
