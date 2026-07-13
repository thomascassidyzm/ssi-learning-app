/**
 * useUserRole - Single authority on user roles and capabilities
 *
 * Singleton composable (module-level refs). DB is source of truth,
 * localStorage is a fast cache for the router guard.
 */

import { ref, computed } from 'vue'

const STORAGE_KEY = 'ssi-user-role'
const ACT_AS_KEY = 'ssi-acting-as'

export interface ActAsPersona {
  key: string
  userId: string
  role: 'teacher' | 'school_admin' | 'govt_admin'
  name: string
}

// State (module-level singleton)
const platformRole = ref<string | null>(null)
const educationalRole = ref<string | null>(null)
const isInitialized = ref(false)

// Act-as overlay: when an ssi_admin steps into a persona's shoes, this holds
// the persona's role. Stored in sessionStorage (auto-clears on tab close) so
// a reload keeps the act-as within the tab. The REAL platformRole stays
// 'ssi_admin' throughout, so admin controls (incl. the exit banner) survive.
const actingAs = ref<ActAsPersona | null>(null)
const isActingAs = computed(() => actingAs.value !== null)

// The school role the UI should reflect — the persona's while acting-as,
// otherwise the user's own. Drives the /schools route guard and capabilities.
const effectiveEducationalRole = computed(() => actingAs.value?.role ?? educationalRole.value)

// Role hierarchy: ssi_admin > govt_admin > school_admin > teacher > student
// ('god' was collapsed into the ssi_admin platform role — 2026-06-16)
const isSsiAdmin = computed(() => platformRole.value === 'ssi_admin')
// Deprecated alias: 'god' is now just ssi_admin. Kept so any stray caller still resolves.
const isGod = isSsiAdmin
const isGovtAdmin = computed(() => effectiveEducationalRole.value === 'govt_admin')
const isSchoolAdmin = computed(() =>
  ['school_admin', 'govt_admin'].includes(effectiveEducationalRole.value || '')
)
const isTeacher = computed(() =>
  ['teacher', 'school_admin', 'govt_admin'].includes(effectiveEducationalRole.value || '')
)

// True for users whose effective role is a school-scoped educational role.
// Admins reach schools via act-as (effectiveEducationalRole), not direct membership.
// While acting-as, this is true so the /schools guard renders the live
// experience instead of bouncing the admin to /admin/schools.
const hasSchoolRole = computed(() =>
  ['teacher', 'school_admin', 'govt_admin'].includes(effectiveEducationalRole.value || '')
)

const isTester = computed(() => platformRole.value === 'tester' || isSsiAdmin.value)

// Capabilities
const canAccessAdmin = computed(() => isSsiAdmin.value)
// ssi_admins reach the schools area too — they're the platform operator, not a
// school member, so they must never hit the "no school access / join code" wall
// (which is for a signed-in learner with no school). Restores the pre-collapse
// behaviour, where god — now folded into ssi_admin — passed this gate.
const canAccessSchools = computed(() => isTeacher.value || isSsiAdmin.value)
const canImpersonate = computed(() => isSsiAdmin.value)
// Who may step into a persona's shoes (the act-as feature).
const canActAs = computed(() => isSsiAdmin.value)

/**
 * Initialize from known role values (called after DB fetch).
 *
 * Guards against the "partial payload" clobber: some callers only know ONE
 * of the two roles (e.g. RedeemCode's optimistic post-redemption write knows
 * the just-redeemed educational role but not the platform role) and pass
 * null for the other, meaning "I don't know", not "this is genuinely
 * cleared". Overwriting a known non-null role with that null silently
 * downgrades e.g. an ssi_admin to nobody, and the bad value STICKS because
 * it's persisted to localStorage below. A caller that HAS the real DB row
 * (the only source of truth) always passes both fields together, so this
 * guard never blocks a genuine demotion — only an incomplete write. Explicit
 * clears (logout) go through clear(), not initialize().
 */
function initialize(platform: string | null, educational: string | null): void {
  const nextPlatform = platform === null && platformRole.value !== null ? platformRole.value : platform
  const nextEducational = educational === null && educationalRole.value !== null ? educationalRole.value : educational

  platformRole.value = nextPlatform
  educationalRole.value = nextEducational
  isInitialized.value = true

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ platformRole: nextPlatform, educationalRole: nextEducational }))
  } catch {
    // localStorage unavailable
  }
}

/**
 * Restore from localStorage cache (instant, no DB round-trip).
 * Used by the router guard on page reload.
 */
function restoreFromCache(): void {
  // Always restore an in-flight act-as overlay (sessionStorage) so the
  // /schools router guard sees the persona's role even on a hard reload,
  // independent of whether the real role cache is already initialized.
  if (!actingAs.value) {
    try {
      const a = sessionStorage.getItem(ACT_AS_KEY)
      if (a) actingAs.value = JSON.parse(a)
    } catch {
      // malformed or unavailable
    }
  }
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
 * Begin acting as a persona. The real platformRole ('ssi_admin') is left
 * intact; only the effective school role changes. Persisted to sessionStorage.
 */
function startActingAs(persona: ActAsPersona): void {
  actingAs.value = persona
  try {
    sessionStorage.setItem(ACT_AS_KEY, JSON.stringify(persona))
  } catch {
    // sessionStorage unavailable
  }
}

/** Stop acting as a persona and return to the admin's own identity. */
function stopActingAs(): void {
  actingAs.value = null
  try {
    sessionStorage.removeItem(ACT_AS_KEY)
  } catch {
    // sessionStorage unavailable
  }
}

/**
 * Clear on logout
 */
function clear(): void {
  platformRole.value = null
  educationalRole.value = null
  isInitialized.value = false
  stopActingAs()
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
    actingAs,
    isActingAs,

    // Role booleans
    isGod,
    isSsiAdmin,
    isTester,
    isGovtAdmin,
    isSchoolAdmin,
    isTeacher,
    hasSchoolRole,

    // Capabilities
    canAccessAdmin,
    canAccessSchools,
    canImpersonate,
    canActAs,

    // Actions
    initialize,
    restoreFromCache,
    startActingAs,
    stopActingAs,
    clear,
  }
}
