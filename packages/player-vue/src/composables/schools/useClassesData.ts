/**
 * useClassesData - Classes list and class detail
 *
 * Provides class data for teacher dashboard and class detail views.
 */

import { ref, computed } from 'vue'
import { getSchoolsClient } from './client'
import { useGodMode } from './useGodMode'
import { useSchoolData } from './useSchoolData'

export interface ClassInfo {
  id: string
  class_name: string
  course_code: string
  school_id: string
  teacher_user_id: string
  student_join_code: string
  current_seed: number
  is_active: boolean
  student_count: number
  avg_seeds_completed: number
  avg_practice_minutes: number
  created_at: string
}

export interface ClassReport {
  class: {
    class_id: string
    class_name: string
    total_cycles: number
    total_sessions: number
    total_practice_seconds: number
    active_students: number
    avg_cycles_per_session: number
    active_days_last_7: number
  }
  schoolAvg: { avg_total_cycles: number; avg_cycles_per_session: number; class_count: number } | null
  regionAvg: { avg_total_cycles: number; avg_cycles_per_session: number; class_count: number } | null
  courseAvg: { avg_total_cycles: number; avg_cycles_per_session: number; class_count: number } | null
}

export interface StudentProgress {
  student_user_id: string
  learner_id: string
  student_name: string
  seeds_completed: number
  legos_mastered: number
  total_practice_minutes: number
  last_active_at: string | null
  joined_class_at: string
}

export interface ClassSession {
  id: string
  class_id: string
  teacher_user_id: string
  started_at: string
  ended_at: string | null
  start_lego_id: string
  end_lego_id: string | null
  cycles_completed: number
  duration_seconds: number
}

const classes = ref<ClassInfo[]>([])
const currentClass = ref<ClassInfo | null>(null)
const classStudents = ref<StudentProgress[]>([])
const isLoading = ref(false)
const error = ref<string | null>(null)

