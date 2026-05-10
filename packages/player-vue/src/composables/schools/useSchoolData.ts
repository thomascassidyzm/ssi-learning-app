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
  school_count: number
  teacher_count: number
  student_count: number
  total_practice_hours: number
}

export interface School {
  id: string
  school_name: string
  region_code: string | null
  group_id?: string | null
  admin_user_id: string
  teacher_join_code: string
  admin_join_code: string
  teacher_count: number
  class_count: number
  student_count: number
  total_practice_hours: number
  created_at: string
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

        schools.value = schoolData.map(s => ({
          id: s.id || s.school_id,
          school_name: s.school_name,
          region_code: s.region_code,
          group_id: s.group_id,
          admin_user_id: s.admin_user_id,
          teacher_join_code: '',
          admin_join_code: '',
          teacher_count: s.teacher_count,
          class_count: s.class_count,
          student_count: s.student_count,
          total_practice_hours: s.total_practice_hours,
          created_at: s.created_at,
        }))

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
          // Also fetch the join code from schools table
          const { data: schoolData } = await client
            .from('schools')
            .select('teacher_join_code, admin_join_code')
            .eq('id', selectedUser.value.school_id)
            .single()

          currentSchool.value = {
            id: data.school_id || data.id,
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
    selectSchoolToView,
    clearViewingSchool,
  }
}
