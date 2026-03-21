/**
 * useUserRole - Single authority on user roles and capabilities
 *
 * Singleton composable (module-level refs). DB is source of truth,
 * localStorage is a fast cache for the router guard.
 */

import { ref, computed } from 'vue'

const STORAGE_KEY = 'ssi-user-role'

// State (module-level singleton)
const platformRole = ref<string | null>(null)
const educationalRole = ref<string | null>(null)
const isInitialized = ref(false)

// Role hierarchy: god > ssi_admin > govt_admin > school_admin > teacher > student
const isGod = computed(() => educationalRole.value === 'god')
const isSsiAdmin = computed(() => platformRole.value === 'ssi_admin' || isGod.value)
const isGovtAdmin = computed(() => educationalRole.value === 'govt_admin' || isGod.value)
const isSchoolAdmin = computed(() =>
  ['school_admin', 'govt_admin', 'god'].includes(educationalRole.value || '')
)
const isTeacher = computed(() =>
  ['teacher', 'school_admin', 'govt_admin', 'god'].includes(educationalRole.value || '')
)

const isTester = computed(() => platformRole.value === 'tester' || isSsiAdmin.value)

// Capabilities
const canAccessAdmin = computed(() => isSsiAdmin.value)
const canAccessSchools = computed(() => isTeacher.value)
const canImpersonate = computed(() => isGod.value)

/**
 * Initialize from known role values (called after DB fetch)
 */
function initialize(platform: string | null, educational: string | null): void {
  platformRole.value = platform
  educationalRole.value = educational
  isInitialized.value = true

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ platformRole: platform, educationalRole: educational }))
  } catch {
    // localStorage unavailable
  }
}

/**
 * Restore from localStorage cache (instant, no DB round-trip).
 * Used by the router guard on page reload.
 */
function restoreFromCache(): void {
  if (isInitialized.value) return
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      const parsed = JSON.parse(stored)
      platformRole.value = parsed.platformRole ?? null
      educationalRole.value = parsed.educationalRole ?? null
      isInitialized.value = true
    }
  } catch {
    // malformed or unavailable
  }
}

/**
 * Clear on logout
 */
function clear(): void {
  platformRole.value = null
  educationalRole.value = null
  isInitialized.value = false
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // localStorage unavailable
  }
}

export function useUserRole() {
  return {
    // State
    platformRole,
    educationalRole,
    isInitialized,

    // Role booleans
    isGod,
    isSsiAdmin,
    isTester,
    isGovtAdmin,
    isSchoolAdmin,
    isTeacher,

    // Capabilities
    canAccessAdmin,
    canAccessSchools,
    canImpersonate,

    // Actions
    initialize,
    restoreFromCache,
    clear,
  }
}
