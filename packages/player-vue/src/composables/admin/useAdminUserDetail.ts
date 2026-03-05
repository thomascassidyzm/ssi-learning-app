/**
 * useAdminUserDetail - Full profile, enrollments, sessions, progress for one user
 */

import { ref } from 'vue'
import { getSchoolsClient } from '@/composables/schools/client'

export interface UserProfile {
  id: string
  user_id: string
  display_name: string
  created_at: string
  educational_role: string | null
  platform_role: string | null
}

export interface DetailEnrollment {
  course_id: string
  last_practiced_at: string | null
  total_practice_minutes: number
  highest_completed_seed: number | null
}

export interface DetailSession {
  id: string
  course_id: string
  started_at: string
  ended_at: string | null
  duration_seconds: number | null
  items_practiced: number | null
}

export interface CourseProgress {
  course_id: string
  seeds_introduced: number
  legos_seen: number
  legos_retired: number
}

const profile = ref<UserProfile | null>(null)
const enrollments = ref<DetailEnrollment[]>([])
const sessions = ref<DetailSession[]>([])
const courseProgress = ref<Map<string, CourseProgress>>(new Map())

const isLoading = ref(false)
const error = ref<string | null>(null)

export function useAdminUserDetail() {
  const client = getSchoolsClient()

  async function fetchUserDetail(learnerId: string): Promise<void> {
    isLoading.value = true
    error.value = null

    try {
      // Fetch all data in parallel
      const [profileResult, enrollResult, sessResult] = await Promise.all([
        client
          .from('learners')
          .select('id, user_id, display_name, created_at, educational_role, platform_role')
          .eq('id', learnerId)
          .single(),
        client
          .from('course_enrollments')
          .select('course_id, last_practiced_at, total_practice_minutes, highest_completed_seed')
          .eq('learner_id', learnerId),
        client
          .from('sessions')
          .select('id, course_id, started_at, ended_at, duration_seconds, items_practiced')
          .eq('learner_id', learnerId)
          .order('started_at', { ascending: false })
          .limit(50),
      ])

      if (profileResult.error) throw profileResult.error
      if (enrollResult.error) throw enrollResult.error
      if (sessResult.error) throw sessResult.error

      profile.value = profileResult.data
      enrollments.value = enrollResult.data || []
      sessions.value = sessResult.data || []

      // Fetch progress per course
      const courseIds = enrollments.value.map(e => e.course_id)
      if (courseIds.length > 0) {
        const progressMap = new Map<string, CourseProgress>()

        const [seedResult, legoResult] = await Promise.all([
          client
            .from('seed_progress')
            .select('course_id')
            .eq('learner_id', learnerId)
            .eq('is_introduced', true),
          client
            .from('lego_progress')
            .select('course_id, is_retired')
            .eq('learner_id', learnerId),
        ])

        // Count seeds introduced per course
        const seedCounts = new Map<string, number>()
        seedResult.data?.forEach(s => {
          seedCounts.set(s.course_id, (seedCounts.get(s.course_id) || 0) + 1)
        })

        // Count legos seen/retired per course
        const legoCounts = new Map<string, { seen: number; retired: number }>()
        legoResult.data?.forEach(l => {
          const entry = legoCounts.get(l.course_id) || { seen: 0, retired: 0 }
          entry.seen++
          if (l.is_retired) entry.retired++
          legoCounts.set(l.course_id, entry)
        })

        courseIds.forEach(courseId => {
          progressMap.set(courseId, {
            course_id: courseId,
            seeds_introduced: seedCounts.get(courseId) || 0,
            legos_seen: legoCounts.get(courseId)?.seen || 0,
            legos_retired: legoCounts.get(courseId)?.retired || 0,
          })
        })

        courseProgress.value = progressMap
      }
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to fetch user detail'
      console.error('[AdminUserDetail] fetch error:', err)
    } finally {
      isLoading.value = false
    }
  }

  function getCourseProgress(courseId: string): CourseProgress {
    return courseProgress.value.get(courseId) || {
      course_id: courseId,
      seeds_introduced: 0,
      legos_seen: 0,
      legos_retired: 0,
    }
  }

  return {
    profile,
    enrollments,
    sessions,
    courseProgress,
    isLoading,
    error,
    fetchUserDetail,
    getCourseProgress,
  }
}
