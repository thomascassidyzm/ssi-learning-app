import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { defineComponent } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import { useUserRole } from '@/composables/useUserRole'
import { useResolvedSession } from '@/composables/useResolvedSession'
import { useAdminGate } from '@/composables/useAdminGate'

// useAdminGate generalises AdminContainer's original access gate to every
// admin surface AND adds the piece that was missing everywhere (Trinity
// audit finding #2, docs/trinity/admin.md): useUserRole's role refs are set
// once at sign-in and never re-polled, so a de-platformed ssi_admin kept
// full admin UI until reload. This proves both halves: the reactive
// deny-and-bounce on a role change, and the periodic/tab-refocus trigger
// that discovers that change live via the injected auth's refreshRole().

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

  it('periodically calls the injected auth.refreshRole() while mounted, so a downgrade is discovered without any user action', async () => {
    vi.useFakeTimers()
    useUserRole().initialize('ssi_admin', null)
    const router = buildRouter()
    router.push('/admin/test')
    await router.isReady()

    const refreshRole = vi.fn().mockResolvedValue(undefined)
    mount(Host, { global: { plugins: [router], provide: { auth: { refreshRole } } } })
    await flushPromises()

    expect(refreshRole).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(refreshRole).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(refreshRole).toHaveBeenCalledTimes(2)
  })

  it('re-validates immediately on tab refocus (visibilitychange), not just the interval', async () => {
    useUserRole().initialize('ssi_admin', null)
    const router = buildRouter()
    router.push('/admin/test')
    await router.isReady()

    const refreshRole = vi.fn().mockResolvedValue(undefined)
    mount(Host, { global: { plugins: [router], provide: { auth: { refreshRole } } } })
    await flushPromises()

    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
    await flushPromises()

    expect(refreshRole).toHaveBeenCalledTimes(1)
  })

  it('stops the revalidation interval on unmount — no leaked timer', async () => {
    vi.useFakeTimers()
    useUserRole().initialize('ssi_admin', null)
    const router = buildRouter()
    router.push('/admin/test')
    await router.isReady()

    const refreshRole = vi.fn().mockResolvedValue(undefined)
    const wrapper = mount(Host, { global: { plugins: [router], provide: { auth: { refreshRole } } } })
    await flushPromises()
    wrapper.unmount()

    await vi.advanceTimersByTimeAsync(120_000)
    expect(refreshRole).not.toHaveBeenCalled()
  })
})
