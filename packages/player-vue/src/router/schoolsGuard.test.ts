import { describe, it, expect, beforeEach } from 'vitest'
import router from './index'
import { useUserRole } from '@/composables/useUserRole'

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

  it('the /schools/play child route (play-as-class, embedded under SchoolsTopBar) is covered by the same parent guard — a plain learner is bounced, never reaching it', async () => {
    useUserRole().initialize(null, null)
    await router.push({ path: '/schools/play', query: { class: 'c1' } })
    expect(router.currentRoute.value.fullPath).toBe('/')
  })

  // Owner ruling 2026-08-06: /schools/play is play-as-class ONLY — self-practice
  // now goes to the immersive '/'. A school-role user reaches it WITH a class…
  it('a school-role user reaches /schools/play with a class session', async () => {
    useUserRole().initialize(null, 'teacher')
    await router.push({ path: '/schools/play', query: { class: 'c1' } })
    expect(router.currentRoute.value.fullPath).toBe('/schools/play?class=c1')
  })

  // …and WITHOUT one (stale bookmark, hand-typed URL) is sent to the navless
  // player rather than shown a class-less wrapped player.
  it('a school-role user hitting /schools/play with no class lands on the immersive player', async () => {
    useUserRole().initialize(null, 'teacher')
    await router.push('/schools/play')
    expect(router.currentRoute.value.fullPath).toBe('/')
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

// Exercises the real '/' route (index.ts) — owner ruling 2026-07-24:
// EVERYONE lands in the player by default, regardless of role. /schools is
// somewhere you deliberately navigate to. This supersedes the 2026-07-16
// "staff home is the dashboard" ruling (and its earlier, once-reverted
// attempt at this exact fix, ca88e0a8) — '/' now carries no role-based
// redirect at all.
describe('/ (bare player) route — no role-based redirect', () => {
  beforeEach(async () => {
    localStorage.clear()
    sessionStorage.clear()
    useUserRole().clear()
    await router.push('/schools')
  })

  it('a school-role user stays on the player at /', async () => {
    useUserRole().initialize(null, 'teacher')
    await router.push('/')
    expect(router.currentRoute.value.fullPath).toBe('/')
  })

  it('a tutor stays on the player at / too', async () => {
    useUserRole().initialize(null, 'tutor')
    await router.push('/')
    expect(router.currentRoute.value.fullPath).toBe('/')
  })

  it('a govt_admin stays on the player at /', async () => {
    useUserRole().initialize(null, 'govt_admin')
    await router.push('/')
    expect(router.currentRoute.value.fullPath).toBe('/')
  })

  it('a plain learner (no school role) stays on the player', async () => {
    useUserRole().initialize(null, null)
    await router.push('/')
    expect(router.currentRoute.value.fullPath).toBe('/')
  })

  it('a student (school role, but not staff) stays on the player', async () => {
    useUserRole().initialize(null, 'student')
    await router.push('/')
    expect(router.currentRoute.value.fullPath).toBe('/')
  })

  it('an uninitialized role cache stays on the player too', async () => {
    await router.push('/')
    expect(router.currentRoute.value.fullPath).toBe('/')
  })

  it('a school-role user can still navigate to /schools directly (deep link)', async () => {
    useUserRole().initialize(null, 'school_admin')
    await router.push('/')
    await router.push('/schools')
    expect(router.currentRoute.value.fullPath).toBe('/schools')
  })

  it('refreshing while on /schools does not bounce to the player', async () => {
    useUserRole().initialize(null, 'teacher')
    await router.push('/schools')
    expect(router.currentRoute.value.fullPath).toBe('/schools')
  })
})
