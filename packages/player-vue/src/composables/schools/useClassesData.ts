/**
 * useClassesData - Classes list and class detail
 *
 * Provides class data for teacher dashboard and class detail views.
 */

import { ref, computed } from 'vue'
import { getSchoolsClient } from './client'
import { useSchoolContext } from './useSchoolContext'
import { useSchoolData } from './useSchoolData'
import { useStudentsData } from './useStudentsData'
import { isDemoMode } from '../demo/demoMode'
import { assertScope } from './rlsGuard'
import { deriveBelt as bucketBelt, type Belt } from './belts'
import { myTaughtClassIds, teachersByClassId, type ClassTeacherRef } from './classTeacherScope'

export type { Belt }

export interface ClassInfo {
  id: string
  class_name: string
  course_code: string
  school_id: string
  teacher_user_id: string  // lead-teacher pointer (denormalised); full set in `teachers`
  student_join_code: string
  current_seed: number
  last_lego_id: string | null
  // The class's own learner identity (owner ruling 2026-07-16: a class is a
  // first-class learner citizen). Null only for the brief window between
  // class creation and create-class-learner's follow-up call succeeding.
  class_learner_id: string | null
  is_active: boolean
  student_count: number
  avg_seeds_completed: number
  avg_practice_minutes: number
  created_at: string
  // Dashboard extras — optional so creators (createClass, demo mode)
  // don't have to populate them. Wired by fetchClasses / fetchClassDetail.
  teachers?: ClassTeacherRef[]  // active teacher↔class relationships (lead flagged)
  belt_distribution?: Record<Belt, number>
  activity_last_7?: number[]
  journey_done?: number
  journey_total?: number
}

// Belt buckets keyed off seeds_completed — canonical deriveBelt (see belts.ts).

