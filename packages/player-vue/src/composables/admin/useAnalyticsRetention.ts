/**
 * useAnalyticsRetention - Cohort retention heatmap data
 *
 * Calls analytics_retention_cohorts RPC for weekly cohorts with W1/W2/W4/W8 retention %.
 */

import { ref } from 'vue'
import type { SupabaseClient } from '@supabase/supabase-js'

export interface RetentionCohort {
  cohort_week: string
  cohort_size: number
  w1_pct: number
  w2_pct: number
  w4_pct: number
  w8_pct: number
}

export function useAnalyticsRetention(client: SupabaseClient) {
  const data = ref<RetentionCohort[]>([])
  const isLoading = ref(false)
  const error = ref<string | null>(null)

  async function fetch(weeks: number = 12) {
    isLoading.value = true
    error.value = null
    try {
      const { data: result, error: err } = await client.rpc('analytics_retention_cohorts', {
        p_weeks: weeks,
      })
      if (err) throw err
      data.value = result || []
    } catch (e: any) {
      error.value = e.message || 'Failed to fetch retention data'
      console.error('[AnalyticsRetention]', e)
    } finally {
      isLoading.value = false
    }
  }

  return { data, isLoading, error, fetch }
}
