/**
 * usePopulationHours — population-level practice-time aggregation.
 *
 * Reads course_enrollments.total_practice_minutes for every learner, sums
 * across courses to give one total per learner, returns:
 *   - per-learner totals (sorted)
 *   - histogram buckets suitable for SVG rendering
 *   - summary stats (median, % over 30h, % over 100h, etc.)
 *
 * Used by the /methodology/empirical-baseline explainer page (see
 * docs/methodology/metrics-architecture.md §2). Read-only, no caching beyond
 * the lifetime of the composable instance.
 */

import { ref, inject, type Ref } from 'vue'
import type { SupabaseClient } from '@supabase/supabase-js'

interface EnrollmentRow {
  learner_id: string
  total_practice_minutes: number | null
}

export interface HourBucket {
  /** Lower bound of the bucket in hours (inclusive). */
  fromHours: number
  /** Upper bound in hours (exclusive). */
  toHours: number
  /** Number of learners whose total falls in this bucket. */
  count: number
}

interface PopulationStats {
  totalLearners: number
  learnersWithAnyPractice: number
  medianHours: number
  meanHours: number
  pct1hPlus: number
  pct10hPlus: number
  pct30hPlus: number
  pct100hPlus: number
  maxHours: number
}

interface UsePopulationHoursReturn {
  isLoading: Ref<boolean>
  error: Ref<string | null>
  perLearnerHours: Ref<number[]>          // sorted ascending
  buckets: Ref<HourBucket[]>
  stats: Ref<PopulationStats | null>
  fetch: () => Promise<void>
}

const DEFAULT_BUCKETS_HOURS: Array<[number, number]> = [
  [0, 1],
  [1, 3],
  [3, 10],
  [10, 30],
  [30, 50],
  [50, 100],
  [100, 200],
  [200, 500],
  [500, 1000],
]

function median(sorted: number[]): number {
  if (sorted.length === 0) return 0
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2
}

export function usePopulationHours(): UsePopulationHoursReturn {
  const supabase = inject<Ref<SupabaseClient | null>>('supabase')

  const isLoading = ref(false)
  const error = ref<string | null>(null)
  const perLearnerHours = ref<number[]>([])
  const buckets = ref<HourBucket[]>([])
  const stats = ref<PopulationStats | null>(null)

  async function fetch(): Promise<void> {
    if (!supabase?.value) {
      error.value = 'Supabase client unavailable'
      return
    }
    isLoading.value = true
    error.value = null

    try {
      // Single SELECT — ~2.6k rows in production today, well within limits.
      // If this ever grows past ~50k we'd switch to a server-side aggregation.
      const { data, error: fetchError } = await supabase.value
        .from('course_enrollments')
        .select('learner_id, total_practice_minutes')
        .limit(50000)

      if (fetchError) throw fetchError

      const totalsByLearner = new Map<string, number>()
      for (const row of (data ?? []) as EnrollmentRow[]) {
        const mins = row.total_practice_minutes ?? 0
        totalsByLearner.set(
          row.learner_id,
          (totalsByLearner.get(row.learner_id) ?? 0) + mins,
        )
      }

      // Convert to hours, sort ascending. Exclude learners with no
      // course_enrollments rows — they are not "learners with zero practice"
      // for our purposes, they are unenrolled accounts (sign-ups who never
      // started). The y-axis here is conditional on having ever opened a
      // course; the empirical 30/100h claim is about practising learners.
      const hours = Array.from(totalsByLearner.values())
        .map(m => m / 60)
        .sort((a, b) => a - b)

      perLearnerHours.value = hours

      // Histogram
      const histo: HourBucket[] = DEFAULT_BUCKETS_HOURS.map(([from, to]) => ({
        fromHours: from,
        toHours: to,
        count: 0,
      }))
      for (const h of hours) {
        const idx = DEFAULT_BUCKETS_HOURS.findIndex(([f, t]) => h >= f && h < t)
        if (idx >= 0) histo[idx].count++
        else if (h >= DEFAULT_BUCKETS_HOURS[DEFAULT_BUCKETS_HOURS.length - 1][1]) {
          histo[histo.length - 1].count++
        }
      }
      buckets.value = histo

      // Summary stats
      const total = hours.length
      const withPractice = hours.filter(h => h > 0).length
      const sum = hours.reduce((s, h) => s + h, 0)
      stats.value = {
        totalLearners: total,
        learnersWithAnyPractice: withPractice,
        medianHours: median(hours),
        meanHours: total ? sum / total : 0,
        pct1hPlus:   total ? (100 * hours.filter(h => h >= 1).length) / total : 0,
        pct10hPlus:  total ? (100 * hours.filter(h => h >= 10).length) / total : 0,
        pct30hPlus:  total ? (100 * hours.filter(h => h >= 30).length) / total : 0,
        pct100hPlus: total ? (100 * hours.filter(h => h >= 100).length) / total : 0,
        maxHours: hours.length ? hours[hours.length - 1] : 0,
      }
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to fetch practice hours'
      console.error('[usePopulationHours] fetch error:', err)
    } finally {
      isLoading.value = false
    }
  }

  return { isLoading, error, perLearnerHours, buckets, stats, fetch }
}
