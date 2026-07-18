/**
 * useUserRole - Single authority on user roles and capabilities
 *
 * Singleton composable (module-level refs). DB is source of truth,
 * localStorage is a fast cache for the router guard.
 */

import { ref, computed } from 'vue'

const STORAGE_KEY = 'ssi-user-role'

/**
 * A person candidate (name/role/ids) for admin-facing displays — e.g. the
 * "leader: X" text in the Structure detail panel. Historically also fed the
 * removed act-as/view-as UI (THE-MODEL.md §1.8); the shape survives for
 * read-only display, the persona-minting behaviour does not.
 */
export interface ActAsPersona {
  key: string
  userId: string
  role: 'teacher' | 'school_admin' | 'govt_admin' | 'student'
  name: string
  // Only used for role 'student' — AdminUserProgress.vue's route needs the
  // learner PK, not the auth uid (learners.id vs learners.user_id).
  learnerId?: string
}

// State (module-level singleton)
const platformRole = ref<string | null>(null)
const educationalRole = ref<string | null>(null)
const isInitialized = ref(false)

// Role hierarchy: ssi_admin > govt_admin > school_admin > teacher > student
// ('god' was collapsed into the ssi_admin platform role — 2026-06-16)
const isSsiAdmin = computed(() => platformRole.value === 'ssi_admin')
// Deprecated alias: 'god' is now just ssi_admin. Kept so any stray caller still resolves.
const isGod = isSsiAdmin
const isGovtAdmin = computed(() => educationalRole.value === 'govt_admin')
const isSchoolAdmin = computed(() =>
  ['school_admin', 'govt_admin'].includes(educationalRole.value || '')
)
// THE-MODEL §1.3/§2.1/I5: 'tutor' is a groupless teacher, not a separate
// type — the tutor/schools shell split dissolves, so every role gate that
// admits 'teacher' admits 'tutor' too.
const isTeacher = computed(() =>
  ['teacher', 'tutor', 'school_admin', 'govt_admin'].includes(educationalRole.value || '')
)

// True for users whose educational role is school-scoped.
const hasSchoolRole = computed(() =>
  ['teacher', 'tutor', 'school_admin', 'govt_admin'].includes(educationalRole.value || '')
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
  writeRoleCache(nextPlatform, nextEducational)
}

/**
 * Authoritative sync from a real DB row — the ONLY source of truth for both
 * fields at once. Unlike initialize(), null here means "the DB row says
 * this field is genuinely cleared" (e.g. a de-platformed ssi_admin's
 * platform_role going to null — see api/admin/update-user-role.ts, "null is
 * permitted to clear the role"), not "caller doesn't know" — so it never
 * falls back to the stale cached value. initialize()'s guard exists for
 * partial-knowledge callers (e.g. RedeemCode's optimistic post-redemption
 * write, which only knows the just-redeemed educational role); a caller
 * holding the full row — useAuth's syncRealRoleCache, on every learner-row
 * fetch including useAdminGate's periodic mid-session re-validation — must
 * use this instead, or a genuine demotion is silently swallowed.
 */
function setAuthoritative(platform: string | null, educational: string | null): void {
  writeRoleCache(platform, educational)
}

function writeRoleCache(platform: string | null, educational: string | null): void {
  platformRole.value = platform
  educationalRole.value = educational
  isInitialized.value = true

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ platformRole: platform, educationalRole: educational }))
  } catch {
    // localStorage unavailable
  }
}

// Dev-only e2e hook, same rationale/erasure as useSchoolContext.ts's
// __setSchoolsE2EUser: lets a Playwright spec set the role cache directly
// (mirrors `role.initialize(...)` in the *.test.ts unit tests) without a
// real Supabase session.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  ;(window as any).__setSchoolsE2ERole = initialize
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
    hasSchoolRole,

    // Capabilities
    canAccessAdmin,
    canAccessSchools,
    canImpersonate,

    // Actions
    initialize,
    setAuthoritative,
    restoreFromCache,
    clear,
  }
}
