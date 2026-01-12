/**
 * useDevRole - Development role switcher
 *
 * Allows switching between roles without auth for testing/demo purposes.
 * Stores role in localStorage so it persists across refreshes.
 */

import { ref, computed, watch } from 'vue'

export type DevRole = 'school_admin' | 'teacher' | 'student'

export interface DevUser {
  id: string
  name: string
  email: string
  role: DevRole
  schoolId: string
  schoolName: string
  classIds?: string[]
}

// Mock users for each role
const MOCK_USERS: Record<DevRole, DevUser> = {
  school_admin: {
    id: 'admin-001',
    name: 'Siân Morgan',
    email: 'sian.morgan@ysgolcymraeg.edu',
    role: 'school_admin',
    schoolId: 'school-001',
    schoolName: 'Ysgol Gymraeg Aberystwyth',
  },
  teacher: {
    id: 'teacher-001',
    name: 'Rhys Jones',
    email: 'rhys.jones@ysgolcymraeg.edu',
    role: 'teacher',
    schoolId: 'school-001',
    schoolName: 'Ysgol Gymraeg Aberystwyth',
    classIds: ['class-001', 'class-002'],
  },
  student: {
    id: 'student-001',
    name: 'Gareth Llywelyn',
    email: 'gareth.l@student.edu',
    role: 'student',
    schoolId: 'school-001',
    schoolName: 'Ysgol Gymraeg Aberystwyth',
    classIds: ['class-001'],
  },
}

const STORAGE_KEY = 'ssi-dev-role'

// Shared reactive state
const currentRole = ref<DevRole>(loadRole())

function loadRole(): DevRole {
  if (typeof window === 'undefined') return 'school_admin'
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored && (stored === 'school_admin' || stored === 'teacher' || stored === 'student')) {
    return stored
  }
  return 'school_admin'
}

function saveRole(role: DevRole) {
  localStorage.setItem(STORAGE_KEY, role)
}

// Watch for changes and persist
watch(currentRole, (newRole) => {
  saveRole(newRole)
})

export function useDevRole() {
  const setRole = (role: DevRole) => {
    currentRole.value = role
  }

  const currentUser = computed((): DevUser => {
    return MOCK_USERS[currentRole.value]
  })

  const isSchoolAdmin = computed(() => currentRole.value === 'school_admin')
  const isTeacher = computed(() => currentRole.value === 'teacher')
  const isStudent = computed(() => currentRole.value === 'student')

  // School admins and teachers can access the dashboard
  const canAccessDashboard = computed(() =>
    currentRole.value === 'school_admin' || currentRole.value === 'teacher'
  )

  // Only school admins can manage teachers
  const canManageTeachers = computed(() => currentRole.value === 'school_admin')

  // Only school admins can see school-wide analytics
  const canViewSchoolAnalytics = computed(() => currentRole.value === 'school_admin')

  return {
    // State
    currentRole,
    currentUser,

    // Role checks
    isSchoolAdmin,
    isTeacher,
    isStudent,

    // Permission checks
    canAccessDashboard,
    canManageTeachers,
    canViewSchoolAnalytics,

    // Actions
    setRole,

    // Constants
    MOCK_USERS,
  }
}
