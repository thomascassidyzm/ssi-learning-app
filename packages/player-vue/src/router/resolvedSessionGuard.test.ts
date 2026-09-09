import { describe, it, expect, beforeEach } from 'vitest'
import { nextTick } from 'vue'
import router from './index'
import { useUserRole } from '@/composables/useUserRole'
import { useResolvedSession } from '@/composables/useResolvedSession'

// Exercises the admin/methodology top-level guard (index.ts) and the '/'
// corrective redirect watch — the two pieces the founder-priority bug fix
// added on top of the pre-existing /schools + '/' guards (see
// schoolsGuard.test.ts). Both used to make a final yes/no decision straight
// off the synchronous localStorage role cache; a fresh browser (no cache)
// read as "no", bouncing an about-to-resolve ssi_admin off every /admin deep
// link, or stranding a staff member on the bare player.

describe('/admin + /methodology guard', () => {
  beforeEach(async () => {
    localStorage.clear()
    sessionStorage.clear()
    useUserRole().clear()
    useResolvedSession().reset()
    await router.push('/')
  })

  it('does not bounce on an uninitialized role cache — defers rather than guessing', async () => {
    await router.push('/admin/setup')
    expect(router.currentRoute.value.fullPath).toBe('/admin/setup')
  })

  it('bounces a KNOWN non-admin to /', async () => {
    useUserRole().initialize(null, 'teacher')
    await router.push('/admin/setup')
    expect(router.currentRoute.value.fullPath).toBe('/')
  })

  it('lets a known ssi_admin straight through', async () => {
    useUserRole().initialize('ssi_admin', null)
    await router.push('/admin/setup')
    expect(router.currentRoute.value.fullPath).toBe('/admin/setup')
  })

  it('/methodology is covered by the same guard', async () => {
    useUserRole().initialize(null, 'teacher')
    await router.push('/methodology')
    expect(router.currentRoute.value.fullPath).toBe('/')
  })

  it('a non-admin route is never gated by this guard', async () => {
    await router.push('/schools1')
    expect(router.currentRoute.value.fullPath).toBe('/schools1')
  })
})

describe("'/' corrective redirect once the resolved-session gate settles", () => {
  beforeEach(async () => {
    localStorage.clear()
    sessionStorage.clear()
    useUserRole().clear()
    useResolvedSession().reset()
    await router.push('/schools') // neutral non-'/' starting point
    await router.push('/')
  })

  it('redirects a staff member left on the bare player once identity resolves — the minted-sign-in-link case', async () => {
    expect(router.currentRoute.value.fullPath).toBe('/')
    // Simulates useAuth's real sequence: resolve(true) fires as soon as the
    // session is found, then the role row lands a tick later.
    useResolvedSession().resolve(true)
    await nextTick()
    expect(router.currentRoute.value.fullPath).toBe('/') // role not synced yet — no premature redirect

    useUserRole().initialize(null, 'school_admin')
    await nextTick()
    await new Promise((resolve) => setTimeout(resolve, 0)) // let the watch-triggered router.replace() settle
    expect(router.currentRoute.value.fullPath).toBe('/schools')
  })

  it('does not redirect a resolved guest / plain learner', async () => {
    useResolvedSession().resolve(false)
    await nextTick()
    expect(router.currentRoute.value.fullPath).toBe('/')
  })

  it('does not redirect once resolved away from the bare player route', async () => {
    await router.push('/tutors/dashboard')
    useUserRole().initialize(null, 'teacher')
    useResolvedSession().resolve(true)
    await nextTick()
    expect(router.currentRoute.value.fullPath).toBe('/tutors/dashboard')
  })
})
