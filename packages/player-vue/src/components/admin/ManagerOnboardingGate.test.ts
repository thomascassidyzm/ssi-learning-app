/**
 * The gate's two beats (2026-08-06).
 *
 * Beat 1 is a GATE — no skip, no close button, because a manager who arrived
 * by magic link has no other way back into their organisation. Beat 2 is a
 * PROMPT — always escapable, context-aware by device, and never shown twice.
 * Those two facts are the whole design; pin them.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ref } from 'vue'

const push = vi.fn()
vi.mock('vue-router', () => ({
  useRouter: () => ({ push, currentRoute: { value: { fullPath: '/org/org-1' } } }),
}))

import ManagerOnboardingGate from './ManagerOnboardingGate.vue'

const DESKTOP_CHROME =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'

function setUa(ua: string) {
  Object.defineProperty(navigator, 'userAgent', { value: ua, configurable: true })
}

function mountGate(opts: { updatePassword?: any; installPrompt?: any } = {}) {
  const updatePassword = opts.updatePassword ?? vi.fn(async () => ({}))
  const auth = { user: ref({ id: 'u-1', user_metadata: {} }), updatePassword }
  const wrapper = mount(ManagerOnboardingGate, {
    props: { isOpen: true },
    global: {
      provide: { auth, installPrompt: ref(opts.installPrompt ?? null) },
      stubs: { Teleport: true, Transition: false },
    },
  })
  return { wrapper, updatePassword }
}

async function fillAndSubmit(wrapper: any, pw: string, confirm: string) {
  const inputs = wrapper.findAll('input[type="password"]')
  await inputs[0].setValue(pw)
  await inputs[1].setValue(confirm)
  await wrapper.find('form').trigger('submit')
  await flushPromises()
}

beforeEach(() => {
  push.mockClear()
  localStorage.clear()
  setUa(DESKTOP_CHROME)
  window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as any
})

describe('ManagerOnboardingGate — beat 1, the password', () => {
  it('has NO skip and no close control — that is the point of it', () => {
    const { wrapper } = mountGate()
    const labels = wrapper.findAll('button').map((b: any) => b.text().toLowerCase())
    expect(labels.some((t: string) => t.includes('not now') || t.includes('skip'))).toBe(false)
  })

  it('says WHY in plain words — the link they arrived by', () => {
    const { wrapper } = mountGate()
    expect(wrapper.text()).toContain('came in by a link')
  })

  it('rejects a short password without calling the server', async () => {
    const { wrapper, updatePassword } = mountGate()
    await fillAndSubmit(wrapper, 'abc', 'abc')
    expect(wrapper.text()).toContain('at least 6 characters')
    expect(updatePassword).not.toHaveBeenCalled()
  })

  it('rejects a mismatch without calling the server', async () => {
    const { wrapper, updatePassword } = mountGate()
    await fillAndSubmit(wrapper, 'longenough', 'longenoughX')
    expect(wrapper.text()).toContain('Passwords do not match')
    expect(updatePassword).not.toHaveBeenCalled()
  })

  it('surfaces the SERVER\'s own words when it refuses', async () => {
    // Supabase may enforce a longer minimum than ours — never guess at it.
    const updatePassword = vi.fn(async () => ({ error: 'Password should be at least 10 characters' }))
    const { wrapper } = mountGate({ updatePassword })
    await fillAndSubmit(wrapper, 'sixchr', 'sixchr')
    expect(wrapper.text()).toContain('at least 10 characters')
    expect(wrapper.emitted('passworded')).toBeFalsy()
  })

  it('saves, tells the caller to resume the verb, and moves to the install beat', async () => {
    const { wrapper, updatePassword } = mountGate()
    await fillAndSubmit(wrapper, 'goodpassword', 'goodpassword')
    expect(updatePassword).toHaveBeenCalledWith('goodpassword')
    expect(wrapper.emitted('passworded')).toHaveLength(1)
    expect(wrapper.text()).toContain('Install it as a Chrome app')
  })
})

describe('ManagerOnboardingGate — beat 2, the install prompt', () => {
  it('is context-aware: Chrome app on desktop', async () => {
    const { wrapper } = mountGate()
    await fillAndSubmit(wrapper, 'goodpassword', 'goodpassword')
    expect(wrapper.text()).toContain('Chrome app')
    expect(wrapper.text()).not.toContain('home screen')
  })

  it('is context-aware: home screen on a phone', async () => {
    setUa(IPHONE_SAFARI)
    const { wrapper } = mountGate()
    await fillAndSubmit(wrapper, 'goodpassword', 'goodpassword')
    expect(wrapper.text()).toContain('home screen')
    expect(wrapper.text()).not.toContain('Chrome app')
  })

  it('always offers a way out, and remembers it per user', async () => {
    const { wrapper } = mountGate()
    await fillAndSubmit(wrapper, 'goodpassword', 'goodpassword')
    const notNow = wrapper.findAll('button').find((b: any) => b.text() === 'Not now')
    expect(notNow).toBeTruthy()
    await notNow!.trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
    expect(localStorage.getItem('ssi-org-install-dismissed:u-1')).toBeTruthy()
  })

  it('skips the beat entirely when already running as an installed app', async () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as any
    const { wrapper } = mountGate()
    await fillAndSubmit(wrapper, 'goodpassword', 'goodpassword')
    // Straight to close — nothing left to ask for.
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('does not nag: a manager who dismissed it once never sees it again', async () => {
    localStorage.setItem('ssi-org-install-dismissed:u-1', '123')
    const { wrapper } = mountGate()
    await fillAndSubmit(wrapper, 'goodpassword', 'goodpassword')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('sends the manager BACK to their organisation from the full guide', async () => {
    const { wrapper } = mountGate()
    await fillAndSubmit(wrapper, 'goodpassword', 'goodpassword')
    // No captured beforeinstallprompt → the walkthrough, carrying a return.
    await wrapper.findAll('button').find((b: any) => b.text() === 'Show me how')!.trigger('click')
    expect(push).toHaveBeenCalledWith({ path: '/install', query: { return: '/org/org-1' } })
  })

  it('uses the native prompt when the browser has offered one', async () => {
    const prompt = vi.fn()
    const { wrapper } = mountGate({
      installPrompt: { prompt, userChoiceResult: Promise.resolve({ outcome: 'accepted' }) },
    })
    await fillAndSubmit(wrapper, 'goodpassword', 'goodpassword')
    await wrapper.findAll('button').find((b: any) => b.text() === 'Install the Chrome app')!.trigger('click')
    await flushPromises()
    expect(prompt).toHaveBeenCalled()
    expect(wrapper.emitted('close')).toHaveLength(1)
  })
})
