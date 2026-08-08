import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref } from 'vue'

// __BUILD_NUMBER__ is a Vite `define` global — stub it for the running app's build id.
;(globalThis as any).__BUILD_NUMBER__ = 'abc1234'

// vite-plugin-pwa's virtual module — not resolvable outside a real Vite/PWA
// build, so it must be mocked. `needRefresh` is exposed on the mock so tests
// can flip it to simulate a waiting service worker.
const needRefresh = ref(false)
const updateServiceWorker = vi.fn().mockResolvedValue(undefined)
vi.mock('virtual:pwa-register/vue', () => ({
  useRegisterSW: (_opts: any) => ({
    needRefresh,
    offlineReady: ref(false),
    updateServiceWorker,
  }),
}))

import PwaUpdatePrompt from './PwaUpdatePrompt.vue'
import { updateAvailable, userDismissed } from '@/composables/usePwaUpdate'

describe('PwaUpdatePrompt — banner only reflects a genuinely different live build', () => {
  // needRefresh/updateAvailable/userDismissed are shared across mounts (module-
  // scoped refs), so a leftover mounted instance from a prior test would keep
  // reacting to them and race the current test. Always unmount before the next.
  let activeWrapper: ReturnType<typeof mount> | null = null

  beforeEach(() => {
    needRefresh.value = false
    updateAvailable.value = false
    userDismissed.value = false
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    activeWrapper?.unmount()
    activeWrapper = null
    vi.unstubAllGlobals()
  })

  it('does not show the banner when /version.json matches the running build', async () => {
    ;(fetch as any).mockResolvedValue({ ok: true, json: async () => ({ buildNumber: 'abc1234' }) })
    activeWrapper = mount(PwaUpdatePrompt, { attachTo: document.body })

    needRefresh.value = true
    await flushAsync()

    expect(document.body.querySelector('.pwa-update-banner')).toBeNull()
    expect(updateAvailable.value).toBe(false)
  })

  it('shows the banner when /version.json names a different build', async () => {
    ;(fetch as any).mockResolvedValue({ ok: true, json: async () => ({ buildNumber: 'def5678' }) })
    activeWrapper = mount(PwaUpdatePrompt, { attachTo: document.body })

    needRefresh.value = true
    await flushAsync()

    expect(document.body.querySelector('.pwa-update-banner')).not.toBeNull()
    expect(updateAvailable.value).toBe(true)
  })

  it('clears the pending-update state once the update is applied', async () => {
    ;(fetch as any).mockResolvedValue({ ok: true, json: async () => ({ buildNumber: 'def5678' }) })
    activeWrapper = mount(PwaUpdatePrompt, { attachTo: document.body })

    needRefresh.value = true
    await flushAsync()
    expect(document.body.querySelector('.pwa-update-banner')).not.toBeNull()

    const updateButton = document.body.querySelector('.pwa-update-button') as HTMLElement
    updateButton.click()
    await flushAsync()

    expect(updateAvailable.value).toBe(false)
    expect(document.body.querySelector('.pwa-update-banner')).toBeNull()
    expect(updateServiceWorker).toHaveBeenCalledWith(true)
  })
})

// Lets the pending fetchLatestBuildNumber() chain AND Vue's own watcher/render
// scheduling (both microtask-queued) fully settle. A macrotask tick guarantees
// every queued microtask has drained, however many hops deep the chain is.
async function flushAsync() {
  await new Promise((resolve) => setTimeout(resolve, 0))
}
