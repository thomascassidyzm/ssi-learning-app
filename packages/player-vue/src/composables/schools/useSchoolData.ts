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

    isLoading.value = true
    error.value = null

    try {
      const userGroupId = selectedUser.value.group_id
      const userGroupPath = selectedUser.value.group_path
      const userRegionCode = selectedUser.value.region_code

      if (isGovtAdmin.value && (userGroupId || userRegionCode)) {
        // Govt admin: fetch all schools in group subtree
        // Prefer group_id + path-based subtree query, fall back to region_code
        let schoolData: any[] = []

        if (userGroupId && userGroupPath) {
          // Get all group IDs in subtree via path prefix
          const { data: subtreeGroups } = await client
            .from('groups')
            .select('id')
            .like('path', userGroupPath + '%')

          const subtreeIds = (subtreeGroups || []).map(g => g.id)
          if (subtreeIds.length > 0) {
            const { data, error: fetchError } = await client
              .from('school_summary')
              .select('*')
              .in('group_id', subtreeIds)
              .order('school_name')
            if (fetchError) throw fetchError
            schoolData = data || []
          }
        } else if (userRegionCode) {
          // Legacy fallback: filter by region_code
          const { data, error: fetchError } = await client
            .from('school_summary')
            .select('*')
            .eq('region_code', userRegionCode)
            .order('school_name')
          if (fetchError) throw fetchError
          schoolData = data || []
        }

        const ids = schoolData.map(s => s.id || s.school_id).filter(Boolean)
        const activeDaysMap = await fetchSchoolActiveDays(ids)

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
            created_at: s.created_at,
            active_days_last_7: activeDays,
            health: bucketSchoolHealth(s.student_count || 0, activeDays),
            has_admin: s.has_admin ?? !!s.admin_user_id,
          }
        })

        // Fetch group summary (prefer group_summary view, fall back to region_summary)
        if (userGroupId) {
          const { data: groupData, error: groupError } = await client
            .from('group_summary')
            .select('*')
            .eq('group_id', userGroupId)
            .single()

          if (!groupError && groupData) {
            groupSummary.value = {
              group_id: groupData.group_id,
              group_name: groupData.group_name,
              group_path: groupData.group_path,
              name_confirmed: groupData.name_confirmed,
              school_count: groupData.school_count,
              teacher_count: groupData.teacher_count,
              student_count: groupData.student_count,
              total_practice_hours: groupData.total_practice_hours,
            }
          }
        } else if (userRegionCode) {
          const { data: regionData, error: regionError } = await client
            .from('region_summary')
            .select('*')
            .eq('region_code', userRegionCode)
            .single()
          if (!regionError && regionData) {
            groupSummary.value = { ...regionData, group_name: regionData.region_name }
          }
        }
      } else if ((isSchoolAdmin.value || isTeacher.value) && selectedUser.value.school_id) {
        // School admin or teacher: fetch their school
        const { data, error: fetchError } = await client
          .from('school_summary')
          .select('*')
          .eq('school_id', selectedUser.value.school_id)
          .single()

        if (fetchError) throw fetchError

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
            created_at: data.created_at,
            name_confirmed: data.name_confirmed,
            active_days_last_7: activeDays,
            health: bucketSchoolHealth(data.student_count || 0, activeDays),
          }
          schools.value = [currentSchool.value]
        }
      }
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to fetch school data'
      console.error('School data fetch error:', err)
    } finally {
      isLoading.value = false
    }
  }

  // Confirm/rename a school's name — the invite-born admin's first-run card
  // (same client-side-update pattern SettingsView.vue already uses for
  // renaming; schools carries no RLS yet so this is a direct table write).
  // Errors surface so the card can show "Could not save" rather than a
  // false "Saved" (the ignored-RLS-denial class this codebase treats as a bug).
  async function confirmSchoolName(schoolId: string, name: string): Promise<boolean> {
    const { error: updateError } = await client
      .from('schools')
      .update({ school_name: name, name_confirmed: true })
      .eq('id', schoolId)
    if (updateError) {
      error.value = updateError.message
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

    // Actions
    fetchSchools,
    confirmSchoolName,
    selectSchoolToView,
    clearViewingSchool,
  }
}
