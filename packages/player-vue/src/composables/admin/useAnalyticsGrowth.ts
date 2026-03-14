/**
 * useAnalyticsGrowth - New users and enrollment trends over time
 *
 * Calls analytics_growth RPC with configurable period (week/month) and count.
 */

import { ref } from 'vue'
import type { SupabaseClient } from '@supabase/supabase-js'

export interface GrowthRow {
  period_start: string
  new_users: number
  enrollments_by_course: Record<string, number>
}

export function useAnalyticsGrowth(client: SupabaseClient) {
  const data = ref<GrowthRow[]>([])
  const isLoading = ref(false)
  const error = ref<string | null>(null)

  async function fetch(period: string = 'week', count: number = 12) {
    isLoading.value = true
    error.value = null
    try {
      const { data: result, error: err } = await client.rpc('analytics_growth', {
        p_period: period,
        p_count: count,
      })
      if (err) throw err
      data.value = result || []
    } catch (e: any) {
      error.value = e.message || 'Failed to fetch growth data'
      console.error('[AnalyticsGrowth]', e)
    } finally {
      isLoading.value = false
    }
  }

  return { data, isLoading, error, fetch }
}
