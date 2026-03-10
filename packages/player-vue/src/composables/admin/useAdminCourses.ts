/**
 * useAdminCourses - Course overview with enrollment counts, active learners, average progress
 */

import { ref, computed } from 'vue'
import type { SupabaseClient } from '@supabase/supabase-js'

export interface CourseInfo {
  course_code: string
  known_lang: string
  target_lang: string
  display_name: string | null
  pricing_tier?: string | null
  is_community?: boolean
}

export interface CourseStats {
  course_code: string
  enrolled_count: number
  active_30d: number
  avg_seeds_introduced: number
  total_practice_minutes: number
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
        .select('course_code, known_lang, target_lang, display_name')

      if (courseErr) throw courseErr
      courses.value = courseData || []

      // Fetch all enrollments
      const { data: enrollData, error: enrollErr } = await client
        .from('course_enrollments')
        .select('learner_id, course_id, total_practice_minutes, highest_completed_seed')

      if (enrollErr) throw enrollErr

      // Fetch sessions in last 30 days for active learner count
      const thirtyDaysAgo = new Date()
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

      const { data: sessionData, error: sessErr } = await client
        .from('sessions')
        .select('learner_id, course_id')
        .gte('started_at', thirtyDaysAgo.toISOString())

      if (sessErr) throw sessErr

      // Fetch seed progress for average seeds per course
      const { data: seedData, error: seedErr } = await client
        .from('seed_progress')
        .select('learner_id, course_id')
        .eq('is_introduced', true)

      if (seedErr) throw seedErr

      // Build stats per course
      const statsMap = new Map<string, CourseStats>()

      // Enrollment counts
      const enrollByCourse = new Map<string, Set<string>>()
      const practiceByCourse = new Map<string, number>()
      enrollData?.forEach(e => {
        if (!enrollByCourse.has(e.course_id)) {
          enrollByCourse.set(e.course_id, new Set())
          practiceByCourse.set(e.course_id, 0)
        }
        enrollByCourse.get(e.course_id)!.add(e.learner_id)
        practiceByCourse.set(
          e.course_id,
          (practiceByCourse.get(e.course_id) || 0) + (e.total_practice_minutes || 0)
        )
      })

      // Active learners (30d)
      const activeByCourse = new Map<string, Set<string>>()
      sessionData?.forEach(s => {
        if (!activeByCourse.has(s.course_id)) {
          activeByCourse.set(s.course_id, new Set())
        }
        activeByCourse.get(s.course_id)!.add(s.learner_id)
      })

      // Average seeds introduced per learner per course
      const seedsByCourseLearner = new Map<string, Map<string, number>>()
      seedData?.forEach(s => {
        if (!seedsByCourseLearner.has(s.course_id)) {
          seedsByCourseLearner.set(s.course_id, new Map())
        }
        const learnerMap = seedsByCourseLearner.get(s.course_id)!
        learnerMap.set(s.learner_id, (learnerMap.get(s.learner_id) || 0) + 1)
      })

      courses.value.forEach(c => {
        const code = c.course_code
        const enrolled = enrollByCourse.get(code)?.size || 0
        const seedLearners = seedsByCourseLearner.get(code)
        let avgSeeds = 0
        if (seedLearners && seedLearners.size > 0) {
          let totalSeeds = 0
          seedLearners.forEach(count => { totalSeeds += count })
          avgSeeds = Math.round(totalSeeds / seedLearners.size)
        }

        statsMap.set(code, {
          course_code: code,
          enrolled_count: enrolled,
          active_30d: activeByCourse.get(code)?.size || 0,
          avg_seeds_introduced: avgSeeds,
          total_practice_minutes: practiceByCourse.get(code) || 0,
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
      avg_seeds_introduced: 0,
      total_practice_minutes: 0,
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
