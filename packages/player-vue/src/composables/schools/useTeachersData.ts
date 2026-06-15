/**
 * useTeachersData - Teachers in school
 *
 * Provides teacher data for school admin views.
 */

import { ref, computed } from 'vue'
import { getSchoolsClient } from './client'
import { useSchoolContext } from './useSchoolContext'
import { useSchoolData } from './useSchoolData'
import { isDemoMode } from '../demo/demoMode'
import { teachersByClassId } from './classTeacherScope'

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
  const { currentUser: selectedUser } = useSchoolContext()
  const { viewingSchool } = useSchoolData()

  // The active school ID (drill-down takes precedence)
  const activeSchoolId = computed(() =>
    viewingSchool.value?.id || selectedUser.value?.school_id
  )

  // Fetch teachers for school
  async function fetchTeachers(schoolId?: string): Promise<void> {
    if (isDemoMode.value) return
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

      // Class & student counts per teacher, attributed via the teacher↔class
      // RELATIONSHIP (class_teachers: lead + co-taught) rather than the legacy
      // ownership column — so a co-teacher's counts include classes they share,
      // and a class with two teachers counts for both. See classTeacherScope.
      const { data: schoolClasses, error: classesError } = await client
        .from('classes')
        .select('id')
        .eq('school_id', targetSchoolId)
        .eq('is_active', true)

      if (classesError) throw classesError

      const classIds = (schoolClasses || []).map(c => c.id)
      const teacherMap = await teachersByClassId(classIds) // class_id -> [{user_id,is_lead}]

      // Per-class student count + practice seconds, from class_student_progress
      const { data: progressData, error: progressError } = await client
        .from('class_student_progress')
        .select('class_id, total_practice_seconds')
        .in('class_id', classIds)

      if (progressError) throw progressError

      const perClass = new Map<string, { students: number; seconds: number }>()
      progressData?.forEach(p => {
        const e = perClass.get(p.class_id) || { students: 0, seconds: 0 }
        e.students++
        e.seconds += p.total_practice_seconds || 0
        perClass.set(p.class_id, e)
      })

      // Aggregate stats per teacher, restricted to this school's teacher list
      const teacherIdSet = new Set(teacherUserIds)
      const statsMap = new Map<string, { classes: Set<string>; students: number; practiceSeconds: number }>()
      for (const [cid, list] of teacherMap) {
        const cls = perClass.get(cid) || { students: 0, seconds: 0 }
        for (const t of list) {
          if (!teacherIdSet.has(t.user_id)) continue
          const existing = statsMap.get(t.user_id) || { classes: new Set(), students: 0, practiceSeconds: 0 }
          existing.classes.add(cid)
          existing.students += cls.students
          existing.practiceSeconds += cls.seconds
          statsMap.set(t.user_id, existing)
        }
      }

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
