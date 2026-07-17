/**
 * useSchoolData - School information and summary stats
 *
 * Provides school data for dashboard views based on God Mode user context.
 */

import { ref, computed } from 'vue'
import { getSchoolsClient } from './client'
import { useSchoolContext } from './useSchoolContext'
import { isDemoMode } from '../demo/demoMode'

interface GroupSummary {
  group_id?: string
  group_name: string
  group_path?: string
  region_code?: string
  // Drives the "name your group" first-run card (region-tier-design.md
  // §1d). Undefined on the legacy region_summary fallback (pre-group-tree
  // govt admins) — treat as already-confirmed there, nothing to prompt.
  name_confirmed?: boolean
  school_count: number
  teacher_count: number
  student_count: number
  total_practice_hours: number
  // Staff's OWN practice, already INCLUDED in total_practice_hours (founder
  // ruling 2026-07-18). Broken out so the headline can show the honest
  // "incl. Xm staff practice" composition instead of silently inflating.
  staff_practice_hours?: number
}

type SchoolHealth = 'excellent' | 'good' | 'needs-attention' | 'inactive'

export interface School {
  id: string
  school_name: string
  region_code: string | null
  group_id?: string | null
  admin_user_id: string | null
  teacher_join_code: string
  admin_join_code: string
  teacher_count: number
  class_count: number
  student_count: number
  total_practice_hours: number
  // Staff's OWN practice, already INCLUDED in total_practice_hours (founder
  // ruling 2026-07-18). Broken out for the "incl. Xm staff practice" line.
  staff_practice_hours?: number
  created_at: string
  // Drives the "confirm your school's name" first-run card (invite-born
  // admins only — see schools.name_confirmed migration). Optional so
  // existing constructors don't break; undefined reads as already-confirmed.
  name_confirmed?: boolean
  // Dashboard extras — optional so existing constructors don't break.
  active_days_last_7?: number
  health?: SchoolHealth
  // Claim state (school_summary.has_admin, 20260714 migration): true once
  // EITHER admin_user_id is set (legacy school_admin invite path) OR an
  // admin user_tags row exists (the school_admin_join redemption path new
  // leader-created schools use — it never sets admin_user_id). Optional so
  // existing constructors default to "claimed" (no false "awaiting" badge
  // on data that predates this column).
  has_admin?: boolean
}

// Bucket a school's recent engagement into one of four bands. A school
// counts as inactive when it has no enrolled students or zero active
// days across all its classes in the trailing 7 days. The class-level
// metric is "best class in the school" — one engaged class lifts the
// school's health, since school admins are most interested in the
// floor of engagement, not the average.
function bucketSchoolHealth(studentCount: number, activeDays: number): SchoolHealth {
  if (studentCount === 0) return 'inactive'
  if (activeDays >= 5) return 'excellent'
  if (activeDays >= 2) return 'good'
  if (activeDays >= 1) return 'needs-attention'
  return 'inactive'
}

const schools = ref<School[]>([])
const currentSchool = ref<School | null>(null)
const groupSummary = ref<GroupSummary | null>(null)
const viewingSchool = ref<School | null>(null) // For govt admin drill-down
const isLoading = ref(false)
const error = ref<string | null>(null)

// Generation guard: multiple callers (DashboardView's immediate watcher +
// its own onMounted, SchoolsView's onMounted/visibility-refetch, etc.) can
// each kick off an overlapping fetchSchools() call. Without this, an OLDER
// request that happens to resolve AFTER a NEWER one (out-of-order network
// timing) would silently clobber fresh state with stale state — the exact
// "stale on tab return" symptom class. Only the LATEST call's result is
// ever allowed to write to the shared refs.
let fetchGeneration = 0

