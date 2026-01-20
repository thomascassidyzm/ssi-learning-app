/**
 * useGodMode - Database user impersonation for testing
 *
 * Allows selecting any user from the database to view the dashboard as them.
 * Replaces useDevRole for real data testing.
 */

import { ref, computed, watch } from 'vue'
import { getClient } from './useSupabase'

export type EducationalRole = 'student' | 'teacher' | 'school_admin' | 'govt_admin'

export interface GodModeUser {
  user_id: string
  learner_id: string
  display_name: string
  educational_role: EducationalRole | null
  platform_role: 'ssi_admin' | null
  // Context (populated based on role)
  school_id?: string
  school_name?: string
  region_code?: string
  organization_name?: string
  class_ids?: string[]
}

const STORAGE_KEY = 'ssi-god-mode-user'

// Shared reactive state
const selectedUser = ref<GodModeUser | null>(loadStoredUser())
const allUsers = ref<GodModeUser[]>([])
const isLoading = ref(false)
const error = ref<string | null>(null)

function loadStoredUser(): GodModeUser | null {
  if (typeof window === 'undefined') return null
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored) {
    try {
      return JSON.parse(stored)
    } catch {
      return null
    }
  }
  return null
}

function saveUser(user: GodModeUser | null) {
  if (user) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(user))
  } else {
    localStorage.removeItem(STORAGE_KEY)
  }
}

// Persist selection
watch(selectedUser, (user) => {
  saveUser(user)
})

