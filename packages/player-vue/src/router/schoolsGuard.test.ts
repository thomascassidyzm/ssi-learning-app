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

  it('bounces an initialized user with no school role to /', async () => {
    useUserRole().initialize(null, null)
    await router.push('/schools')
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
