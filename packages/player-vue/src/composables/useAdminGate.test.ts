import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { defineComponent } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import { useUserRole } from '@/composables/useUserRole'
import { useResolvedSession } from '@/composables/useResolvedSession'
import { useAdminGate, deniedDestination } from '@/composables/useAdminGate'

// useAdminGate gates every admin surface. Doctrine (founder ruling 2026-07-19):
// the SERVER enforces role/scope per request, so this gate is a UX shell
// affordance — it bounces a revoked admin to `/` and re-validates the role on
// NAVIGATION only (no interval, no tab-refocus timer). These tests prove: the
// reactive deny-and-bounce on a role change, and that navigation — not a
// timer — is what triggers the DB re-fetch via the injected auth.refreshRole().

const Host = defineComponent({
  setup() {
    const gate = useAdminGate()
    return gate
  },
  template: '<div>{{ isCheckingAccess ? "checking" : isDenied ? "denied" : "allowed" }}</div>',
})

function buildRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/admin/test', component: Host },
      { path: '/', component: { template: '<div class="home">home</div>' } },
      // The guest-deny destination — registered so a still-mounted gate from an
      // earlier test can't spam "No match found" into this suite's output.
      { path: '/schools', component: { template: '<div class="schools">schools</div>' } },
    ],
  })
}

describe('useAdminGate', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    useUserRole().clear()
    useResolvedSession().reset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('a mid-session role downgrade revokes access and bounces — without a reload', async () => {
    useUserRole().initialize('ssi_admin', null)
    const router = buildRouter()
    router.push('/admin/test')
    await router.isReady()

    const wrapper = mount(Host, { global: { plugins: [router] } })
    await flushPromises()
    expect(wrapper.text()).toBe('allowed')
    expect(router.currentRoute.value.path).toBe('/admin/test')

    // The DB re-fetch (driven by useAdminGate's periodic revalidate() calling
    // auth.refreshRole(), which ultimately calls useAuth's syncRealRoleCache
    // → setAuthoritative) now discovers the caller was de-platformed
    // mid-session. setAuthoritative, not initialize() — a real DB row's
    // null must land as a genuine clear, not fall back to the stale cache.
    useUserRole().setAuthoritative(null, 'teacher')
    await flushPromises()

    expect(wrapper.text()).toBe('denied')
    expect(router.currentRoute.value.path).toBe('/')
  })

  it('a genuine admin is never bounced — no false lockout', async () => {
    useUserRole().initialize('ssi_admin', null)
    const router = buildRouter()
    router.push('/admin/test')
    await router.isReady()

    const wrapper = mount(Host, { global: { plugins: [router] } })
    await flushPromises()

    expect(wrapper.text()).toBe('allowed')
    expect(router.currentRoute.value.path).toBe('/admin/test')
  })

  it('a cold-cache non-admin is denied and bounced once resolution lands — never a false "allowed"', async () => {
    const router = buildRouter()
    router.push('/admin/test')
    await router.isReady()

    const wrapper = mount(Host, { global: { plugins: [router] } })
    await flushPromises()
    expect(wrapper.text()).toBe('checking')

    useResolvedSession().resolve(true)
    useUserRole().initialize(null, 'teacher')
    await flushPromises()

    expect(wrapper.text()).toBe('denied')
    expect(router.currentRoute.value.path).toBe('/')
  })

  it('re-validates the role on navigation (mount + each route change), never on a timer', async () => {
    vi.useFakeTimers()
    useUserRole().initialize('ssi_admin', null)
    const router = buildRouter()
    router.push('/admin/test')
    await router.isReady()

    const refreshRole = vi.fn().mockResolvedValue(undefined)
    mount(Host, { global: { plugins: [router], provide: { auth: { refreshRole } } } })
    await flushPromises()

    // Once on mount (the initial navigation) — then NOTHING on an idle timer.
    expect(refreshRole).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(300_000)
    expect(refreshRole).toHaveBeenCalledTimes(1)

    // A navigation to another admin route re-validates again.
    await router.push('/admin/test?x=1')
    await flushPromises()
    expect(refreshRole).toHaveBeenCalledTimes(2)
  })

  it('registers no idle timer or tab-refocus re-check — a downgrade is caught by the server per request, not a poll', async () => {
    vi.useFakeTimers()
    useUserRole().initialize('ssi_admin', null)
    const router = buildRouter()
    router.push('/admin/test')
    await router.isReady()

    const refreshRole = vi.fn().mockResolvedValue(undefined)
    mount(Host, { global: { plugins: [router], provide: { auth: { refreshRole } } } })
    await flushPromises()
    refreshRole.mockClear()

    // No interval fires…
    await vi.advanceTimersByTimeAsync(600_000)
    // …and a tab refocus does nothing either (the visibilitychange listener is gone).
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
    await flushPromises()

    expect(refreshRole).not.toHaveBeenCalled()
  })

  // Guest hand-off (owner, 2026-08-19: admin deep links "redirecting" on his
  // phone). A browser with no session that opens an /admin link used to land
  // silently in the player — indistinguishable from a dead link. It now goes
  // to the surface carrying the inline sign-in, with the destination in `next`
  // for SchoolsContainer to replay once the role resolves.
  describe('denied destination', () => {
    it('sends a GUEST to the sign-in surface, carrying the deep link in next', () => {
      expect(deniedDestination('guest', '/admin/stats?board=vad')).toEqual({
        path: '/schools',
        query: { next: '/admin/stats?board=vad' },
      })
    })

    it('sends a signed-in non-admin to the player — they are a learner, not a locked-out operator', () => {
      expect(deniedDestination('authenticated', '/admin/stats?board=vad')).toBe('/')
    })

    it('treats an unresolved session as not-a-guest — never offers sign-in on a guess', () => {
      expect(deniedDestination('pending', '/admin/stats')).toBe('/')
    })
  })

  it('a guest opening an admin deep link lands on the sign-in surface, not the player', async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/admin/test', component: Host },
        { path: '/', component: { template: '<div class="home">home</div>' } },
        { path: '/schools', component: { template: '<div class="schools">schools</div>' } },
      ],
    })
    router.push('/admin/test?board=vad')
    await router.isReady()

    // A real session check that finished and found nobody signed in.
    useResolvedSession().resolve(false)
    mount(Host, { global: { plugins: [router] } })
    await flushPromises()

    expect(router.currentRoute.value.path).toBe('/schools')
    expect(router.currentRoute.value.query.next).toBe('/admin/test?board=vad')
  })
})