export function useGodMode() {
  const client = getClient()

  // Fetch all users with their context
  async function fetchUsers(): Promise<void> {
    isLoading.value = true
    error.value = null

    try {
      // Fetch all learners with educational roles
      const { data: learners, error: learnersError } = await client
        .from('learners')
        .select('id, user_id, display_name, educational_role, platform_role, created_at')
        .not('educational_role', 'is', null)
        .order('educational_role')
        .order('display_name')

      if (learnersError) throw learnersError

      // Fetch school admins (to get school context)
      const { data: schools, error: schoolsError } = await client
        .from('schools')
        .select('id, admin_user_id, school_name, region_code')

      if (schoolsError) throw schoolsError

      // Fetch govt admins
      const { data: govtAdmins, error: govtError } = await client
        .from('govt_admins')
        .select('user_id, region_code, organization_name')

      if (govtError) throw govtError

      // Fetch teacher school tags
      const { data: teacherTags, error: tagsError } = await client
        .from('user_tags')
        .select('user_id, tag_value')
        .eq('tag_type', 'school')
        .eq('role_in_context', 'teacher')
        .is('removed_at', null)

      if (tagsError) throw tagsError

      // Fetch student class tags
      const { data: studentTags, error: studentTagsError } = await client
        .from('user_tags')
        .select('user_id, tag_value')
        .eq('tag_type', 'class')
        .eq('role_in_context', 'student')
        .is('removed_at', null)

      if (studentTagsError) throw studentTagsError

      // Fetch classes for school lookup
      const { data: classes, error: classesError } = await client
        .from('classes')
        .select('id, school_id')

      if (classesError) throw classesError

      // Build lookup maps
      const schoolMap = new Map(schools?.map(s => [s.admin_user_id, s]) || [])
      const schoolById = new Map(schools?.map(s => [s.id, s]) || [])
      const govtMap = new Map(govtAdmins?.map(g => [g.user_id, g]) || [])
      const teacherSchoolMap = new Map<string, string>()
      const studentClassMap = new Map<string, string[]>()
      const classSchoolMap = new Map(classes?.map(c => [c.id, c.school_id]) || [])

      // Build teacher -> school mapping
      teacherTags?.forEach(tag => {
        const schoolId = tag.tag_value.replace('SCHOOL:', '')
        teacherSchoolMap.set(tag.user_id, schoolId)
      })

      // Build student -> classes mapping
      studentTags?.forEach(tag => {
        const classId = tag.tag_value.replace('CLASS:', '')
        const existing = studentClassMap.get(tag.user_id) || []
        existing.push(classId)
        studentClassMap.set(tag.user_id, existing)
      })

      // Transform learners to GodModeUsers with context
      const users: GodModeUser[] = (learners || []).map(learner => {
        const user: GodModeUser = {
          user_id: learner.user_id,
          learner_id: learner.id,
          display_name: learner.display_name,
          educational_role: learner.educational_role as EducationalRole,
          platform_role: learner.platform_role as 'ssi_admin' | null,
        }

        // Add context based on role
        switch (learner.educational_role) {
          case 'govt_admin': {
            const govt = govtMap.get(learner.user_id)
            if (govt) {
              user.region_code = govt.region_code
              user.organization_name = govt.organization_name
            }
            break
          }
          case 'school_admin': {
            const school = schoolMap.get(learner.user_id)
            if (school) {
              user.school_id = school.id
              user.school_name = school.school_name
              user.region_code = school.region_code
            }
            break
          }
          case 'teacher': {
            const schoolId = teacherSchoolMap.get(learner.user_id)
            if (schoolId) {
              const school = schoolById.get(schoolId)
              user.school_id = schoolId
              user.school_name = school?.school_name
              user.region_code = school?.region_code
            }
            break
          }
          case 'student': {
            const classIds = studentClassMap.get(learner.user_id)
            if (classIds && classIds.length > 0) {
              user.class_ids = classIds
              // Get school from first class
              const schoolId = classSchoolMap.get(classIds[0])
              if (schoolId) {
                const school = schoolById.get(schoolId)
                user.school_id = schoolId
                user.school_name = school?.school_name
              }
            }
            break
          }
        }

        return user
      })

      allUsers.value = users
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to fetch users'
      console.error('God Mode fetch error:', err)
    } finally {
      isLoading.value = false
    }
  }

  // Select a user to impersonate
  function selectUser(user: GodModeUser) {
    selectedUser.value = user
  }

  // Clear selection
  function clearSelection() {
    selectedUser.value = null
  }

  // Search/filter users
  function searchUsers(query: string, roleFilter?: EducationalRole): GodModeUser[] {
    let results = allUsers.value

    if (roleFilter) {
      results = results.filter(u => u.educational_role === roleFilter)
    }

    if (query) {
      const lowerQuery = query.toLowerCase()
      results = results.filter(u =>
        u.display_name.toLowerCase().includes(lowerQuery) ||
        u.user_id.toLowerCase().includes(lowerQuery) ||
        u.school_name?.toLowerCase().includes(lowerQuery) ||
        u.organization_name?.toLowerCase().includes(lowerQuery)
      )
    }

    return results
  }

  // Computed role checks (for compatibility with existing code)
  const currentRole = computed((): EducationalRole | null => {
    return selectedUser.value?.educational_role || null
  })

  const isSsiAdmin = computed(() => selectedUser.value?.platform_role === 'ssi_admin')
  const isGovtAdmin = computed(() => currentRole.value === 'govt_admin')
  const isSchoolAdmin = computed(() => currentRole.value === 'school_admin')
  const isTeacher = computed(() => currentRole.value === 'teacher')
  const isStudent = computed(() => currentRole.value === 'student')

  // Permission checks
  const canAccessDashboard = computed(() =>
    currentRole.value === 'govt_admin' ||
    currentRole.value === 'school_admin' ||
    currentRole.value === 'teacher'
  )
  const canManageTeachers = computed(() =>
    currentRole.value === 'school_admin'
  )
  const canViewSchoolAnalytics = computed(() =>
    currentRole.value === 'school_admin' || currentRole.value === 'govt_admin'
  )
  const canViewRegion = computed(() =>
    currentRole.value === 'govt_admin'
  )

  // Quick access helpers
  const usersByRole = computed(() => {
    const grouped: Record<EducationalRole, GodModeUser[]> = {
      govt_admin: [],
      school_admin: [],
      teacher: [],
      student: [],
    }
    allUsers.value.forEach(u => {
      if (u.educational_role) {
        grouped[u.educational_role].push(u)
      }
    })
    return grouped
  })

  return {
    // State
    selectedUser,
    allUsers,
    isLoading,
    error,

    // Computed
    currentRole,
    usersByRole,

    // Role checks
    isSsiAdmin,
    isGovtAdmin,
    isSchoolAdmin,
    isTeacher,
    isStudent,

    // Permission checks
    canAccessDashboard,
    canManageTeachers,
    canViewSchoolAnalytics,
    canViewRegion,

    // Actions
    fetchUsers,
    selectUser,
    clearSelection,
    searchUsers,
  }
}
