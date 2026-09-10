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
import { assertScope, assertScopeUnion } from './rlsGuard'
import { deriveBelt as bucketBelt, type Belt } from './belts'
import { myTaughtClassIds, teachersByClassId, teachersByClassIdResult, type ClassTeacherRef } from './classTeacherScope'

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

export interface ClassDeleteImpact {
  classId: string
  className: string
  classCount: number
  sessionCount: number
  learnerCount: number
  teacherCount: number
  hasRealActivity: boolean
}

export interface ClassDeleteResult {
  ok: boolean
  error?: string
  requiresConfirmName?: boolean
  impact?: ClassDeleteImpact
}

/** The honest result of a teacher↔class write: never a bare "it failed". */
export interface ClassTeacherWriteResult {
  ok: boolean
  error: string | null
}

/** Adding a pupil to a class — `still_in` are the classes they remain in. */
export interface AddStudentResult extends ClassTeacherWriteResult {
  still_in: Array<{ id: string; name: string }>
}

/**
 * A pupil who is in this class's school but not in this class — the pool the
 * "Add students" control on the class page draws from.
 *
 * `current_classes` is every class they are in NOW, and it is a LIST because a
 * pupil can be in more than one: a class carries a course, and doing Welsh in
 * one set and Spanish in another is two memberships, which is why the join
 * link adds a class tag without touching the others. So adding a pupil here is
 * an add, not a move, and the list is what lets the page say so. Empty means
 * they are in no class at all — usually because they were taken out of the only
 * one they were in, which is precisely when a teacher comes looking for them.
 */
export interface StudentCandidate {
  user_id: string
  learner_id: string
  display_name: string
  current_classes: Array<{ id: string; name: string }>
}

/** A minted class-scoped co-teacher link — `code` is null whenever `ok` is false. */
export interface CoTeacherLinkResult {
  ok: boolean
  code: string | null
  error: string | null
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

// Per-panel load state for the class-detail page. `error` above means "the
// class row itself could not be read" — the only genuinely page-wide failure.
// Everything else on that page has its OWN data source and its own outcome,
// so one slow view can no longer blank out unrelated panels (production,
// 2026-08-07: class_student_progress timed out for a non-lead co-teacher and
// took the teacher list and the student invite code down with it).
const rosterError = ref<string | null>(null)
const teachersError = ref<string | null>(null)
// False until a classes read has actually RESOLVED cleanly. Same rule as
// teachersLoaded below: an empty state is an assertion about the world, so
// "No classes yet" may only be rendered once we have OBSERVED emptiness.
const classesLoaded = ref(false)
// False until a class_teachers read for the current class has actually
// RESOLVED. "No teachers yet" may only be rendered when this is true and
// teachersError is null — never assert an emptiness you did not observe.
const teachersLoaded = ref(false)

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
    classesLoaded.value = false