export function useSchoolData() {
  const client = getSchoolsClient()
  const { currentUser: selectedUser, isGovtAdmin, isSchoolAdmin, isTeacher } = useSchoolContext()

  // Best-class active_days_last_7 per school. One round-trip via
  // class_activity_stats — we take the max across the school's classes
  // (see bucketSchoolHealth for why "max" instead of "avg").
  async function fetchSchoolActiveDays(schoolIds: string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>()
    if (schoolIds.length === 0) return out
    try {
      const { data } = await client
        .from('class_activity_stats')
        .select('school_id, active_days_last_7')
        .in('school_id', schoolIds)
      data?.forEach(row => {
        const prev = out.get(row.school_id) ?? 0
        const v = row.active_days_last_7 ?? 0
        if (v > prev) out.set(row.school_id, v)
      })
    } catch {
      // Health is informational — fall back to 0 (will resolve to
      // inactive/needs-attention based on student_count).
    }
    return out
  }

  // Fetch school(s) based on user role
  async function fetchSchools(): Promise<void> {
    if (isDemoMode.value) return  // Data pre-populated by populateDemoData
    if (!selectedUser.value) return

    const myGeneration = ++fetchGeneration
    isLoading.value = true
    error.value = null

    try {
      const userGroupId = selectedUser.value.group_id
      const userRegionCode = selectedUser.value.region_code

      if (isGovtAdmin.value && userGroupId) {
        // Group leader: server-mediated (/api/school/group-summary), NOT a
        // direct view read. group_summary/school_summary/class_activity_stats
        // LATERAL-join user_tags to count teachers/students — user_tags' RLS
        // grants a row's own user, an ssi_admin, a school's own admin, or a
        // class's own teacher, with NO govt_admin branch (RLS answers "is
        // this my row?" only; hierarchy authz is a server endpoint's job,
        // never a "clever" policy). A direct client read as the group
        // leader's own session therefore silently zeroed every teacher/
        // student/practice-hour count while school_count/class_count (which
        // never touch user_tags) stayed correct — exactly the reported bug.
        const { data: { session } } = await client.auth.getSession()
        const token = session?.access_token
        if (!token) return

        // An ssi_admin's admin-view (loadFromGroupId fakes
        // educational_role='govt_admin' to reuse this branch) isn't a real
        // govt_admin — resolveVisibleScope resolves THEIR OWN role, which the
        // endpoint 403s unless told explicitly which group is being READ.
        // A real govt_admin never sends this — the server always derives
        // their own group, never trusting a client-supplied id for that path.
        const isAdminView = selectedUser.value._scopeSource === 'admin-view'
        const url = isAdminView
          ? `/api/school/group-summary?groupId=${encodeURIComponent(userGroupId)}`
          : '/api/school/group-summary'

        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!res.ok) throw new Error(`group-summary ${res.status}`)
        const { group: groupData, schools: schoolData } = (await res.json()) as { group: any; schools: any[] }

        // A newer fetchSchools() call has started since this one began —
        // discard this result rather than overwrite fresher state.
        if (myGeneration !== fetchGeneration) return

        schools.value = (schoolData || []).map(s => {
          const id = s.id || s.school_id
          const activeDays = s.active_days_last_7 ?? 0
          return {
            id,
            school_name: s.school_name,
            region_code: s.region_code,
            group_id: s.group_id,
            admin_user_id: s.admin_user_id,
            teacher_join_code: s.teacher_join_code || '',
            admin_join_code: s.admin_join_code || '',
            teacher_count: s.teacher_count,
            class_count: s.class_count,
            student_count: s.student_count,
            total_practice_hours: s.total_practice_hours,
            staff_practice_hours: s.staff_practice_hours ?? 0,
            created_at: s.created_at,
            active_days_last_7: activeDays,
            health: bucketSchoolHealth(s.student_count || 0, activeDays),
            has_admin: s.has_admin ?? !!s.admin_user_id,
          }
        })

        if (groupData) {
          groupSummary.value = {
            group_id: groupData.group_id,
            group_name: groupData.group_name,
            group_path: groupData.group_path,
            name_confirmed: groupData.name_confirmed,
            school_count: groupData.school_count,
            teacher_count: groupData.teacher_count,
            student_count: groupData.student_count,
            total_practice_hours: groupData.total_practice_hours,
            staff_practice_hours: groupData.staff_practice_hours ?? 0,
          }
        }
      } else if (isGovtAdmin.value && userRegionCode) {
        // Legacy fallback: govt admins created before the group tree existed
        // (region_code only, no group_id). No live govt_admin is on this
        // path today — left as a direct read rather than extending the new
        // endpoint for a path with zero current users.
        const { data, error: fetchError } = await client
          .from('school_summary')
          .select('*')
          .eq('region_code', userRegionCode)
          .order('school_name')
        if (fetchError) throw fetchError
        const schoolData = data || []

        const ids = schoolData.map(s => s.id || s.school_id).filter(Boolean)
        const activeDaysMap = await fetchSchoolActiveDays(ids)

        if (myGeneration !== fetchGeneration) return

        schools.value = schoolData.map(s => {
          const id = s.id || s.school_id
          const activeDays = activeDaysMap.get(id) ?? 0
          return {
            id,
            school_name: s.school_name,
            region_code: s.region_code,
            group_id: s.group_id,
            admin_user_id: s.admin_user_id,
            teacher_join_code: s.teacher_join_code || '',
            admin_join_code: s.admin_join_code || '',
            teacher_count: s.teacher_count,
            class_count: s.class_count,
            student_count: s.student_count,
            total_practice_hours: s.total_practice_hours,
            staff_practice_hours: s.staff_practice_hours ?? 0,
            created_at: s.created_at,
            active_days_last_7: activeDays,
            health: bucketSchoolHealth(s.student_count || 0, activeDays),
            has_admin: s.has_admin ?? !!s.admin_user_id,
          }
        })

        const { data: regionData, error: regionError } = await client
          .from('region_summary')
          .select('*')
          .eq('region_code', userRegionCode)
          .single()
        if (!regionError && regionData) {
          groupSummary.value = { ...regionData, group_name: regionData.region_name }
        }
      } else if ((isSchoolAdmin.value || isTeacher.value) && selectedUser.value.school_id) {
        // A REAL school admin/teacher viewing their OWN school: server-mediated
        // (/api/school/roster), NOT a direct `school_summary` read. That view
        // LATERAL-joins user_tags to count teachers/students, and user_tags'
        // RLS has no branch for a school_admin invite-born via the newer
        // school_admin_join redemption path (schools.admin_user_id stays
        // null there) — their own session then only ever sees their OWN
        // user_tags row, zeroing every other teacher/student count. Same
        // fix shape as group-summary.ts for the govt_admin "zeros" bug.
        //
        // An ssi_admin's admin-view (loadFromSchoolId fakes
        // educational_role='school_admin' to reuse this branch, scoped via
        // _scopeSource instead) already sees correct numbers — their own
        // session carries the RLS ssi_admin branch — so it keeps using the
        // direct view read instead of this caller-scoped endpoint, which
        // would 403 the real admin's non-staff learner row.
        const isSelfView = selectedUser.value._scopeSource === 'self'
        let data: any = null
        if (isSelfView) {
          const { data: { session } } = await client.auth.getSession()
          const token = session?.access_token
          if (!token) return

          const res = await fetch('/api/school/roster', {
            headers: { Authorization: `Bearer ${token}` },
          })
          if (!res.ok) throw new Error(`roster ${res.status}`)
          data = ((await res.json()) as { school: any }).school
        } else {
          const { data: viewData, error: fetchError } = await client
            .from('school_summary')
            .select('*')
            .eq('school_id', selectedUser.value.school_id)
            .single()
          if (fetchError) throw fetchError
          data = viewData
        }

        if (data) {
          const schoolId = data.school_id || data.id
          // Also fetch the join code from schools table
          const { data: schoolData } = await client
            .from('schools')
            .select('teacher_join_code, admin_join_code')
            .eq('id', selectedUser.value.school_id)
            .single()

          const activeDaysMap = await fetchSchoolActiveDays([schoolId])
          const activeDays = activeDaysMap.get(schoolId) ?? 0

          if (myGeneration !== fetchGeneration) return

          currentSchool.value = {
            id: schoolId,
            school_name: data.school_name,
            region_code: data.region_code,
            group_id: data.group_id,
            admin_user_id: data.admin_user_id,
            teacher_join_code: schoolData?.teacher_join_code || '',
            admin_join_code: schoolData?.admin_join_code || '',
            teacher_count: data.teacher_count,
            class_count: data.class_count,
            student_count: data.student_count,
            total_practice_hours: data.total_practice_hours,
            staff_practice_hours: data.staff_practice_hours ?? 0,
            created_at: data.created_at,
            name_confirmed: data.name_confirmed,
            active_days_last_7: activeDays,
            health: bucketSchoolHealth(data.student_count || 0, activeDays),
          }
          schools.value = [currentSchool.value]
        }
      }
    } catch (err) {
      if (myGeneration !== fetchGeneration) return
      error.value = err instanceof Error ? err.message : 'Failed to fetch school data'
      console.error('School data fetch error:', err)
    } finally {
      if (myGeneration === fetchGeneration) isLoading.value = false
    }
  }

  // Confirm/rename a school's name — the invite-born admin's first-run card.
  // The `schools` table's authenticated UPDATE grant is revoked (see
  // CLAUDE.md RLS section), so this is routed through the same caller-scoped
  // server endpoint SetupView.vue's saveSchool() uses (finding #2a, 2026-07-13
  // audit) rather than a direct client write. The endpoint always resolves
  // the school from the caller's OWN session — the schoolId param is only
  // used to gate the local currentSchool cache update, never sent to the server.
  async function confirmSchoolName(schoolId: string, name: string): Promise<boolean> {
    error.value = null
    try {
      const { data: { session } } = await client.auth.getSession()
      const token = session?.access_token
      if (!token) throw new Error('Not signed in')
      const res = await fetch('/api/school/update-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ school_name: name, name_confirmed: true }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `Request failed: ${res.status}`)
      }
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to confirm school name'
      return false
    }
    if (currentSchool.value?.id === schoolId) {
      currentSchool.value = { ...currentSchool.value, school_name: name, name_confirmed: true }
    }
    return true
  }

  // Drill-down: select a school to view (for govt admin)
  function selectSchoolToView(school: School) {
    viewingSchool.value = school
  }

  function clearViewingSchool() {
    viewingSchool.value = null
  }

  // Is the govt admin currently viewing a specific school?
  const isViewingSchool = computed(() => isGovtAdmin.value && !!viewingSchool.value)

  // The "active" school - either the viewing school (drill-down) or current school
  const activeSchool = computed(() => viewingSchool.value || currentSchool.value)

  // Computed stats - respect drill-down context
  const totalStudents = computed(() => {
    if (viewingSchool.value) return viewingSchool.value.student_count
    if (groupSummary.value) return groupSummary.value.student_count
    return schools.value.reduce((sum, s) => sum + s.student_count, 0)
  })

  const totalTeachers = computed(() => {
    if (viewingSchool.value) return viewingSchool.value.teacher_count
    if (groupSummary.value) return groupSummary.value.teacher_count
    return schools.value.reduce((sum, s) => sum + s.teacher_count, 0)
  })

  const totalClasses = computed(() => {
    if (viewingSchool.value) return viewingSchool.value.class_count
    return schools.value.reduce((sum, s) => sum + s.class_count, 0)
  })

  const totalPracticeHours = computed(() => {
    if (viewingSchool.value) return viewingSchool.value.total_practice_hours
    if (groupSummary.value) return groupSummary.value.total_practice_hours
    return schools.value.reduce((sum, s) => sum + s.total_practice_hours, 0)
  })

  // Staff's OWN practice component of totalPracticeHours (founder ruling
  // 2026-07-18). Drives the honest "incl. Xm staff practice" headline line;
  // already summed into totalPracticeHours above, never added on top.
  const totalStaffPracticeHours = computed(() => {
    if (viewingSchool.value) return viewingSchool.value.staff_practice_hours ?? 0
    if (groupSummary.value) return groupSummary.value.staff_practice_hours ?? 0
    return schools.value.reduce((sum, s) => sum + (s.staff_practice_hours ?? 0), 0)
  })

  return {
    // State
    schools,
    currentSchool,
    groupSummary,
    viewingSchool,
    isLoading,
    error,

    // Computed
    activeSchool,
    isViewingSchool,
    totalStudents,
    totalTeachers,
    totalClasses,
    totalPracticeHours,
    totalStaffPracticeHours,

    // Actions
    fetchSchools,
    confirmSchoolName,
    selectSchoolToView,
    clearViewingSchool,
  }
}
