/**
 * useStudentsData - Students data
 *
 * Provides student data for various views.
 */

import { ref, computed } from 'vue'
import { getSchoolsClient } from './client'
import { useGodMode } from './useGodMode'
import { useSchoolData } from './useSchoolData'

export interface Student {
  user_id: string
  learner_id: string
  display_name: string
  class_id: string
  class_name: string
  course_code: string
  seeds_completed: number
  legos_mastered: number
  total_practice_minutes: number
  last_active_at: string | null
  joined_class_at: string
}

const students = ref<Student[]>([])
const isLoading = ref(false)
const error = ref<string | null>(null)

export function useStudentsData() {
  const client = getSchoolsClient()
  const { selectedUser, isTeacher, isSchoolAdmin, isGovtAdmin } = useGodMode()
  const { viewingSchool, isViewingSchool } = useSchoolData()

  // The active school ID (drill-down takes precedence)
  const activeSchoolId = computed(() =>
    viewingSchool.value?.id || selectedUser.value?.school_id
  )

  // Fetch all students for school or teacher's classes
  async function fetchStudents(): Promise<void> {
    if (!selectedUser.value) return

    isLoading.value = true
    error.value = null

    try {
      let classIds: string[] = []

      if (isTeacher.value) {
        // Get teacher's class IDs
        const { data: classesData, error: classesError } = await client
          .from('classes')
          .select('id')
          .eq('teacher_user_id', selectedUser.value.user_id)
          .eq('is_active', true)

        if (classesError) throw classesError
        classIds = (classesData || []).map(c => c.id)
      } else if (isGovtAdmin.value && isViewingSchool.value && activeSchoolId.value) {
        // Govt admin drilled into a school - get all class IDs in that school
        const { data: classesData, error: classesError } = await client
          .from('classes')
          .select('id')
          .eq('school_id', activeSchoolId.value)
          .eq('is_active', true)

        if (classesError) throw classesError
        classIds = (classesData || []).map(c => c.id)
      } else if (isGovtAdmin.value && selectedUser.value.region_code) {
        // Govt admin region view - get all class IDs in region's schools
        const { data: regionSchools } = await client
          .from('schools')
          .select('id')
          .eq('region_code', selectedUser.value.region_code)
        const schoolIds = (regionSchools || []).map(s => s.id)
        if (schoolIds.length > 0) {
          const { data: classesData, error: classesError } = await client
            .from('classes')
            .select('id')
            .in('school_id', schoolIds)
            .eq('is_active', true)
          if (classesError) throw classesError
          classIds = (classesData || []).map(c => c.id)
        }
      } else if (isSchoolAdmin.value && selectedUser.value.school_id) {
        // Get all class IDs in school
        const { data: classesData, error: classesError } = await client
          .from('classes')
          .select('id')
          .eq('school_id', selectedUser.value.school_id)
          .eq('is_active', true)

        if (classesError) throw classesError
        classIds = (classesData || []).map(c => c.id)
      }

      if (classIds.length === 0) {
        students.value = []
        return
      }

      // Fetch student progress
      const { data: progressData, error: progressError } = await client
        .from('class_student_progress')
        .select('*')
        .in('class_id', classIds)
        .order('student_name')

      if (progressError) throw progressError

      students.value = (progressData || []).map(p => ({
        user_id: p.student_user_id,
        learner_id: p.learner_id,
        display_name: p.student_name,
        class_id: p.class_id,
        class_name: p.class_name,
        course_code: p.course_code,
        seeds_completed: p.seeds_completed,
        legos_mastered: p.legos_mastered,
        total_practice_minutes: Math.round((p.total_practice_seconds || 0) / 60),
        last_active_at: p.last_active_at,
        joined_class_at: p.joined_class_at,
      }))
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to fetch students'
      console.error('Students fetch error:', err)
    } finally {
      isLoading.value = false
    }
  }

  // Computed stats
  const totalStudents = computed(() => students.value.length)

  const avgSeedsCompleted = computed(() => {
    if (students.value.length === 0) return 0
    const total = students.value.reduce((sum, s) => sum + s.seeds_completed, 0)
    return Math.round(total / students.value.length)
  })

  const avgPracticeMinutes = computed(() => {
    if (students.value.length === 0) return 0
    const total = students.value.reduce((sum, s) => sum + s.total_practice_minutes, 0)
    return Math.round(total / students.value.length)
  })

  const activeToday = computed(() => {
    const today = new Date().toISOString().split('T')[0]
    return students.value.filter(s =>
      s.last_active_at && s.last_active_at.startsWith(today)
    ).length
  })

  const activeThisWeek = computed(() => {
    const weekAgo = new Date()
    weekAgo.setDate(weekAgo.getDate() - 7)
    return students.value.filter(s =>
      s.last_active_at && new Date(s.last_active_at) >= weekAgo
    ).length
  })

  // Group students by class
  const studentsByClass = computed(() => {
    const grouped = new Map<string, Student[]>()
    students.value.forEach(s => {
      const existing = grouped.get(s.class_id) || []
      existing.push(s)
      grouped.set(s.class_id, existing)
    })
    return grouped
  })

  return {
    // State
    students,
    isLoading,
    error,

    // Computed
    totalStudents,
    avgSeedsCompleted,
    avgPracticeMinutes,
    activeToday,
    activeThisWeek,
    studentsByClass,

    // Actions
    fetchStudents,
  }
}