    try {
      let query = client.from('classes').select(`
        id, class_name, course_code, school_id, teacher_user_id,
        student_join_code, current_seed, last_lego_id, class_learner_id, is_active, created_at
      `)

      // Track scope for the RLS tripwire (rlsGuard.ts). Teachers are scoped by
      // class MEMBERSHIP (the class_teachers relationship, lead + co-taught —
      // a teacher can legitimately teach at multiple schools); school/govt
      // admins are scoped by school_id.
      //
      // The two are a UNION, never a choice. Someone can be a leader AND teach:
      // the founding-admin work (2026-08-06) makes a school's founder staff of
      // their own school, and a leader who covers a class holds a class tag
      // like anyone else. Branching to whichever role was tested first showed
      // them one half of their world and hid the other — and when the tested
      // half was empty it short-circuited, which is how a school admin with no
      // classes of her own was told her SCHOOL had none.
      const allowedSchoolIds: string[] = []
      let allowedClassIds: string[] | null = null

      // The classes I personally teach — for anyone who might teach, which
      // includes school admins, not only the 'teacher' role.
      if (isTeacher.value || isSchoolAdmin.value) {
        const myClassIds = await myTaughtClassIds(selectedUser.value.user_id)
        if (myClassIds.length > 0) allowedClassIds = myClassIds
      }

      if (isGovtAdmin.value && isViewingSchool.value && activeSchoolId.value) {
        // Govt admin drilled into a school sees all classes in that school
        allowedSchoolIds.push(activeSchoolId.value)
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
        allowedSchoolIds.push(...schoolIds)
      } else if (isSchoolAdmin.value && selectedUser.value.school_id) {
        // School admin sees all classes in school
        allowedSchoolIds.push(selectedUser.value.school_id)
      }

      // A staff member with neither a school scope nor a class of their own
      // has, genuinely, nothing to show. Resolve to empty rather than firing
      // an UNSCOPED select — which under RLS would return whatever the
      // policies happen to allow.
      const scoped = allowedSchoolIds.length > 0 || (allowedClassIds?.length ?? 0) > 0
      if (!scoped && (isTeacher.value || isSchoolAdmin.value || isGovtAdmin.value)) {
        classes.value = []
        classesLoaded.value = true
        isLoading.value = false
        return
      }

      // The union, expressed as one query: every class in a school I lead,
      // PLUS every class I personally teach (which may sit in another school).
      if (allowedSchoolIds.length > 0 && allowedClassIds) {
        query = query.or(`school_id.in.(${allowedSchoolIds.join(',')}),id.in.(${allowedClassIds.join(',')})`)
      } else if (allowedSchoolIds.length > 0) {
        query = query.in('school_id', allowedSchoolIds)
      } else if (allowedClassIds) {
        query = query.in('id', allowedClassIds)
      }

      query = query.eq('is_active', true).order('class_name')

      const { data, error: fetchError } = await query

      // Report the DB's OWN reason. PostgREST errors are plain objects, not
      // Error instances, so the generic catch below flattens them to the
      // useless "Failed to fetch classes" — the same trap fetchClassDetail
      // already dodges. This matters: when the leader's Classes tab came back
      // empty on 2026-08-07 it took a live DB session to learn why, because
      // the client had nothing to say. A silent RLS filter still yields no
      // error at all (that is the policy layer, fixed in 20260807c/d), but a
      // GRANT-layer denial says "permission denied" and must reach the screen.
      if (fetchError) {
        error.value = fetchError.message || 'Failed to fetch classes'
        console.error('Classes fetch error:', fetchError)
        return
      }

      // Client-side RLS tripwire: returned rows must match the caller's
      // declared scope. The scope is the same UNION the query asked for —
      // a row is in scope if it is in a school I lead OR is a class I teach —
      // so the guard stays live for a leader-who-also-teaches instead of
      // being switched off. In production we filter + log [RLS_VIOLATION];
      // in dev/test we throw.
      const safeData = assertScopeUnion(data || [], [
        ...(allowedSchoolIds.length > 0 ? [{ key: 'school_id' as const, allowed: allowedSchoolIds }] : []),
        ...(allowedClassIds ? [{ key: 'id' as const, allowed: allowedClassIds }] : []),
      ], {
        table: 'classes',
        caller: 'useClassesData.fetchClasses',
      })

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
      // Reached only on a clean read: emptiness here was OBSERVED, so the
      // first-run empty state is now allowed to speak.
      classesLoaded.value = true
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
      teachersLoaded.value = true
      teachersError.value = null
      rosterError.value = null
      return
    }

    isLoading.value = true
    error.value = null
    rosterError.value = null
    teachersError.value = null
    teachersLoaded.value = false

