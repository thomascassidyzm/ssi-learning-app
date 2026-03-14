/**
 * useAnalyticsEngagement - Session frequency, duration, belt distribution
 *
 * Calls analytics_engagement RPC for DAU/WAU/MAU, session metrics, and belt averages.
 */

import { ref } from 'vue'
import type { SupabaseClient } from '@supabase/supabase-js'

export interface EngagementData {
  dau: number
  wau: number
  mau: number
  avg_session_duration_s: number
  avg_sessions_per_user_per_week: number
  session_frequency_distribution: Record<string, number>
  session_duration_distribution: Record<string, number>
  avg_belt_per_course: Record<string, string>
}

export function useAnalyticsEngagement(client: SupabaseClient) {
  const data = ref<EngagementData | null>(null)
  const isLoading = ref(false)
  const error = ref<string | null>(null)

  async function fetch() {
    isLoading.value = true
    error.value = null
    try {
      const { data: result, error: err } = await client.rpc('analytics_engagement')
      if (err) throw err
      data.value = result
    } catch (e: any) {
      error.value = e.message || 'Failed to fetch engagement data'
      console.error('[AnalyticsEngagement]', e)
    } finally {
      isLoading.value = false
    }
  }

  return { data, isLoading, error, fetch }
}
