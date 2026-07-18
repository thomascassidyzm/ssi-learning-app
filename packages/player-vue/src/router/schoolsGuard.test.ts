import { describe, it, expect, beforeEach, vi } from 'vitest'
import router from './index'
import { useUserRole } from '@/composables/useUserRole'
import { useStartSurface } from '@/composables/useStartSurface'
import { useResolvedSession } from '@/composables/useResolvedSession'

// Exercises the real /schools beforeEnter guard (index.ts:76) via actual
// navigation — the guard that bounced a freshly-redeemed govt_admin to '/'
// on their first navigation because the role cache raced a stale overwrite
// (useAuth's SIGNED_IN-triggered ensureLearnerExists()).

describe('/schools route guard', () => {
  beforeEach(async () => {
    localStorage.clear()
    sessionStorage.clear()
    useUserRole().clear()
    // Reset to a neutral route so each test's push starts from the same place.
    await router.push('/')
  })

  it('does not bounce on empty localStorage — falls through to the container', async () => {
    // Cleared/first-ever storage (or a race where nothing has been cached
    // yet): isInitialized stays false, so the guard defers to
    // SchoolsContainer's own async gating rather than bouncing to '/'.
    await router.push('/schools')
    expect(router.currentRoute.value.fullPath).toBe('/schools')
  })

  it('lets a school-role user through once the role cache is populated', async () => {
    useUserRole().initialize(null, 'govt_admin')
    await router.push('/schools')
    expect(router.currentRoute.value.fullPath).toBe('/schools')
  })

  it('lets an invite-born school_admin straight through to /schools — no second auth step in the way', async () => {
    // redeem.ts's school_admin branch now redirects straight to /schools
    // (2026-07-13, single-OTP fix) instead of the /schools1 onboarding
    // continuation; this is the guard that continuation used to exist to
    // dodge. RedeemCode.vue's optimistic post-redemption initialize() call
    // is what populates the cache before this navigation fires.
    useUserRole().initialize(null, 'school_admin')
    await router.push('/schools')
    expect(router.currentRoute.value.fullPath).toBe('/schools')
  })

  it('bounces an initialized user with no school role to /', async () => {
    useUserRole().initialize(null, null)
    await router.push('/schools')
    expect(router.currentRoute.value.fullPath).toBe('/')
  })

  it('THE-MODEL I5: a tutor role reaches /schools directly — no bounce to /tutors/dashboard', async () => {
    // Tutor/schools shell dissolution: once the role cache knows 'tutor',
    // hasSchoolRole is true synchronously (no async teaching-context fetch
    // needed to avoid the bounce), so this never flickers through
    // /tutors/dashboard before landing on /schools.
    useUserRole().initialize(null, 'tutor')
    await router.push('/schools')
    expect(router.currentRoute.value.fullPath).toBe('/schools')
    expect(useUserRole().hasSchoolRole.value).toBe(true)
  })

  it('trapped-Aran fallback still holds: an initialized user with NO role who last visited /teach bounces to /tutors/dashboard, not the dead-end wall', async () => {
    localStorage.setItem('ssi-last-dashboard', 'teach')
    useUserRole().initialize(null, null)
    await router.push('/schools')
    expect(router.currentRoute.value.fullPath).toBe('/tutors/dashboard')
  })

  it('the /schools/play child route (staff self-practice, embedded under SchoolsTopBar) is covered by the same parent guard — a plain learner is bounced, never reaching it', async () => {
    useUserRole().initialize(null, null)
    await router.push('/schools/play')
    expect(router.currentRoute.value.fullPath).toBe('/')
  })

  it('a school-role user reaches /schools/play directly (the Learn button target)', async () => {
    useUserRole().initialize(null, 'teacher')
    await router.push('/schools/play')
    expect(router.currentRoute.value.fullPath).toBe('/schools/play')
  })

  it('restores a role persisted by a prior initialize() call on a fresh (uninitialized) module state', async () => {
    // Simulates the real sequence: initialize() (e.g. RedeemCode's
    // post-redemption write) persists to localStorage synchronously; a
    // later navigation with nothing yet in memory (isInitialized false,
    // the beforeEach state here) picks it straight back up via
    // restoreFromCache() inside the guard — no bounce.
    localStorage.setItem('ssi-user-role', JSON.stringify({ platformRole: null, educationalRole: 'govt_admin' }))
    await router.push('/schools')
    expect(router.currentRoute.value.fullPath).toBe('/schools')
    expect(useUserRole().hasSchoolRole.value).toBe(true)
  })
})

// Login lands in your OWN player, for every role (founder ruling 2026-07-18:
// remember progress, not position — supersedes the 2026-07-16 "staff home is
// the dashboard" ruling and its cached-role fast-path, which resurrected a
// stale role cache from a prior session on a fresh login). The ONLY thing
// that moves a resolved session off '/' is the explicit "Start me at"
// preference, and only to a surface the current role can access.
describe('/ (bare player) — login lands at the player; start preference is opt-in', () => {
  beforeEach(async () => {
    localStorage.clear()
    sessionStorage.clear()
    useUserRole().clear()
    useStartSurface().clear()
    useResolvedSession().reset()
    await router.push('/schools1') // neutral non-'/' start so the push to '/' is a real navigation
  })

  it('does NOT redirect a school-role user — a stale cached role can no longer hijack the landing', async () => {
    useUserRole().initialize(null, 'teacher')
    await router.push('/')
    expect(router.currentRoute.value.fullPath).toBe('/')
  })

  it('does NOT redirect a tutor or govt_admin either', async () => {
    useUserRole().initialize(null, 'tutor')
    await router.push('/')
    expect(router.currentRoute.value.fullPath).toBe('/')
    useUserRole().initialize(null, 'govt_admin')
    await router.push('/schools1')
    await router.push('/')
    expect(router.currentRoute.value.fullPath).toBe('/')
  })

  it('respects an explicit "Start me at: Schools" preference once the session resolves', async () => {
    await router.push('/')
    useUserRole().initialize(null, 'teacher')
    useStartSurface().setFromPreferences({ start_surface: 'schools' })
    useResolvedSession().resolve(true)
    await vi.waitFor(() => {
      expect(router.currentRoute.value.fullPath).toBe('/schools')
    })
  })

  it('ignores a "schools" preference when the current role has no school access — degrades to the player, never a wall', async () => {
    await router.push('/')
    useUserRole().initialize(null, null)
    useStartSurface().setFromPreferences({ start_surface: 'schools' })
    useResolvedSession().resolve(true)
    await new Promise((r) => setTimeout(r, 20))
    expect(router.currentRoute.value.fullPath).toBe('/')
  })

  it('deep link wins: preference never fires when the session resolves on a non-root route', async () => {
    await router.push('/schools1')
    useUserRole().initialize(null, 'teacher')
    useStartSurface().setFromPreferences({ start_surface: 'schools' })
    useResolvedSession().resolve(true)
    await new Promise((r) => setTimeout(r, 20))
    expect(router.currentRoute.value.fullPath).toBe('/schools1')
  })

  it('an admin preference lands on /admin/structure for an ssi_admin', async () => {
    await router.push('/')
    useUserRole().initialize('ssi_admin', null)
    useStartSurface().setFromPreferences({ start_surface: 'admin' })
    useResolvedSession().resolve(true)
    await vi.waitFor(() => {
      expect(router.currentRoute.value.fullPath).toBe('/admin/structure')
    })
  })
})