// Last 7 days as ISO date strings, oldest first. Index 0 = 6 days ago, 6 = today.
function last7Days(): string[] {
  const out: string[] = []
  const today = new Date()
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    out.push(d.toISOString().split('T')[0])
  }
  return out
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
  groupAvg: { avg_total_cycles: number; avg_cycles_per_session: number; class_count: number } | null
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
  const { currentUser: selectedUser, isTeacher, isSchoolAdmin, isGovtAdmin } = useSchoolContext()
  const { viewingSchool, isViewingSchool } = useSchoolData()

  // The active school ID (drill-down takes precedence)
  const activeSchoolId = computed(() =>
    viewingSchool.value?.id || selectedUser.value?.school_id
  )

  // Total LEGOs per course (for JourneyBar). PostgREST count via head request —
  // one round-trip per course is fine for the small handful of courses a
  // school runs. Result map is keyed by course_code, value = total LEGO count.
  async function fetchCourseLegoTotals(codes: string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>()
    if (codes.length === 0) return out
    await Promise.all(codes.map(async code => {
      try {
        const { count } = await client
          .from('course_legos')
          .select('*', { count: 'exact', head: true })
          .eq('course_code', code)
        out.set(code, count ?? 0)
      } catch {
        out.set(code, 0)
      }
    }))
    return out
  }

  // Fetch classes for current user
  async function fetchClasses(): Promise<void> {
    if (isDemoMode.value) return
    if (!selectedUser.value) return

    isLoading.value = true
    error.value = null

    try {
      let query = client.from('classes').select(`
        id, class_name, course_code, school_id, teacher_user_id,
        student_join_code, current_seed, last_lego_id, class_learner_id, is_active, created_at
      `)

      // Track scope for the RLS tripwire (rlsGuard.ts). Teachers are scoped by
      // class MEMBERSHIP (the class_teachers relationship, lead + co-taught —
      // a teacher can legitimately teach at multiple schools); school/govt
      // admins are scoped by school_id.
      let allowedSchoolIds: string[] = []
      let allowedClassIds: string[] | null = null

      if (isTeacher.value) {
        // "My classes" = the teacher↔class relationship, not the legacy
        // ownership column. See classTeacherScope.
        const myClassIds = await myTaughtClassIds(selectedUser.value.user_id)
        if (myClassIds.length === 0) {
          classes.value = []
          isLoading.value = false
          return
        }
        query = query.in('id', myClassIds)
        allowedClassIds = myClassIds
      } else if (isGovtAdmin.value && isViewingSchool.value && activeSchoolId.value) {
        // Govt admin drilled into a school sees all classes in that school
        query = query.eq('school_id', activeSchoolId.value)
        allowedSchoolIds = [activeSchoolId.value]
      } else if (isGovtAdmin.value && (selectedUser.value.group_id || selectedUser.value.region_code)) {
        // Govt admin sees all classes in their group subtree's schools
        let schoolIds: string[] = []
        if (selectedUser.value.group_path) {
          const { data: subtreeGroups } = await client.from('groups').select('id').like('path', selectedUser.value.group_path + '%')
          const groupIds = (subtreeGroups || []).map(g => g.id)
          if (groupIds.length > 0) {
            const { data: groupSchools } = await client.from('schools').select('id').in('group_id', groupIds)
            schoolIds = (groupSchools || []).map(s => s.id)
          }
        } else {
          const { data: regionSchools } = await client.from('schools').select('id').eq('region_code', selectedUser.value.region_code!)
          schoolIds = (regionSchools || []).map(s => s.id)
        }
        if (schoolIds.length > 0) {
          query = query.in('school_id', schoolIds)
          allowedSchoolIds = schoolIds
        } else {
          classes.value = []
          isLoading.value = false
          return
        }
      } else if (isSchoolAdmin.value && selectedUser.value.school_id) {
        // School admin sees all classes in school
        query = query.eq('school_id', selectedUser.value.school_id)
        allowedSchoolIds = [selectedUser.value.school_id]
      }

      query = query.eq('is_active', true).order('class_name')

      const { data, error: fetchError } = await query

      if (fetchError) throw fetchError

      // Client-side RLS tripwire: returned rows must match the caller's
      // declared scope (school_id for admins, teacher_user_id for teachers).
      // In production we silently filter + log [RLS_VIOLATION]; in dev/test
      // we throw. Catches accidental query changes and RLS regressions.
      let safeData: typeof data | [] = data || []
      if (allowedSchoolIds.length > 0) {
        safeData = assertScope(safeData, 'school_id', allowedSchoolIds, {
          table: 'classes',
          caller: 'useClassesData.fetchClasses',
        })
      }
      if (allowedClassIds) {
        safeData = assertScope(safeData, 'id', allowedClassIds, {
          table: 'classes',
          caller: 'useClassesData.fetchClasses (teacher membership)',
        })
      }

      // Get student counts per class from class_student_progress view
      const classIds = safeData.map(c => c.id)

      if (classIds.length > 0) {
        const { data: progressData } = await client
          .from('class_student_progress')
          .select('class_id, seeds_completed, total_practice_seconds')
          .in('class_id', classIds)

        // Aggregate stats per class + belt distribution
        type ClassStats = {
          count: number
          totalSeeds: number
          totalMinutes: number
          belts: Record<Belt, number>
        }
        const emptyBelts = (): Record<Belt, number> =>
          ({ white: 0, yellow: 0, orange: 0, green: 0, blue: 0, purple: 0, brown: 0, black: 0 })
        const statsMap = new Map<string, ClassStats>()

        progressData?.forEach(p => {
          const existing = statsMap.get(p.class_id) || {
            count: 0, totalSeeds: 0, totalMinutes: 0, belts: emptyBelts(),
          }
          existing.count++
          existing.totalSeeds += p.seeds_completed
          existing.totalMinutes += (p.total_practice_seconds || 0) / 60
          existing.belts[bucketBelt(p.seeds_completed || 0)]++
          statsMap.set(p.class_id, existing)
        })

        // 7-day activity sparkline: sum cycles_completed by day from class_sessions.
        const sevenDaysAgo = new Date()
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6)
        sevenDaysAgo.setHours(0, 0, 0, 0)
        const { data: sessionRows } = await client
          .from('class_sessions')
          .select('class_id, started_at, cycles_completed')
          .in('class_id', classIds)
          .gte('started_at', sevenDaysAgo.toISOString())

        const days = last7Days()
        const dayIndex = new Map(days.map((d, i) => [d, i]))
        const sparkMap = new Map<string, number[]>()
        sessionRows?.forEach(s => {
          const key = (s.started_at || '').split('T')[0]
          const idx = dayIndex.get(key)
          if (idx === undefined) return
          const arr = sparkMap.get(s.class_id) || Array(7).fill(0)
          arr[idx] += s.cycles_completed || 0
          sparkMap.set(s.class_id, arr)
        })

        // Journey total: count of LEGOs per course_code. Fetch once per unique
        // course, then map back. Done per class = current_seed (its seed position).
        const courseCodes = Array.from(new Set(safeData.map(c => c.course_code).filter(Boolean)))
        const courseLegoTotals = await fetchCourseLegoTotals(courseCodes)
        const teacherMap = await teachersByClassId(classIds)

        classes.value = safeData.map(c => {
          const stats = statsMap.get(c.id) || {
            count: 0, totalSeeds: 0, totalMinutes: 0, belts: emptyBelts(),
          }
          const total = courseLegoTotals.get(c.course_code) ?? 0
          return {
            id: c.id,
            class_name: c.class_name,
            course_code: c.course_code,
            school_id: c.school_id,
            teacher_user_id: c.teacher_user_id,
            student_join_code: c.student_join_code,
            current_seed: c.current_seed,
            last_lego_id: c.last_lego_id || null,
            class_learner_id: c.class_learner_id || null,
            is_active: c.is_active,
            student_count: stats.count,
            avg_seeds_completed: stats.count > 0 ? Math.round(stats.totalSeeds / stats.count) : 0,
            avg_practice_minutes: stats.count > 0 ? Math.round(stats.totalMinutes / stats.count) : 0,
            created_at: c.created_at,
            belt_distribution: stats.belts,
            activity_last_7: sparkMap.get(c.id) || Array(7).fill(0),
            journey_done: total > 0 ? Math.min(total, c.current_seed || 0) : (c.current_seed || 0),
            journey_total: total,
            teachers: teacherMap.get(c.id) ?? [],
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
    if (isDemoMode.value) {
      // In demo mode, populate from pre-injected data (no Supabase queries)
      const cls = classes.value.find(c => c.id === classId)
      if (cls) {
        const { students: allStudents } = useStudentsData()
        const classStudentList = allStudents.value.filter(s => s.class_id === classId)

        classStudents.value = classStudentList.map(s => ({
          student_user_id: s.user_id,
          learner_id: s.learner_id,
          student_name: s.display_name,
          seeds_completed: s.seeds_completed,
          legos_mastered: s.legos_mastered,
          total_practice_minutes: s.total_practice_minutes,
          last_active_at: s.last_active_at,
          joined_class_at: s.joined_class_at,
        }))

        currentClass.value = { ...cls, student_count: classStudentList.length }
      }
      return
    }

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

      // Belt distribution from student seeds_completed
      const belts: Record<Belt, number> = { white: 0, yellow: 0, orange: 0, green: 0, blue: 0, purple: 0, brown: 0, black: 0 }
      students.forEach(s => { belts[bucketBelt(s.seeds_completed || 0)]++ })

      // 7-day sparkline from class_sessions for this class
      const sevenDaysAgo = new Date()
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6)
      sevenDaysAgo.setHours(0, 0, 0, 0)
      const { data: sessionRows } = await client
        .from('class_sessions')
        .select('started_at, cycles_completed')
        .eq('class_id', classId)
        .gte('started_at', sevenDaysAgo.toISOString())

      const days = last7Days()
      const dayIndex = new Map(days.map((d, i) => [d, i]))
      const spark = Array(7).fill(0)
      sessionRows?.forEach(s => {
        const key = (s.started_at || '').split('T')[0]
        const idx = dayIndex.get(key)
        if (idx !== undefined) spark[idx] += s.cycles_completed || 0
      })

      // Journey total: count LEGOs for this course
      const courseTotals = await fetchCourseLegoTotals([classData.course_code].filter(Boolean))
      const journeyTotal = courseTotals.get(classData.course_code) ?? 0

      // Active teacher↔class relationships for this class (lead + co-taught)
      const detailTeachers = (await teachersByClassId([classId])).get(classId) ?? []

      currentClass.value = {
        id: classData.id,
        class_name: classData.class_name,
        course_code: classData.course_code,
        school_id: classData.school_id,
        teacher_user_id: classData.teacher_user_id,
        teachers: detailTeachers,
        student_join_code: classData.student_join_code,
        current_seed: classData.current_seed,
        last_lego_id: classData.last_lego_id || null,
        class_learner_id: classData.class_learner_id || null,
        is_active: classData.is_active,
        student_count: students.length,
        avg_seeds_completed: students.length > 0 ? Math.round(totalSeeds / students.length) : 0,
        avg_practice_minutes: students.length > 0 ? Math.round(totalMinutes / students.length) : 0,
        created_at: classData.created_at,
        belt_distribution: belts,
        activity_last_7: spark,
        journey_done: journeyTotal > 0
          ? Math.min(journeyTotal, classData.current_seed || 0)
          : (classData.current_seed || 0),
        journey_total: journeyTotal,
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
      last_lego_id: currentClass.value.last_lego_id,
      class_learner_id: currentClass.value.class_learner_id,
      is_active: currentClass.value.is_active,
      created_at: currentClass.value.created_at,
      belt_distribution: currentClass.value.belt_distribution,
      activity_last_7: currentClass.value.activity_last_7,
      journey_done: currentClass.value.journey_done,
      journey_total: currentClass.value.journey_total,
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
        groupAvg: findDemographic('region', classStats.region_code),
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

  /**
   * Persist the end-of-session state. Returns `true` on a confirmed write,
   * `false` when the write errored or threw. Callers MUST consume this — a
   * silent `void` here was a "false Saved" hazard (RLS doctrine rule 8): the
   * resume pointer `end_lego_id` could go unwritten with zero signal.
   */
  async function endClassSession(
    sessionId: string,
    endLegoId: string,
    cyclesCompleted: number,
    durationSeconds: number
  ): Promise<boolean> {
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

      if (err) {
        console.error('[ClassesData] Failed to end class session:', err)
        return false
      }
      return true
    } catch (err) {
      console.error('[ClassesData] endClassSession error:', err)
      return false
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

  // Service-role write for teacher↔class relationships (RLS forbids a client
  // teacher-tag insert). Used by createClass to seed the lead, and by the
  // teacher-management surface to add / remove / hand over teachers.
  async function callClassTeachersApi(body: {
    class_id: string
    action: 'add' | 'remove'
    target_user_id: string
    set_lead?: boolean
  }): Promise<boolean> {
    try {
      const { data: { session } } = await client.auth.getSession()
      const token = session?.access_token
      if (!token) {
        console.warn('[ClassesData] No auth token; skipping class-teacher write')
        return false
      }
      const resp = await fetch('/api/teacher/class-teachers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      })
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}))
        console.error('[ClassesData] class-teacher write failed:', data.error || resp.status)
        return false
      }
      return true
    } catch (err) {
      console.error('[ClassesData] class-teacher fetch error:', err)
      return false
    }
  }

  /** Add (or reactivate) a teacher on a class; `lead` also points the lead pointer at them. */
  async function addClassTeacher(
    classId: string,
    targetUserId: string,
    opts?: { lead?: boolean }
  ): Promise<boolean> {
    return callClassTeachersApi({ class_id: classId, action: 'add', target_user_id: targetUserId, set_lead: opts?.lead })
  }

  /** Soft-remove a teacher from a class; the server hands the lead on if needed. */
  async function removeClassTeacher(classId: string, targetUserId: string): Promise<boolean> {
    return callClassTeachersApi({ class_id: classId, action: 'remove', target_user_id: targetUserId })
  }

  async function createClass(params: {
    class_name: string
    course_code: string
    school_id: string
  }): Promise<ClassInfo | null> {
    if (!selectedUser.value) return null
    const creatorUserId = selectedUser.value.user_id

    try {
      const { data: newClass, error: insertError } = await client
        .from('classes')
        .insert({
          class_name: params.class_name,
          course_code: params.course_code,
          school_id: params.school_id,
          teacher_user_id: creatorUserId,
          is_active: true,
        })
        .select('id, class_name, course_code, school_id, teacher_user_id, student_join_code, current_seed, is_active, created_at')
        .single()

      if (insertError) throw insertError

      if (newClass.student_join_code) {
        // invite_codes INSERT was REVOKEd by 20260521180000; the
        // matching server endpoint inserts the row and authorizes
        // the caller (teacher / school_admin / ssi_admin).
        try {
          const { data: { session } } = await client.auth.getSession()
          const token = session?.access_token
          if (token) {
            const resp = await fetch('/api/teacher/create-class-join-code', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
              },
              body: JSON.stringify({ class_id: newClass.id }),
            })
            if (!resp.ok) {
              const data = await resp.json().catch(() => ({}))
              console.error('[ClassesData] Failed to create invite code for student join code:', data.error || resp.status)
              // Non-fatal — class still works, just won't resolve through /api/code/validate
            }
          } else {
            console.warn('[ClassesData] No auth token; skipping invite_code creation for class', newClass.id)
          }
        } catch (codeErr) {
          console.error('[ClassesData] invite_code fetch error:', codeErr)
        }
      }

      // Mint the class's own learner entity (owner ruling 2026-07-16: a class
      // is a first-class learner citizen, enrolled in its own course). Must be
      // server-mediated — learners has RLS enabled and a class entity's
      // synthetic user_id can never satisfy learners_insert_self. Non-fatal:
      // play-as-class re-attempts this lazily if it's still missing.
      let classLearnerId: string | null = null
      try {
        const { data: { session } } = await client.auth.getSession()
        const token = session?.access_token
        if (token) {
          const resp = await fetch('/api/teacher/create-class-learner', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ class_id: newClass.id }),
          })
          if (!resp.ok) {
            const data = await resp.json().catch(() => ({}))
            console.error('[ClassesData] Failed to create class learner entity:', data.error || resp.status)
          } else {
            const data = await resp.json()
            classLearnerId = data.class_learner_id || null
          }
        }
      } catch (learnerErr) {
        console.error('[ClassesData] create-class-learner fetch error:', learnerErr)
      }

      // Seed the creator's teacher↔class relationship (lead) via the service-role
      // route — the live RLS forbids a client teacher-tag insert. Makes the
      // relationship the source of truth so the new class appears under
      // membership reads, not only via the lead pointer.
      const teacherLinked = await addClassTeacher(newClass.id, creatorUserId, { lead: true })
      if (!teacherLinked) {
        // The teacher↔class relationship row never got written. The class row
        // exists (so we still return it and show it), but membership reads
        // won't surface it and the lead pointer is unbacked. Do NOT silently
        // assert is_lead: true here — that was the "false Saved" lie. Surface
        // it on the error ref and leave the optimistic teachers list empty.
        error.value = `Class "${newClass.class_name}" was created but linking you as its teacher failed — it may not appear in your class list until you re-add yourself.`
      }

      const classInfo: ClassInfo = {
        id: newClass.id,
        class_name: newClass.class_name,
        course_code: newClass.course_code,
        school_id: newClass.school_id,
        teacher_user_id: newClass.teacher_user_id,
        student_join_code: newClass.student_join_code,
        current_seed: newClass.current_seed,
        last_lego_id: null,
        class_learner_id: classLearnerId,
        is_active: newClass.is_active,
        student_count: 0,
        avg_seeds_completed: 0,
        avg_practice_minutes: 0,
        created_at: newClass.created_at,
        teachers: teacherLinked ? [{ user_id: newClass.teacher_user_id, is_lead: true }] : [],
      }

      classes.value = [...classes.value, classInfo]
      return classInfo
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to create class'
      console.error('[ClassesData] createClass error:', err)
      return null
    }
  }

  /**
   * Write the class's resume point (`classes.last_lego_id`). Returns `true` on
   * a confirmed write, `false` when it errored or threw. A silent `void` here
   * meant a failed write left the class resuming from a stale lego with no
   * signal — the "false Saved" class (RLS doctrine rule 8). Callers MUST
   * consume the result.
   */
  async function updateClassProgress(classId: string, lastLegoId: string): Promise<boolean> {
    try {
      const { error: err } = await client
        .from('classes')
        .update({ last_lego_id: lastLegoId })
        .eq('id', classId)

      if (err) {
        console.error('[ClassesData] Failed to update class progress:', err)
        return false
      }
      return true
    } catch (err) {
      console.error('[ClassesData] updateClassProgress error:', err)
      return false
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
    addClassTeacher,
    removeClassTeacher,
    startClassSession,
    endClassSession,
    getClassSessions,
    updateClassProgress,
  }
}