    try {
      // Fetch class info. This one IS all-or-nothing: without the class row
      // there is no name, no course and no join code to render.
      const { data: classData, error: classError } = await client
        .from('classes')
        .select('*')
        .eq('id', classId)
        .single()

      if (classError) {
        // Report the DB's own reason — PostgREST errors are plain objects, so
        // the generic catch below would flatten them to "Failed to fetch class
        // detail" and tell the teacher nothing.
        error.value = classError.message || 'Failed to fetch class detail'
        console.error('Class detail fetch error:', classError)
        return
      }

      // The remaining four reads depend on nothing but `classId` and the
      // course code we now have, so they go out TOGETHER. They used to be four
      // sequential awaits: measured on staging 2026-09-01 the roster read
      // alone spends ~8s hitting the statement timeout, and the sparkline,
      // the LEGO total and the teacher list each waited behind it for no
      // reason. Same reads, same results, same panel-by-panel error handling —
      // one wave instead of four round trips.
      const sevenDaysAgo = new Date()
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6)
      sevenDaysAgo.setHours(0, 0, 0, 0)

      const [
        { data: progressData, error: progressError },
        sessionsRes,
        courseTotals,
        teacherRead,
      ] = await Promise.all([
        client
          .from('class_student_progress')
          .select('*')
          .eq('class_id', classId)
          .order('student_name'),
        // Sparkline is decoration — a failure here dims one chart, nothing else.
        client
          .from('class_sessions')
          .select('started_at, cycles_completed')
          .eq('class_id', classId)
          .gte('started_at', sevenDaysAgo.toISOString())
          .then(
            (res) => res,
            (err) => { console.error('Class sparkline fetch error:', err); return { data: null } },
          ),
        fetchCourseLegoTotals([classData.course_code].filter(Boolean)),
        teachersByClassIdResult([classId]),
      ])

      // Fetch student progress for this class. Its own panel, its own outcome:
      // this view can time out (57014) under a non-lead co-teacher's RLS plan,
      // and when it does the roster says so while the rest of the page lives.
      if (progressError) {
        rosterError.value = progressError.message || 'Failed to fetch the roster'
        console.error('Class roster fetch error:', progressError)
      }

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
      const sessionRows = sessionsRes.data as Array<{ started_at: string | null; cycles_completed: number | null }> | null

      const days = last7Days()
      const dayIndex = new Map(days.map((d, i) => [d, i]))
      const spark = Array(7).fill(0)
      sessionRows?.forEach(s => {
        const key = (s.started_at || '').split('T')[0]
        const idx = dayIndex.get(key)
        if (idx !== undefined) spark[idx] += s.cycles_completed || 0
      })

      // Journey total: count LEGOs for this course
      const journeyTotal = courseTotals.get(classData.course_code) ?? 0

