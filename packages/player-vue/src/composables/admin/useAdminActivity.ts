/**
 * useAdminActivity - Recent sessions, live learners, today's summary
 */

import { ref, computed } from 'vue'
import type { SupabaseClient } from '@supabase/supabase-js'

export interface ActivitySession {
  id: string
  learner_id: string
  course_id: string
  started_at: string
  ended_at: string | null
  duration_seconds: number | null
  items_practiced: number | null
  display_name: string
}

const sessions = ref<ActivitySession[]>([])
const isLoading = ref(false)
const error = ref<string | null>(null)

// Auto-refresh timer
let refreshInterval: ReturnType<typeof setInterval> | null = null

export function useAdminActivity(client: SupabaseClient) {

  // --- Computed summaries ---

  const liveSessions = computed(() =>
    sessions.value.filter(s => s.ended_at === null)
  )

  const todaysSessions = computed(() => {
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)
    return sessions.value.filter(s => new Date(s.started_at) >= todayStart)
  })

  const sessionsToday = computed(() => todaysSessions.value.length)

  const learnersToday = computed(() =>
    new Set(todaysSessions.value.map(s => s.learner_id)).size
  )

  const minutesToday = computed(() =>
    Math.round(
      todaysSessions.value.reduce((sum, s) => sum + (s.duration_seconds || 0), 0) / 60
    )
  )

  const topCourseToday = computed(() => {
    const courseMap = new Map<string, number>()
    todaysSessions.value.forEach(s => {
      courseMap.set(s.course_id, (courseMap.get(s.course_id) || 0) + 1)
    })
    let topCourse = ''
    let topCount = 0
    courseMap.forEach((count, course) => {
      if (count > topCount) {
        topCourse = course
        topCount = count
      }
    })
    return topCourse || null
  })

  // Group sessions by hour for timeline
  const sessionsByHour = computed(() => {
    const groups = new Map<string, ActivitySession[]>()

    todaysSessions.value.forEach(s => {
      const hour = new Date(s.started_at).getHours()
      const key = `${hour.toString().padStart(2, '0')}:00`
      if (!groups.has(key)) {
        groups.set(key, [])
      }
      groups.get(key)!.push(s)
    })

    return Array.from(groups.entries())
      .sort(([a], [b]) => b.localeCompare(a)) // Most recent first
      .map(([hour, sessions]) => ({ hour, sessions }))
  })

  // --- Data fetching ---

  async function fetchActivity(): Promise<void> {
    isLoading.value = true
    error.value = null

    try {
      const twentyFourHoursAgo = new Date()
      twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24)

      // Fetch recent sessions
      const { data: sessionData, error: sessErr } = await client
        .from('sessions')
        .select('id, learner_id, course_id, started_at, ended_at, duration_seconds, items_practiced')
        .gte('started_at', twentyFourHoursAgo.toISOString())
        .order('started_at', { ascending: false })
        .limit(100)

      if (sessErr) throw sessErr
      if (!sessionData || sessionData.length === 0) {
        sessions.value = []
        return
      }

      // Batch fetch learner names
      const learnerIds = [...new Set(sessionData.map(s => s.learner_id))]
      const { data: learnerData, error: learnersErr } = await client
        .from('learners')
        .select('id, display_name')
        .in('id', learnerIds)

      if (learnersErr) throw learnersErr

      const nameMap = new Map<string, string>()
      learnerData?.forEach(l => {
        nameMap.set(l.id, l.display_name || 'Anonymous')
      })

      sessions.value = sessionData.map(s => ({
        ...s,
        display_name: nameMap.get(s.learner_id) || 'Anonymous',
      }))
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to fetch activity'
      console.error('[AdminActivity] fetch error:', err)
    } finally {
      isLoading.value = false
    }
  }

  function startAutoRefresh() {
    stopAutoRefresh()
    refreshInterval = setInterval(fetchActivity, 60_000)
  }

  function stopAutoRefresh() {
    if (refreshInterval) {
      clearInterval(refreshInterval)
      refreshInterval = null
    }
  }

  return {
    // State
    sessions,
    isLoading,
    error,

    // Computed
    liveSessions,
    sessionsToday,
    learnersToday,
    minutesToday,
    topCourseToday,
    sessionsByHour,

    // Actions
    fetchActivity,
    startAutoRefresh,
    stopAutoRefresh,
  }
}
