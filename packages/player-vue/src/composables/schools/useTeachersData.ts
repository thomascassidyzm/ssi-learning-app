/**
 * useTeachersData - Teachers in school
 *
 * Provides teacher data for school admin views.
 */

import { ref, computed } from 'vue'
import { getSchoolsClient } from './client'
import { useGodMode } from './useGodMode'
import { useSchoolData } from './useSchoolData'

export interface Teacher {
  user_id: string
  learner_id: string
  display_name: string
  class_count: number
  student_count: number
  total_practice_hours: number
  joined_at: string
}

const teachers = ref<Teacher[]>([])
const isLoading = ref(false)
const error = ref<string | null>(null)

export function useTeachersData() {
  const client = getSchoolsClient()
  const { selectedUser } = useGodMode()
  const { viewingSchool } = useSchoolData()

  // The active school ID (drill-down takes precedence)
  const activeSchoolId = computed(() =>
    viewingSchool.value?.id || selectedUser.value?.school_id
  )

  // Fetch teachers for school
  async function fetchTeachers(schoolId?: string): Promise<void> {
    const targetSchoolId = schoolId || activeSchoolId.value
    if (!targetSchoolId) return

    isLoading.value = true
    error.value = null

    try {
      // Get teacher user_ids from user_tags
      const { data: teacherTags, error: tagsError } = await client
        .from('user_tags')
        .select('user_id, added_at')
        .eq('tag_value', `SCHOOL:${targetSchoolId}`)
        .eq('tag_type', 'school')
        .eq('role_in_context', 'teacher')
        .is('removed_at', null)

      if (tagsError) throw tagsError

      if (!teacherTags || teacherTags.length === 0) {
        teachers.value = []
        return
      }

      const teacherUserIds = teacherTags.map(t => t.user_id)
      const joinDates = new Map(teacherTags.map(t => [t.user_id, t.added_at]))

      // Get learner info
      const { data: learners, error: learnersError } = await client
        .from('learners')
        .select('id, user_id, display_name')
        .in('user_id', teacherUserIds)

      if (learnersError) throw learnersError

      // Get class counts and student counts per teacher
      const { data: classesData, error: classesError } = await client
        .from('classes')
        .select('id, teacher_user_id')
        .eq('school_id', targetSchoolId)
        .eq('is_active', true)
        .in('teacher_user_id', teacherUserIds)

      if (classesError) throw classesError

      const classIds = (classesData || []).map(c => c.id)

      // Count students per teacher via class_student_progress
      const { data: progressData, error: progressError } = await client
        .from('class_student_progress')
        .select('class_id, teacher_user_id, total_practice_seconds')
        .in('class_id', classIds)

      if (progressError) throw progressError

      // Aggregate stats per teacher
      const statsMap = new Map<string, { classes: Set<string>; students: number; practiceSeconds: number }>()

      classesData?.forEach(c => {
        const existing = statsMap.get(c.teacher_user_id) || { classes: new Set(), students: 0, practiceSeconds: 0 }
        existing.classes.add(c.id)
        statsMap.set(c.teacher_user_id, existing)
      })

      progressData?.forEach(p => {
        const existing = statsMap.get(p.teacher_user_id)
        if (existing) {
          existing.students++
          existing.practiceSeconds += p.total_practice_seconds || 0
        }
      })

      teachers.value = (learners || []).map(l => {
        const stats = statsMap.get(l.user_id) || { classes: new Set(), students: 0, practiceSeconds: 0 }
        return {
          user_id: l.user_id,
          learner_id: l.id,
          display_name: l.display_name,
          class_count: stats.classes.size,
          student_count: stats.students,
          total_practice_hours: Math.round((stats.practiceSeconds / 3600) * 10) / 10,
          joined_at: joinDates.get(l.user_id) || '',
        }
      }).sort((a, b) => a.display_name.localeCompare(b.display_name))
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to fetch teachers'
      console.error('Teachers fetch error:', err)
    } finally {
      isLoading.value = false
    }
  }

  return {
    // State
    teachers,
    isLoading,
    error,

    // Actions
    fetchTeachers,
  }
}
