/**
 * useAnalyticsFriction - Friction map showing where learners stop
 *
 * Calls analytics_friction_map RPC per course for seed-level drop-off data.
 */

import { ref } from 'vue'
import type { SupabaseClient } from '@supabase/supabase-js'

export interface FrictionPoint {
  seed_number: number
  stopped_here_count: number
  spike_rate: number
}

export function useAnalyticsFriction(client: SupabaseClient) {
  const data = ref<FrictionPoint[]>([])
  const isLoading = ref(false)
  const error = ref<string | null>(null)

  async function fetch(courseId: string) {
    isLoading.value = true
    error.value = null
    try {
      const { data: result, error: err } = await client.rpc('analytics_friction_map', {
        p_course_id: courseId,
      })
      if (err) throw err
      data.value = result || []
    } catch (e: any) {
      error.value = e.message || 'Failed to fetch friction data'
      console.error('[AnalyticsFriction]', e)
    } finally {
      isLoading.value = false
    }
  }

  return { data, isLoading, error, fetch }
}
