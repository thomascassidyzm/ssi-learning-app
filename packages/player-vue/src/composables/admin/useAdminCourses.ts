/**
 * useAdminCourses - Course overview with enrollment counts, active learners, practice minutes
 */

import { ref, computed } from 'vue'
import { fetchPracticeByCourse } from '../practiceByCourse'
import type { SupabaseClient } from '@supabase/supabase-js'

interface CourseInfo {
  course_code: string
  known_lang: string
  target_lang: string
  display_name: string | null
  pricing_tier?: string | null
  is_community?: boolean
}

interface CourseStats {
  course_code: string
  enrolled_count: number
  active_30d: number
  total_practice_minutes: number
  /** True when total_practice_minutes includes a position-derived estimate
   *  for at least one learner (no session logs for that learner+course). */
  total_practice_minutes_estimated: boolean
}

const courses = ref<CourseInfo[]>([])
const courseStats = ref<Map<string, CourseStats>>(new Map())

const isLoading = ref(false)
const error = ref<string | null>(null)
const sortBy = ref<'enrolled' | 'active' | 'name'>('enrolled')

export function useAdminCourses(client: SupabaseClient) {

  // Hero stats
  const totalCourses = computed(() => courses.value.length)
  const totalEnrollments = computed(() => {
    let sum = 0
    courseStats.value.forEach(s => { sum += s.enrolled_count })
    return sum
  })
  const totalActive30d = computed(() => {
    let sum = 0
    courseStats.value.forEach(s => { sum += s.active_30d })
    return sum
  })

  // Sorted courses
  const sortedCourses = computed(() => {
    const arr = [...courses.value]
    arr.sort((a, b) => {
      const statsA = courseStats.value.get(a.course_code)
      const statsB = courseStats.value.get(b.course_code)
      if (sortBy.value === 'enrolled') {
        return (statsB?.enrolled_count || 0) - (statsA?.enrolled_count || 0)
      }
      if (sortBy.value === 'active') {
        return (statsB?.active_30d || 0) - (statsA?.active_30d || 0)
      }
      return (a.display_name || a.course_code).localeCompare(b.display_name || b.course_code)
    })
    return arr
  })

  async function fetchCourses(): Promise<void> {
    isLoading.value = true
    error.value = null

    try {
      // Fetch all courses
      const { data: courseData, error: courseErr } = await client
        .from('courses')
        .select('course_code, known_lang, target_lang, display_name, pricing_tier, is_community')

      if (courseErr) throw courseErr
      courses.value = courseData || []

      // Each stat below is fetched independently and degrades on its own
      // failure — a slow/failing query (e.g. a full-table-scan timeout) must
      // never wipe out stats that already loaded successfully from other
      // queries. A missing stat renders as its own zero (not a false "this
      // course really has 0"), and `error.value` records that a load was
      // partial so the gap is visible rather than a confident wrong number.
      const partialFailures: string[] = []

      // Enrollments (for per-course enrolled counts)
      let enrollData: Array<{ learner_id: string; course_id: string }> | null = null
      try {
        const { data, error: enrollErr } = await client
          .from('course_enrollments')
          .select('learner_id, course_id')
        if (enrollErr) throw enrollErr
        enrollData = data
      } catch (enrollErr) {
        console.error('[AdminCourses] enrollments fetch error:', enrollErr)
        partialFailures.push('enrolments')
      }

      // Practice minutes per course, derived from telemetry (player_events) —
      // the SSoT. course_enrollments.total_practice_minutes is a dead counter
      // (stopped being written ~mid-April 2026).
      // Server-mediated: /api/school/practice-by-course with no learner_ids is
      // the platform-wide aggregate, admin-only and enforced server-side. The
      // old direct RPC also served any signed-in caller a NAMED learner's
      // history, which is why it is now service_role only.
      let practiceData: Array<{ course_code: string; practice_minutes: number }> | null = null
      try {
        practiceData = await fetchPracticeByCourse(client, null)
      } catch (practiceErr) {
        console.error('[AdminCourses] practice fetch error:', practiceErr)
        partialFailures.push('practice minutes')
      }

      // Sessions in last 30 days, for active-learner count
      const thirtyDaysAgo = new Date()
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

      let sessionData: Array<{ learner_id: string; course_id: string }> | null = null
      try {
        const { data, error: sessErr } = await client
          .from('sessions')
          .select('learner_id, course_id')
          .gte('started_at', thirtyDaysAgo.toISOString())
        if (sessErr) throw sessErr
        sessionData = data
      } catch (sessErr) {
        console.error('[AdminCourses] sessions fetch error:', sessErr)
        partialFailures.push('active learners')
      }

      if (partialFailures.length > 0) {
        error.value = `Some stats failed to load (${partialFailures.join(', ')}) — figures below may be incomplete.`
      }

      // Build stats per course
      const statsMap = new Map<string, CourseStats>()

      // Enrollment counts
      const enrollByCourse = new Map<string, Set<string>>()
      enrollData?.forEach(e => {
        if (!enrollByCourse.has(e.course_id)) enrollByCourse.set(e.course_id, new Set())
        enrollByCourse.get(e.course_id)!.add(e.learner_id)
      })

      // Telemetry-derived practice minutes per course (keyed by course_code,
      // which equals course_enrollments.course_id in this DB).
      const practiceByCourse = new Map<string, number>()
      const practiceEstimatedByCourse = new Map<string, boolean>()
      ;(practiceData || []).forEach((r: any) => {
        practiceByCourse.set(r.course_code, r.practice_minutes || 0)
        practiceEstimatedByCourse.set(r.course_code, !!r.is_estimated)
      })

      // Active learners (30d)
      const activeByCourse = new Map<string, Set<string>>()
      sessionData?.forEach(s => {
        if (!activeByCourse.has(s.course_id)) {
          activeByCourse.set(s.course_id, new Set())
        }
        activeByCourse.get(s.course_id)!.add(s.learner_id)
      })

      courses.value.forEach(c => {
        const code = c.course_code
        statsMap.set(code, {
          course_code: code,
          enrolled_count: enrollByCourse.get(code)?.size || 0,
          active_30d: activeByCourse.get(code)?.size || 0,
          total_practice_minutes: practiceByCourse.get(code) || 0,
          total_practice_minutes_estimated: practiceEstimatedByCourse.get(code) || false,
        })
      })

      courseStats.value = statsMap
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to fetch courses'
      console.error('[AdminCourses] fetch error:', err)
    } finally {
      isLoading.value = false
    }
  }

  function getStats(courseCode: string): CourseStats {
    return courseStats.value.get(courseCode) || {
      course_code: courseCode,
      enrolled_count: 0,
      active_30d: 0,
      total_practice_minutes: 0,
      total_practice_minutes_estimated: false,
    }
  }

  function setSortBy(sort: 'enrolled' | 'active' | 'name') {
    sortBy.value = sort
  }

  return {
    courses: sortedCourses,
    courseStats,
    isLoading,
    error,
    sortBy,

    // Hero stats
    totalCourses,
    totalEnrollments,
    totalActive30d,

    // Actions
    fetchCourses,
    getStats,
    setSortBy,
  }
}
