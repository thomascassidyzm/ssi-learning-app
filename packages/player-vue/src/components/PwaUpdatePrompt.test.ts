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
  useRegisterSW: (opts: any) => {
    // Hand the component a registration with a waiting worker, exactly as the
    // real library does when a new build has installed and is waiting.
    opts?.onRegistered?.({ waiting, update: vi.fn() })
    return { needRefresh, offlineReady: ref(false), updateServiceWorker }
  },
}))

// The registration handed to onRegistered — the component keeps it so the
// Update tap can post SKIP_WAITING synchronously from `pagehide`.
const waiting = { postMessage: vi.fn() }

import PwaUpdatePrompt from './PwaUpdatePrompt.vue'
import { updateAvailable, userDismissed } from '@/composables/usePwaUpdate'
import { RELOAD_WEDGE_MS } from '@/utils/bootHeal'

// jsdom's location is read-only; swap in a stub that records reloads.
const reload = vi.fn()
Object.defineProperty(window, 'location', {
  configurable: true,
  value: { ...window.location, reload, href: window.location.href },
})

describe('PwaUpdatePrompt — banner only reflects a genuinely different live build', () => {
  // needRefresh/updateAvailable/userDismissed are shared across mounts (module-
  // scoped refs), so a leftover mounted instance from a prior test would keep
  // reacting to them and race the current test. Always unmount before the next.
  let activeWrapper: ReturnType<typeof mount> | null = null

  beforeEach(() => {
    needRefresh.value = false
    updateAvailable.value = false
    userDismissed.value = false
    reload.mockClear()
    waiting.postMessage.mockClear()
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

  it('clears the pending-update state and navigates when the update is applied', async () => {
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
    // The tap navigates in the user gesture; it does NOT hand the reload to
    // vite-plugin-pwa's async controllerchange listener.
    expect(reload).toHaveBeenCalledTimes(1)
  })

  // The crash this component exists to prevent: activating the new service
  // worker deletes, from the precache, every chunk whose content changed in
  // that build — so a document still running when that happens loses its own
  // code (e2e/sw-update-probe.mjs measures 10 of 21 entry chunks going 404),
  // and if it lands mid-navigation it kills the NetworkFirst fetch and serves
  // the OLD shell. The app therefore never activates a waiting worker: the
  // reload alone delivers the new build, and the worker takes over by itself
  // once no client is open.
  it('never activates the waiting worker from a live page', async () => {
    ;(fetch as any).mockResolvedValue({ ok: true, json: async () => ({ buildNumber: 'def5678' }) })
    activeWrapper = mount(PwaUpdatePrompt, { attachTo: document.body })
    needRefresh.value = true
    await flushAsync()

    ;(document.body.querySelector('.pwa-update-button') as HTMLElement).click()
    await flushAsync()
    window.dispatchEvent(new Event('pagehide'))

    expect(waiting.postMessage).not.toHaveBeenCalled()
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('offers a relaunch tap when the update navigation did not take', async () => {
    vi.useFakeTimers()
    try {
      ;(fetch as any).mockResolvedValue({ ok: true, json: async () => ({ buildNumber: 'def5678' }) })
      activeWrapper = mount(PwaUpdatePrompt, { attachTo: document.body })
      needRefresh.value = true
      await vi.advanceTimersByTimeAsync(1)

      ;(document.body.querySelector('.pwa-update-button') as HTMLElement).click()
      await vi.advanceTimersByTimeAsync(1)
      expect(document.body.querySelector('.pwa-update-banner')).toBeNull()

      // The document is still here RELOAD_WEDGE_MS later — wedged webview.
      await vi.advanceTimersByTimeAsync(RELOAD_WEDGE_MS)
      const banner = document.body.querySelector('.pwa-update-banner')
      expect(banner).not.toBeNull()
      expect(banner?.textContent).toContain('Tap to relaunch')

      ;(document.body.querySelector('.pwa-update-button') as HTMLElement).click()
      expect(reload).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })
})

// Lets the pending fetchLatestBuildNumber() chain AND Vue's own watcher/render
// scheduling (both microtask-queued) fully settle. A macrotask tick guarantees
// every queued microtask has drained, however many hops deep the chain is.
async function flushAsync() {
  await new Promise((resolve) => setTimeout(resolve, 0))
}