export function useClassesData() {
  const client = getSchoolsClient()
  const { selectedUser, isTeacher, isSchoolAdmin, isGovtAdmin } = useGodMode()
  const { viewingSchool, isViewingSchool } = useSchoolData()

  // The active school ID (drill-down takes precedence)
  const activeSchoolId = computed(() =>
    viewingSchool.value?.id || selectedUser.value?.school_id
  )

  // Fetch classes for current user
  async function fetchClasses(): Promise<void> {
    if (!selectedUser.value) return

    isLoading.value = true
    error.value = null

    try {
      let query = client.from('classes').select(`
        id, class_name, course_code, school_id, teacher_user_id,
        student_join_code, current_seed, is_active, created_at
      `)

      if (isTeacher.value) {
        // Teacher sees only their classes
        query = query.eq('teacher_user_id', selectedUser.value.user_id)
      } else if (isGovtAdmin.value && isViewingSchool.value && activeSchoolId.value) {
        // Govt admin drilled into a school sees all classes in that school
        query = query.eq('school_id', activeSchoolId.value)
      } else if (isGovtAdmin.value && selectedUser.value.region_code) {
        // Govt admin sees all classes in their region's schools
        const { data: regionSchools } = await client
          .from('schools')
          .select('id')
          .eq('region_code', selectedUser.value.region_code)
        const schoolIds = (regionSchools || []).map(s => s.id)
        if (schoolIds.length > 0) {
          query = query.in('school_id', schoolIds)
        } else {
          classes.value = []
          isLoading.value = false
          return
        }
      } else if (isSchoolAdmin.value && selectedUser.value.school_id) {
        // School admin sees all classes in school
        query = query.eq('school_id', selectedUser.value.school_id)
      }

      query = query.eq('is_active', true).order('class_name')

      const { data, error: fetchError } = await query

      if (fetchError) throw fetchError

      // Get student counts per class from class_student_progress view
      const classIds = (data || []).map(c => c.id)

      if (classIds.length > 0) {
        const { data: progressData } = await client
          .from('class_student_progress')
          .select('class_id, seeds_completed, total_practice_seconds')
          .in('class_id', classIds)

        // Aggregate stats per class
        const statsMap = new Map<string, { count: number; totalSeeds: number; totalMinutes: number }>()

        progressData?.forEach(p => {
          const existing = statsMap.get(p.class_id) || { count: 0, totalSeeds: 0, totalMinutes: 0 }
          existing.count++
          existing.totalSeeds += p.seeds_completed
          existing.totalMinutes += (p.total_practice_seconds || 0) / 60
          statsMap.set(p.class_id, existing)
        })

        classes.value = (data || []).map(c => {
          const stats = statsMap.get(c.id) || { count: 0, totalSeeds: 0, totalMinutes: 0 }
          return {
            id: c.id,
            class_name: c.class_name,
            course_code: c.course_code,
            school_id: c.school_id,
            teacher_user_id: c.teacher_user_id,
            student_join_code: c.student_join_code,
            current_seed: c.current_seed,
            is_active: c.is_active,
            student_count: stats.count,
            avg_seeds_completed: stats.count > 0 ? Math.round(stats.totalSeeds / stats.count) : 0,
            avg_practice_minutes: stats.count > 0 ? Math.round(stats.totalMinutes / stats.count) : 0,
            created_at: c.created_at,
          }
        })
      } else {
        classes.value = []
      }
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to fetch classes'
      console.error('Classes fetch error:', err)
    } finally {
      isLoading.value = false
    }
  }

  // Fetch single class detail with students
  async function fetchClassDetail(classId: string): Promise<void> {
    isLoading.value = true
    error.value = null

    try {
      // Fetch class info
      const { data: classData, error: classError } = await client
        .from('classes')
        .select('*')
        .eq('id', classId)
        .single()

      if (classError) throw classError

      // Fetch student progress for this class
      const { data: progressData, error: progressError } = await client
        .from('class_student_progress')
        .select('*')
        .eq('class_id', classId)
        .order('student_name')

      if (progressError) throw progressError

      const students = (progressData || []).map(p => ({
        student_user_id: p.student_user_id,
        learner_id: p.learner_id,
        student_name: p.student_name,
        seeds_completed: p.seeds_completed,
        legos_mastered: p.legos_mastered,
        total_practice_minutes: Math.round((p.total_practice_seconds || 0) / 60),
        last_active_at: p.last_active_at,
        joined_class_at: p.joined_class_at,
      }))

      classStudents.value = students

      // Calculate class stats
      const totalSeeds = students.reduce((sum, s) => sum + s.seeds_completed, 0)
      const totalMinutes = students.reduce((sum, s) => sum + s.total_practice_minutes, 0)

      currentClass.value = {
        id: classData.id,
        class_name: classData.class_name,
        course_code: classData.course_code,
        school_id: classData.school_id,
        teacher_user_id: classData.teacher_user_id,
        student_join_code: classData.student_join_code,
        current_seed: classData.current_seed,
        is_active: classData.is_active,
        student_count: students.length,
        avg_seeds_completed: students.length > 0 ? Math.round(totalSeeds / students.length) : 0,
        avg_practice_minutes: students.length > 0 ? Math.round(totalMinutes / students.length) : 0,
        created_at: classData.created_at,
      }
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to fetch class detail'
      console.error('Class detail fetch error:', err)
    } finally {
      isLoading.value = false
    }
  }

  // Computed
  const totalStudentsInClasses = computed(() => {
    return classes.value.reduce((sum, c) => sum + c.student_count, 0)
  })

  // Combined class detail with students (for ClassDetail.vue)
  const classDetail = computed(() => {
    if (!currentClass.value) return null
    return {
      class_id: currentClass.value.id,
      class_name: currentClass.value.class_name,
      course_code: currentClass.value.course_code,
      school_id: currentClass.value.school_id,
      teacher_user_id: currentClass.value.teacher_user_id,
      student_join_code: currentClass.value.student_join_code,
      current_seed: currentClass.value.current_seed,
      is_active: currentClass.value.is_active,
      created_at: currentClass.value.created_at,
      students: classStudents.value.map(s => ({
        learner_id: s.learner_id,
        user_id: s.student_user_id,
        display_name: s.student_name,
        seeds_completed: s.seeds_completed,
        legos_mastered: s.legos_mastered,
        total_practice_minutes: s.total_practice_minutes,
        last_active_at: s.last_active_at,
        joined_at: s.joined_class_at,
      }))
    }
  })

  // Fetch class report with demographic comparisons
  async function getClassReport(classId: string): Promise<ClassReport | null> {
    try {
      // Fetch class activity stats
      const { data: classStats, error: statsError } = await client
        .from('class_activity_stats')
        .select('*')
        .eq('class_id', classId)
        .single()

      if (statsError || !classStats) return null

      // Fetch demographic averages for comparison
      const { data: demographics } = await client
        .from('demographic_cycle_averages')
        .select('*')
        .in('level', ['school', 'region', 'course'])
        .in('group_id', [
          classStats.school_id,
          classStats.region_code,
          classStats.course_code,
        ].filter(Boolean))

      const findDemographic = (level: string, groupId: string | null) => {
        if (!groupId || !demographics) return null
        const d = demographics.find(d => d.level === level && d.group_id === groupId)
        return d ? { avg_total_cycles: d.avg_total_cycles, avg_cycles_per_session: d.avg_cycles_per_session, class_count: d.class_count } : null
      }

      return {
        class: {
          class_id: classStats.class_id,
          class_name: classStats.class_name,
          total_cycles: classStats.total_cycles,
          total_sessions: classStats.total_sessions,
          total_practice_seconds: classStats.total_practice_seconds,
          active_students: classStats.active_students,
          avg_cycles_per_session: classStats.avg_cycles_per_session,
          active_days_last_7: classStats.active_days_last_7,
        },
        schoolAvg: findDemographic('school', classStats.school_id),
        regionAvg: findDemographic('region', classStats.region_code),
        courseAvg: findDemographic('course', classStats.course_code),
      }
    } catch (err) {
      console.error('Class report fetch error:', err)
      return null
    }
  }

  // Session management (merged from player's useSchoolsData)
  async function startClassSession(
    classId: string,
    teacherUserId: string,
    startLegoId: string
  ): Promise<string | null> {
    try {
      const { data, error: err } = await client
        .from('class_sessions')
        .insert({
          class_id: classId,
          teacher_user_id: teacherUserId,
          start_lego_id: startLegoId,
        })
        .select('id')
        .single()

      if (err) {
        console.error('[ClassesData] Failed to start class session:', err)
        return null
      }
      return data.id
    } catch (err) {
      console.error('[ClassesData] startClassSession error:', err)
      return null
    }
  }

  async function endClassSession(
    sessionId: string,
    endLegoId: string,
    cyclesCompleted: number,
    durationSeconds: number
  ): Promise<void> {
    try {
      const { error: err } = await client
        .from('class_sessions')
        .update({
          ended_at: new Date().toISOString(),
          end_lego_id: endLegoId,
          cycles_completed: cyclesCompleted,
          duration_seconds: durationSeconds,
        })
        .eq('id', sessionId)

      if (err) console.error('[ClassesData] Failed to end class session:', err)
    } catch (err) {
      console.error('[ClassesData] endClassSession error:', err)
    }
  }

  async function getClassSessions(classId: string, limit = 20): Promise<ClassSession[]> {
    try {
      const { data, error: err } = await client
        .from('class_sessions')
        .select('*')
        .eq('class_id', classId)
        .order('started_at', { ascending: false })
        .limit(limit)

      if (err) {
        console.warn('[ClassesData] getClassSessions error:', err.message)
        return []
      }
      return data ?? []
    } catch (err) {
      console.error('[ClassesData] getClassSessions error:', err)
      return []
    }
  }

  async function createClass(params: {
    class_name: string
    course_code: string
    school_id: string
  }): Promise<ClassInfo | null> {
    if (!selectedUser.value) return null

    try {
      const { data: newClass, error: insertError } = await client
        .from('classes')
        .insert({
          class_name: params.class_name,
          course_code: params.course_code,
          school_id: params.school_id,
          teacher_user_id: selectedUser.value.user_id,
          is_active: true,
        })
        .select('id, class_name, course_code, school_id, teacher_user_id, student_join_code, current_seed, is_active, created_at')
        .single()

      if (insertError) throw insertError

      if (newClass.student_join_code) {
        const { error: inviteCodeError } = await client
          .from('invite_codes')
          .insert({
            code: newClass.student_join_code,
            code_type: 'student',
            grants_class_id: newClass.id,
            created_by: selectedUser.value,
            is_active: true,
          })
        if (inviteCodeError) {
          console.error('[ClassesData] Failed to create invite code for student join code:', inviteCodeError)
          // Non-fatal — class still works, just won't resolve through /api/invite/validate
        }
      }

      const classInfo: ClassInfo = {
        id: newClass.id,
        class_name: newClass.class_name,
        course_code: newClass.course_code,
        school_id: newClass.school_id,
        teacher_user_id: newClass.teacher_user_id,
        student_join_code: newClass.student_join_code,
        current_seed: newClass.current_seed,
        is_active: newClass.is_active,
        student_count: 0,
        avg_seeds_completed: 0,
        avg_practice_minutes: 0,
        created_at: newClass.created_at,
      }

      classes.value = [...classes.value, classInfo]
      return classInfo
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to create class'
      console.error('[ClassesData] createClass error:', err)
      return null
    }
  }

  async function updateClassProgress(classId: string, lastLegoId: string): Promise<void> {
    try {
      const { error: err } = await client
        .from('classes')
        .update({ last_lego_id: lastLegoId })
        .eq('id', classId)

      if (err) console.error('[ClassesData] Failed to update class progress:', err)
    } catch (err) {
      console.error('[ClassesData] updateClassProgress error:', err)
    }
  }

  return {
    // State
    classes,
    currentClass,
    classStudents,
    isLoading,
    error,

    // Computed
    totalStudentsInClasses,
    classDetail,

    // Actions
    fetchClasses,
    fetchClassDetail,
    getClassReport,
    createClass,
    startClassSession,
    endClassSession,
    getClassSessions,
    updateClassProgress,
  }
}
