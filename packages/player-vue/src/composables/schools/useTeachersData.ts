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
import { viewAsRequestHeaders } from '../useUserRole'

async function authHeaders(): Promise<Record<string, string>> {
  const client = getSchoolsClient()
  const { data: { session } } = await client.auth.getSession()
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...viewAsRequestHeaders() }
  if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`
  return headers
}

export interface Teacher {
  user_id: string
  learner_id: string
  display_name: string
  class_count: number
  student_count: number
  total_practice_hours: number
  /** The teacher's OWN practice (their learner's sessions) — distinct from
   *  total_practice_hours, which is their classes' STUDENTS' practice. In a
   *  trial school with no students yet this is the only non-zero number. */
  own_practice_minutes: number
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

  // Fetch teachers for school. A REAL school_admin/teacher viewing their OWN
  // school goes via the server-mediated /api/school/roster, NOT a direct
  // `user_tags`/`class_teachers`/`class_student_progress` read — those are
  // RLS-guarded and a school_admin invite-born via the newer
  // school_admin_join redemption path (schools.admin_user_id stays null
  // there) only ever sees their OWN user_tags row under their own session —
  // every other teacher silently vanished. See roster.ts's docstring.
  //
  // An ssi_admin's admin-view (loadFromSchoolId fakes
  // educational_role='school_admin', scoped via _scopeSource='admin-view')
  // already sees correct numbers via their own RLS ssi_admin branch, and
  // roster.ts would 403 the real admin's non-staff learner row anyway — so
  // it keeps the direct reads below.
  async function fetchTeachers(schoolId?: string): Promise<void> {
    if (isDemoMode.value) return
    const targetSchoolId = schoolId || activeSchoolId.value
    if (!targetSchoolId) return

    isLoading.value = true
    error.value = null

    try {
      if (selectedUser.value?._scopeSource === 'self') {
        const { data: { session } } = await client.auth.getSession()
        const token = session?.access_token
        if (!token) { teachers.value = []; return }

        const res = await fetch('/api/school/roster', {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!res.ok) throw new Error(`roster ${res.status}`)
        const { teachers: teacherRows } = (await res.json()) as { teachers: Teacher[] }
        teachers.value = teacherRows
        return
      }

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

      // Teachers' OWN practice — readable here because this branch only runs
      // for ssi_admin admin-view ("Admins can read all sessions" RLS policy).
      const teacherLearnerIds = (learners || []).map(l => l.id).filter(Boolean)
      const ownSeconds = new Map<string, number>()
      if (teacherLearnerIds.length) {
        const { data: ownSessions, error: ownError } = await client
          .from('sessions')
          .select('learner_id, duration_seconds')
          .in('learner_id', teacherLearnerIds)
        if (ownError) throw ownError
        ownSessions?.forEach(s => {
          ownSeconds.set(s.learner_id, (ownSeconds.get(s.learner_id) || 0) + (s.duration_seconds || 0))
        })
      }

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
          own_practice_minutes: Math.round((ownSeconds.get(l.id) || 0) / 60),
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

  // Remove a teacher from the school — server-mediated (api/school/remove-staff.ts).
  // The old direct client `user_tags.update()` silently no-opped under
  // own-row RLS when the caller wasn't the target (2026-07-16 teacher-loop
  // audit): no error, no effect, but the UI reported success anyway. This
  // surfaces the REAL result so a blocked removal never claims success.
  async function removeTeacher(targetUserId: string): Promise<{ ok: boolean; error: string | null }> {
    try {
      const headers = await authHeaders()
      const res = await fetch('/api/school/remove-staff', {
        method: 'POST',
        headers,
        body: JSON.stringify({ target_user_id: targetUserId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) return { ok: false, error: data?.error || `Request failed: ${res.status}` }
      return { ok: true, error: null }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Failed to remove teacher' }
    }
  }

  return {
    // State
    teachers,
    isLoading,
    error,

    // Actions
    fetchTeachers,
    removeTeacher,
  }
}
