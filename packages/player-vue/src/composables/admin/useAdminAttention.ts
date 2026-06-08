/**
 * useAdminAttention - subscribers who need attention.
 *
 * Thin wrapper over GET /api/admin/attention (which does the computation
 * server-side with the service role). See api/admin/attention.ts for the rules.
 */

import { ref, computed } from 'vue'
import type { SupabaseClient } from '@supabase/supabase-js'

interface AttentionUser {
  learner_id: string
  name: string | null
  email: string | null
  level: 'high' | 'medium'
  reason: string
  course: string | null
  last_practiced_at: string | null
}

export function useAdminAttention(client: SupabaseClient) {
  const flagged = ref<AttentionUser[]>([])
  const healthy = ref(0)
  const totalSubscribers = ref(0)
  const isLoading = ref(false)
  const error = ref<string | null>(null)

  const highCount = computed(() => flagged.value.filter(u => u.level === 'high').length)
  const mediumCount = computed(() => flagged.value.filter(u => u.level === 'medium').length)

  async function getToken(): Promise<string | null> {
    try {
      const { data } = await client.auth.getSession()
      return data?.session?.access_token ?? null
    } catch {
      return null
    }
  }

  async function fetchAll(): Promise<void> {
    isLoading.value = true
    error.value = null
    try {
      const token = await getToken()
      const res = await fetch('/api/admin/attention', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `Request failed: ${res.status}`)
      }
      const data = await res.json()
      flagged.value = data.flagged || []
      healthy.value = data.healthy || 0
      totalSubscribers.value = data.totalSubscribers || 0
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to fetch attention list'
      console.error('[AdminAttention] fetch error:', err)
    } finally {
      isLoading.value = false
    }
  }

  return { flagged, healthy, totalSubscribers, highCount, mediumCount, isLoading, error, fetchAll }
}