      // Active teacher↔class relationships for this class (lead + co-taught).
      // Its own panel, its own outcome — and a FAILED read is reported, never
      // rendered as "no teachers are linked to this class yet".
      const detailTeachers = teacherRead.map.get(classId) ?? []
      teachersError.value = teacherRead.error
      teachersLoaded.value = teacherRead.error === null

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
      // The class's FULL teacher set (lead + co-taught). fetchClassDetail has
      // always populated it; this computed used to drop it on the way through,
      // which is why no view could render "who teaches this class".
      teachers: currentClass.value.teachers ?? [],
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
  //
  // Returns the REAL result, message included — a bare boolean left the panel
  // with nothing honest to say when a write was refused, and "it didn't work"
  // with no reason is one step away from the false-"Saved" class this codebase
  // bans (RLS doctrine rule 8).
  async function callClassTeachersApi(body: {
    class_id: string
    action: 'add' | 'remove'
    target_user_id: string
    set_lead?: boolean
  }): Promise<ClassTeacherWriteResult> {
    try {
      const { data: { session } } = await client.auth.getSession()
      const token = session?.access_token
      if (!token) {
        console.warn('[ClassesData] No auth token; skipping class-teacher write')
        return { ok: false, error: 'You are not signed in.' }
      }
      const resp = await fetch('/api/teacher/class-teachers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      })
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}))
        const message = data.error || `Request failed: ${resp.status}`
        console.error('[ClassesData] class-teacher write failed:', message)
        return { ok: false, error: message }
      }
      return { ok: true, error: null }
    } catch (err) {
      console.error('[ClassesData] class-teacher fetch error:', err)
      return { ok: false, error: err instanceof Error ? err.message : 'Failed to reach the server' }
    }
  }

  // Server-mediated rename — replaces a former direct client
  // `classes.update({ class_name })`, which had NO ownership check at all
  // (classes is one of the six org tables that is RLS-off by design;
  // "authenticated UPDATE" meant ANY signed-in caller could rename ANY
  // tenant's class by id). api/school/rename-class.ts enforces ownership via
  // resolveVisibleScope server-side.
  async function renameClass(classId: string, className: string): Promise<boolean> {
    try {
      const { data: { session } } = await client.auth.getSession()
      const token = session?.access_token
      if (!token) {
        console.warn('[ClassesData] No auth token; skipping class rename')
        return false
      }
      const resp = await fetch('/api/school/rename-class', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ class_id: classId, class_name: className }),
      })
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}))
        console.error('[ClassesData] class rename failed:', data.error || resp.status)
        return false
      }
      return true
    } catch (err) {
      console.error('[ClassesData] class rename fetch error:', err)
      return false
    }
  }

  // Server-mediated delete — the reported gap (a teacher who set up a class
  // wrongly had no way to remove it). api/school/delete-class.ts enforces
  // ownership via the same resolveVisibleScope check rename-class.ts uses.
  async function fetchClassDeleteImpact(classId: string): Promise<ClassDeleteImpact | null> {
    try {
      const { data: { session } } = await client.auth.getSession()
      const token = session?.access_token
      if (!token) return null
      const resp = await fetch(`/api/school/delete-class?class_id=${encodeURIComponent(classId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!resp.ok) return null
      const data = await resp.json()
      return data.impact ?? null
    } catch (err) {
      console.error('[ClassesData] class delete impact fetch error:', err)
      return null
    }
  }

  async function deleteClass(classId: string, confirmName?: string): Promise<ClassDeleteResult> {
    try {
      const { data: { session } } = await client.auth.getSession()
      const token = session?.access_token
      if (!token) return { ok: false, error: 'Not signed in' }
      const resp = await fetch('/api/school/delete-class', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ class_id: classId, confirm_name: confirmName }),
      })
      const data = await resp.json().catch(() => ({}))
      if (!resp.ok) {
        return { ok: false, error: data.error || 'Failed to delete class', requiresConfirmName: !!data.requires_confirm_name, impact: data.impact }
      }
      return { ok: true }
    } catch (err) {
      console.error('[ClassesData] class delete fetch error:', err)
      return { ok: false, error: 'Failed to delete class' }
    }
  }

  /** Add (or reactivate) a teacher on a class; `lead` also points the lead pointer at them. */
  async function addClassTeacher(
    classId: string,
    targetUserId: string,
    opts?: { lead?: boolean }
  ): Promise<ClassTeacherWriteResult> {
    return callClassTeachersApi({ class_id: classId, action: 'add', target_user_id: targetUserId, set_lead: opts?.lead })
  }

  /** Soft-remove a teacher from a class; the server hands the lead on if needed. */
  async function removeClassTeacher(classId: string, targetUserId: string): Promise<ClassTeacherWriteResult> {
    return callClassTeachersApi({ class_id: classId, action: 'remove', target_user_id: targetUserId })
  }

  /**
   * The pupils this class could take: everyone in its school who is not on it
   * already. Server-mediated, because a teacher's RLS view of `user_tags`
   * covers only their own classes — they cannot see the pupil in the class
   * next door, which is precisely the one they are looking for.
   *
   * An unreadable list and an empty one are different answers and are reported
   * differently: `error` is set only when the lookup actually failed.
   */
  async function fetchAddableStudents(
    classId: string,
  ): Promise<{ candidates: StudentCandidate[]; error: string | null }> {
    try {
      const { data: { session } } = await client.auth.getSession()
      const token = session?.access_token
      if (!token) return { candidates: [], error: 'You are not signed in.' }
      const resp = await fetch(`/api/teacher/class-students?class_id=${encodeURIComponent(classId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await resp.json().catch(() => ({}))
      if (!resp.ok) {
        const message = data.error || `Request failed: ${resp.status}`
        console.error('[ClassesData] addable-student lookup failed:', message)
        return { candidates: [], error: message }
      }
      return { candidates: (data.candidates ?? []) as StudentCandidate[], error: null }
    } catch (err) {
      console.error('[ClassesData] addable-student fetch error:', err)
      return { candidates: [], error: err instanceof Error ? err.message : 'Failed to reach the server' }
    }
  }

  /**
   * Put a pupil on this class's roster. The client cannot write this row —
   * `user_tags_insert` lets a signed-in user tag only themselves — so it goes
   * through the service-role route, which re-checks that the caller teaches
   * the class and that the pupil is in its school.
   */
  async function addClassStudent(classId: string, targetUserId: string): Promise<AddStudentResult> {
    try {
      const { data: { session } } = await client.auth.getSession()
      const token = session?.access_token
      if (!token) return { ok: false, error: 'You are not signed in.', still_in: [] }
      const resp = await fetch('/api/teacher/class-students', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ class_id: classId, target_user_id: targetUserId }),
      })
      const data = await resp.json().catch(() => ({}))
      if (!resp.ok) {
        const message = data.error || `Request failed: ${resp.status}`
        console.error('[ClassesData] add-student write failed:', message)
        return { ok: false, error: message, still_in: [] }
      }
      // The classes this pupil is STILL in. The server is the only thing that
      // knows, and the page has to say it — an add leaves the old membership
      // standing, and a teacher who assumes otherwise has moved nobody.
      return { ok: true, error: null, still_in: (data.still_in ?? []) as Array<{ id: string; name: string }> }
    } catch (err) {
      console.error('[ClassesData] add-student fetch error:', err)
      return { ok: false, error: err instanceof Error ? err.message : 'Failed to reach the server', still_in: [] }
    }
  }

  /**
   * Mint a CLASS-SCOPED co-teacher link (A-74) — the supply-teacher lane.
   *
   * The invite/redeem half shipped 2026-08-06 (api/invite/create.ts teacher +
   * grants_class_id; api/code/redeem.ts writes the class tag alongside the
   * school one) with no button anywhere to reach it. The school is SERVER-
   * derived from the class — we never send one — and redemption never touches
   * the lead pointer, so the colleague arrives as a co-teacher of this one
   * class, not as its lead and not as a teacher of the whole school.
   */
  async function createCoTeacherLink(classId: string): Promise<CoTeacherLinkResult> {
    try {
      const { data: { session } } = await client.auth.getSession()
      const token = session?.access_token
      if (!token) return { ok: false, code: null, error: 'You are not signed in.' }
      const resp = await fetch('/api/invite/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ code_type: 'teacher', grants_class_id: classId }),
      })
      const data = await resp.json().catch(() => ({}))
      if (!resp.ok || !data.code) {
        const message = data.error || `Request failed: ${resp.status}`
        console.error('[ClassesData] co-teacher link mint failed:', message)
        return { ok: false, code: null, error: message }
      }
      return { ok: true, code: data.code as string, error: null }
    } catch (err) {
      console.error('[ClassesData] co-teacher link fetch error:', err)
      return { ok: false, code: null, error: err instanceof Error ? err.message : 'Failed to reach the server' }
    }
  }

  /**
   * Create a class — SERVER-MEDIATED, never a client insert.
   *
   * THE HOLE THIS CLOSED (2026-09-10). This used to
   * `client.from('classes').insert(...)` straight from the browser. The only
   * thing standing behind that was the RLS policy `classes_insert`,
   * `WITH CHECK (teacher_user_id = auth.uid()::text)` — which asks whose row
   * it is and NOTHING about the course. Meanwhile a class's `course_code` is
   * what api/_utils/classCoverage.ts hands every student tagged into it, in
   * full, for as long as the class's school has live platform cover. So a
   * teacher could open a class on any premium course the school had never
   * paid for, and the entitlement ladder that shipped in
   * api/_utils/classCourseEntitlement.ts was bypassed by simply not using the
   * endpoint. Both writes now go through a server endpoint, per CLAUDE.md's
   * RLS doctrine: the policy stays a row-ownership check, the commercial
   * authz lives in an endpoint with tests.
   *
   * TWO ENDPOINTS, chosen by whether there is a school:
   *   school_id  → POST /api/school/create-class (school lane) — staff
   *     membership + the entitlement ladder. This is the path that was
   *     leaking.
   *   school_id null → POST /api/teacher/classes — the personal tutor lane
   *     (THE-MODEL §1.3/I5), the endpoint /teach has always used. A class
   *     with school_id null grants NO class coverage at all
   *     (classCoverage.ts skips rows without a school), so there is no
   *     premium course to leak here; that lane is gated by the tutor's own
   *     platform subscription instead.
   *
   * Both endpoints already mint the invite_codes row, the class's own learner
   * entity and the creator's teacher↔class tag, so the three follow-up fetches
   * this function used to make are gone with the insert.
   */
  async function createClass(params: {
    class_name: string
    course_code: string
    // Null for a groupless tutor (THE-MODEL §1.3/I5) — a class affiliates to
    // ANY group node or none at all; the personal /teach lane has always
    // created classes with school_id null (api/teacher/classes.ts).
    school_id: string | null
  }): Promise<ClassInfo | null> {
    if (!selectedUser.value) return null
    const creatorUserId = selectedUser.value.user_id

    try {
      const { data: { session } } = await client.auth.getSession()
      const token = session?.access_token
      if (!token) {
        error.value = 'You are not signed in.'
        return null
      }

      const endpoint = params.school_id ? '/api/school/create-class' : '/api/teacher/classes'
      const body = params.school_id
        ? { school_id: params.school_id, class_name: params.class_name, course_code: params.course_code }
        : { class_name: params.class_name, course_code: params.course_code }

      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      })
      const data = await resp.json().catch(() => ({}))
      if (!resp.ok || !data?.class) {
        // The endpoint's own words, not a generic failure — a premium-course
        // refusal tells the teacher what to do about it, and swallowing that
        // into "Failed to create class" is the false-"Saved" class one step
        // removed (RLS doctrine rule 8).
        error.value = data?.error || `Failed to create class: ${resp.status}`
        console.error('[ClassesData] createClass failed:', error.value)
        return null
      }

      const newClass = data.class as Record<string, any>
      const classInfo: ClassInfo = {
        id: newClass.id,
        class_name: newClass.class_name,
        course_code: newClass.course_code,
        // The tutor lane's select omits both — it only ever writes school_id
        // null and the caller as lead.
        school_id: newClass.school_id ?? params.school_id ?? null,
        teacher_user_id: newClass.teacher_user_id ?? creatorUserId,
        student_join_code: newClass.student_join_code,
        current_seed: newClass.current_seed ?? 0,
        last_lego_id: null,
        class_learner_id: newClass.class_learner_id ?? null,
        is_active: newClass.is_active ?? true,
        student_count: 0,
        avg_seeds_completed: 0,
        avg_practice_minutes: 0,
        created_at: newClass.created_at,
        // Both endpoints write the teacher↔class tag for the creator and fail
        // the request if it could not be written, so a 2xx means the lead
        // relationship really is there.
        teachers: [{ user_id: newClass.teacher_user_id ?? creatorUserId, is_lead: true }],
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
    rosterError,
    teachersError,
    teachersLoaded,
    classesLoaded,

    // Computed
    totalStudentsInClasses,
    classDetail,

    // Actions
    fetchClasses,
    fetchClassDetail,
    getClassReport,
    createClass,
    renameClass,
    fetchClassDeleteImpact,
    deleteClass,
    addClassTeacher,
    removeClassTeacher,
    fetchAddableStudents,
    addClassStudent,
    createCoTeacherLink,
    startClassSession,
    endClassSession,
    getClassSessions,
    updateClassProgress,
  }
}
