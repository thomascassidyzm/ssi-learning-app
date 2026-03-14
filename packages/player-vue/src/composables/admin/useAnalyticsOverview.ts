/**
 * useAnalyticsOverview - High-level platform KPIs
 *
 * Calls analytics_overview RPC for total learners, MAU, DAU, stickiness, practice hours.
 */

import { ref } from 'vue'
import type { SupabaseClient } from '@supabase/supabase-js'

export interface OverviewData {
  total_learners: number
  mau: number
  dau: number
  dau_mau_ratio: number
  total_practice_hours: number
  delta_vs_30d_ago: number
}

export function useAnalyticsOverview(client: SupabaseClient) {
  const data = ref<OverviewData | null>(null)
  const isLoading = ref(false)
  const error = ref<string | null>(null)

  async function fetch() {
    isLoading.value = true
    error.value = null
    try {
      const { data: result, error: err } = await client.rpc('analytics_overview')
      if (err) throw err
      data.value = result
    } catch (e: any) {
      error.value = e.message || 'Failed to fetch overview'
      console.error('[AnalyticsOverview]', e)
    } finally {
      isLoading.value = false
    }
  }

  return { data, isLoading, error, fetch }
}
