/**
 * useDevRole - Development role switcher with tier, seed override, and personas
 *
 * Allows switching between roles, subscription tiers, and progress levels
 * without auth for testing/demo purposes.
 * Stores state in localStorage so it persists across refreshes.
 */

import { ref, computed, watch } from 'vue'

export type DevRole = 'school_admin' | 'teacher' | 'student'
export type DevTier = 'free' | 'paid' | 'community'

export interface DevUser {
  id: string
  name: string
  email: string
  role: DevRole
  schoolId: string
  schoolName: string
  classIds?: string[]
}

export interface DevPersona {
  name: string
  role: DevRole
  tier: DevTier
  seedOverride: number | null
}

// Mock users for each role
const MOCK_USERS: Record<DevRole, DevUser> = {
  school_admin: {
    id: 'admin-001',
    name: 'Sian Morgan',
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

export const PERSONAS: DevPersona[] = [
  { name: 'New Free Learner',     role: 'student',      tier: 'free',  seedOverride: null },
  { name: 'Yellow Belt Learner',  role: 'student',      tier: 'free',  seedOverride: 15 },
  { name: 'Green Belt Paid',      role: 'student',      tier: 'paid',  seedOverride: 60 },
  { name: 'Advanced Learner',     role: 'student',      tier: 'paid',  seedOverride: 200 },
  { name: 'Teacher',              role: 'teacher',      tier: 'free',  seedOverride: null },
  { name: 'School Admin',         role: 'school_admin', tier: 'free',  seedOverride: null },
]

// Storage keys
const ROLE_KEY = 'ssi-dev-role'
const TIER_KEY = 'ssi-dev-tier'
const SEED_OVERRIDE_KEY = 'ssi-dev-seed-override'
const PAID_USER_KEY = 'ssi-dev-paid-user'

// ============================================================================
// LOADERS
// ============================================================================

function loadRole(): DevRole {
  if (typeof window === 'undefined') return 'school_admin'
  const stored = localStorage.getItem(ROLE_KEY)
  if (stored && (stored === 'school_admin' || stored === 'teacher' || stored === 'student')) {
    return stored
  }
  return 'school_admin'
}

function loadTier(): DevTier {
  if (typeof window === 'undefined') return 'free'
  const stored = localStorage.getItem(TIER_KEY)
  if (stored && (stored === 'free' || stored === 'paid' || stored === 'community')) {
    return stored
  }
  return 'free'
}

function loadSeedOverride(): number | null {
  if (typeof window === 'undefined') return null
  const stored = localStorage.getItem(SEED_OVERRIDE_KEY)
  if (stored) {
    const num = parseInt(stored, 10)
    return isNaN(num) ? null : num
  }
  return null
}

// ============================================================================
// SHARED REACTIVE STATE (module-level singletons)
// ============================================================================

const currentRole = ref<DevRole>(loadRole())
const currentTier = ref<DevTier>(loadTier())
const devSeedOverride = ref<number | null>(loadSeedOverride())

// Persist on change
watch(currentRole, (v) => localStorage.setItem(ROLE_KEY, v))
watch(currentTier, (v) => {
  localStorage.setItem(TIER_KEY, v)
  // Keep legacy ssi-dev-paid-user flag in sync for useEntitlement compat
  localStorage.setItem(PAID_USER_KEY, v === 'paid' ? 'true' : 'false')
})
watch(devSeedOverride, (v) => {
  if (v === null) {
    localStorage.removeItem(SEED_OVERRIDE_KEY)
  } else {
    localStorage.setItem(SEED_OVERRIDE_KEY, String(v))
  }
})

// ============================================================================
// COMPOSABLE
// ============================================================================

export function useDevRole() {
  const setRole = (role: DevRole) => {
    currentRole.value = role
  }

  const setTier = (tier: DevTier) => {
    currentTier.value = tier
  }

  const setSeedOverride = (seed: number | null) => {
    devSeedOverride.value = seed
  }

  const clearSeedOverride = () => {
    devSeedOverride.value = null
  }

  const applyPersona = (persona: DevPersona) => {
    currentRole.value = persona.role
    currentTier.value = persona.tier
    devSeedOverride.value = persona.seedOverride
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
    currentTier,
    devSeedOverride,
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
    setTier,
    setSeedOverride,
    clearSeedOverride,
    applyPersona,

    // Constants
    MOCK_USERS,
    PERSONAS,
  }
}
