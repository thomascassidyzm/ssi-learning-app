/**
 * useUserRole - Single authority on user roles and capabilities
 *
 * Singleton composable (module-level refs). DB is source of truth,
 * localStorage is a fast cache for the router guard.
 */

import { ref, computed } from 'vue'

const STORAGE_KEY = 'ssi-user-role'
// View-as overlay, sessionStorage-backed: a reload keeps it inside the tab,
// closing the tab drops it. Never localStorage — a borrowed identity must
// never outlive the window it was borrowed in.
const ACT_AS_KEY = 'ssi-acting-as'

/**
 * A view-as persona: the role the UI should wear, and — when the admin picked
 * a real person rather than a bare role — that person's ids so their own
 * school/group/class scope can be loaded (useSchoolContext.loadAsPersona).
 *
 * `userId` empty string = ROLE-ONLY view-as ("show me any plain learner's
 * app"), which needs no person and loads no foreign scope.
 */
export interface ActAsPersona {
  key: string
  userId: string
  role: 'teacher' | 'school_admin' | 'govt_admin' | 'student'
  name: string
  // Only used for role 'student' — the learner PK, not the auth uid
  // (learners.id vs learners.user_id).
  learnerId?: string
}

/** Human label for a persona's role, for the view-as banner and picker. */
export function roleLabel(role: ActAsPersona['role']): string {
  switch (role) {
    case 'teacher':
      return 'Teacher'
    case 'school_admin':
      return 'School leader'
    case 'govt_admin':
      return 'Group leader'
    case 'student':
      return 'Learner'
  }
}

// State (module-level singleton)
const platformRole = ref<string | null>(null)
const educationalRole = ref<string | null>(null)
const isInitialized = ref(false)

// View-as overlay: when an ssi_admin steps into a role/persona, this holds it.
// The REAL platformRole stays 'ssi_admin' throughout (isSsiAdmin below is the
// raw truth, so the exit banner and the admin's own session survive) — what
// changes is every EFFECTIVE capability the UI and the router read.
const actingAs = ref<ActAsPersona | null>(null)
const isActingAs = computed(() => actingAs.value !== null)

// The school role the UI should reflect — the persona's while viewing-as,
// otherwise the user's own. Drives the member-surface route guard and every
// role capability below.
const effectiveEducationalRole = computed(() => {
  if (!actingAs.value) return educationalRole.value
  // A learner persona has NO educational role — that absence is the point:
  // it is what makes every staff surface correctly disappear.
  return actingAs.value.role === 'student' ? null : actingAs.value.role
})

// Role hierarchy: ssi_admin > govt_admin > school_admin > teacher > student
// ('god' was collapsed into the ssi_admin platform role — 2026-06-16)
const isSsiAdmin = computed(() => platformRole.value === 'ssi_admin')
// Deprecated alias: 'god' is now just ssi_admin. Kept so any stray caller still resolves.
const isGod = isSsiAdmin
const isGovtAdmin = computed(() => effectiveEducationalRole.value === 'govt_admin')
const isSchoolAdmin = computed(() =>
  ['school_admin', 'govt_admin'].includes(effectiveEducationalRole.value || '')
)
// THE-MODEL §1.3/§2.1/I5: 'tutor' is a groupless teacher, not a separate
// type — the tutor/schools shell split dissolves, so every role gate that
// admits 'teacher' admits 'tutor' too.
const isTeacher = computed(() =>
  ['teacher', 'tutor', 'school_admin', 'govt_admin'].includes(effectiveEducationalRole.value || '')
)

// True for users whose educational role is school-scoped.
const hasSchoolRole = computed(() =>
  ['teacher', 'tutor', 'school_admin', 'govt_admin'].includes(effectiveEducationalRole.value || '')
)

const isTester = computed(() => !isActingAs.value && (platformRole.value === 'tester' || isSsiAdmin.value))

// Capabilities
// NOT raw isSsiAdmin: while viewing-as, the admin estate must be ABSENT —
// that is the whole point of checking what a persona sees. The way back is
// the view-as banner's Exit (which drops the overlay first), never a stray
// admin link that the persona would never have.
const canAccessAdmin = computed(() => isSsiAdmin.value && !isActingAs.value)
// ssi_admins reach the schools area too — they're the platform operator, not a
// school member, so they must never hit the "no school access / join code" wall
// (which is for a signed-in learner with no school). Restores the pre-collapse
// behaviour, where god — now folded into ssi_admin — passed this gate.
// The raw-admin arm drops while viewing-as, so a learner persona loses the
// Schools door exactly as a real learner has never had one.
const canAccessSchools = computed(() => isTeacher.value || (isSsiAdmin.value && !isActingAs.value))
const canImpersonate = computed(() => isSsiAdmin.value)
// Who may step into a role/persona. Raw platform role — an admin already
// viewing-as may switch persona without exiting first.
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
  // Always rehydrate an in-flight view-as (sessionStorage) so the router
  // guards see the persona on a hard reload, independent of whether the real
  // role cache is initialized yet.
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
 * Begin viewing as a persona. The real platformRole ('ssi_admin') is left
 * intact; only the EFFECTIVE role changes. Persisted to sessionStorage.
 */
function startActingAs(persona: ActAsPersona): void {
  actingAs.value = persona
  try {
    sessionStorage.setItem(ACT_AS_KEY, JSON.stringify(persona))
  } catch {
    // sessionStorage unavailable
  }
}

/** Stop viewing-as and return to the admin's own identity. */
function stopActingAs(): void {
  actingAs.value = null
  try {
    sessionStorage.removeItem(ACT_AS_KEY)
  } catch {
    // sessionStorage unavailable
  }
}

/**
 * Header attached to every write-endpoint fetch made while viewing-as, so the
 * server rejects it (api/_utils/actAsGuard.ts) even on endpoints carrying a
 * deliberate ssi_admin support bypass. A real teacher/school-admin session
 * never sends it, so its presence alone is a safe reject signal.
 */
export function viewAsRequestHeaders(): Record<string, string> {
  return isActingAs.value ? { 'X-Ssi-View-As': '1' } : {}
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
    effectiveEducationalRole,

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
    setAuthoritative,
    restoreFromCache,
    startActingAs,
    stopActingAs,
    clear,
  }
}
