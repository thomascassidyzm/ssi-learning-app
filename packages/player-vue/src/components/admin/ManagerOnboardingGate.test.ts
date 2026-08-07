/**
 * The two guided walk-throughs (2026-08-06, Tom's 22:38Z taste call).
 *
 * These steps must read as the app teaching, not as a form and a prompt: a
 * purpose sentence FIRST, then under five paced steps to done, in the
 * walkthrough engine's own card genre. What is worth pinning is that shape —
 * the purpose beat comes before the doing, the walk is paced with Back/Next
 * and step dots, the password walk has no escape and the install walk always
 * does, and nothing is written to the account before the manager acts.
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

/** The card's primary verb — the paced Next / Save it / Install. */
function primary(wrapper: any) {
  return wrapper.find('.walk-btn-primary')
}
function backBtn(wrapper: any) {
  return wrapper.findAll('.walk-btn').find((b: any) => b.text() === 'Back')
}
async function tapPrimary(wrapper: any) {
  await primary(wrapper).trigger('click')
  await flushPromises()
}

async function fillPassword(wrapper: any, pw: string, confirm: string) {
  const inputs = wrapper.findAll('input[type="password"]')
  await inputs[0].setValue(pw)
  await inputs[1].setValue(confirm)
}

beforeEach(() => {
  push.mockClear()
  localStorage.clear()
  setUa(DESKTOP_CHROME)
  window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as any
})

describe('the password walk — purpose first, then the doing', () => {
  it('opens on the PURPOSE beat, with no form in sight yet', () => {
    const { wrapper } = mountGate()
    expect(wrapper.text()).toContain('link in an email')
    // The reason comes before the work — this is a walk, not a bare form.
    expect(wrapper.find('input[type="password"]').exists()).toBe(false)
    expect(primary(wrapper).text()).toBe('Next')
  })

  it('is paced with step dots, and under five steps to done', () => {
    const { wrapper } = mountGate()
    const dots = wrapper.findAll('.walk-dot')
    expect(dots.length).toBeGreaterThan(1)
    expect(dots.length).toBeLessThan(5)
  })

  it('reaches the form on the second beat', async () => {
    const { wrapper } = mountGate()
    await tapPrimary(wrapper)
    expect(wrapper.findAll('input[type="password"]')).toHaveLength(2)
    expect(primary(wrapper).text()).toBe('Save it')
  })

  it('lets the manager step BACK to the reason', async () => {
    const { wrapper } = mountGate()
    await tapPrimary(wrapper)
    expect(backBtn(wrapper)).toBeTruthy()
    await backBtn(wrapper)!.trigger('click')
    expect(wrapper.text()).toContain('link in an email')
  })

  it('has NO skip anywhere in the password walk — that is the point of it', async () => {
    const { wrapper } = mountGate()
    expect(wrapper.find('.walk-close').exists()).toBe(false)
    await tapPrimary(wrapper)
    expect(wrapper.find('.walk-close').exists()).toBe(false)
    const labels = wrapper.findAll('button').map((b: any) => b.text().toLowerCase())
    expect(labels.some((t: string) => t.includes('not now') || t.includes('skip'))).toBe(false)
  })

  it('rejects a short password without touching the account', async () => {
    const { wrapper, updatePassword } = mountGate()
    await tapPrimary(wrapper)
    await fillPassword(wrapper, 'abc', 'abc')
    await tapPrimary(wrapper)
    expect(wrapper.text()).toContain('at least 6 characters')
    expect(updatePassword).not.toHaveBeenCalled()
  })

  it('rejects a mismatch without touching the account', async () => {
    const { wrapper, updatePassword } = mountGate()
    await tapPrimary(wrapper)
    await fillPassword(wrapper, 'longenough', 'longenoughX')
    await tapPrimary(wrapper)
    expect(wrapper.text()).toContain('Passwords do not match')
    expect(updatePassword).not.toHaveBeenCalled()
  })

  it('surfaces the SERVER\'s own words when it refuses', async () => {
    const updatePassword = vi.fn(async () => ({ error: 'Password should be at least 10 characters' }))
    const { wrapper } = mountGate({ updatePassword })
    await tapPrimary(wrapper)
    await fillPassword(wrapper, 'sixchr', 'sixchr')
    await tapPrimary(wrapper)
    expect(wrapper.text()).toContain('at least 10 characters')
    expect(wrapper.emitted('passworded')).toBeFalsy()
  })

  it('saves, tells the caller to resume the verb, and lands on a done beat', async () => {
    const { wrapper, updatePassword } = mountGate()
    await tapPrimary(wrapper)
    await fillPassword(wrapper, 'goodpassword', 'goodpassword')
    await tapPrimary(wrapper)
    expect(updatePassword).toHaveBeenCalledWith('goodpassword')
    expect(wrapper.emitted('passworded')).toHaveLength(1)
    expect(wrapper.text()).toContain('that is your way back in')
  })
})

describe('the install walk — a prompt, never a gate', () => {
  async function reachInstall(wrapper: any) {
    await tapPrimary(wrapper)
    await fillPassword(wrapper, 'goodpassword', 'goodpassword')
    await tapPrimary(wrapper) // save
    await tapPrimary(wrapper) // leave the done beat → install walk
  }

  it('opens on its own PURPOSE beat, not on a naked button', async () => {
    const { wrapper } = mountGate()
    await reachInstall(wrapper)
    expect(wrapper.text()).toContain('its own window')
    expect(primary(wrapper).text()).toBe('Next')
  })

  it('is context-aware: Chrome app on desktop', async () => {
    const { wrapper } = mountGate()
    await reachInstall(wrapper)
    expect(wrapper.text()).toContain('Chrome app')
    expect(wrapper.text()).not.toContain('home screen')
  })

  it('is context-aware: home screen on a phone', async () => {
    setUa(IPHONE_SAFARI)
    const { wrapper } = mountGate()
    await reachInstall(wrapper)
    expect(wrapper.text()).toContain('home screen')
    expect(wrapper.text()).not.toContain('Chrome app')
  })

  it('always offers a way out, and remembers it per user', async () => {
    const { wrapper } = mountGate()
    await reachInstall(wrapper)
    // Escapable from the very first install beat — the × is back.
    expect(wrapper.find('.walk-close').exists()).toBe(true)
    await tapPrimary(wrapper) // onto the doing beat
    const notNow = wrapper.findAll('button').find((b: any) => b.text() === 'Not now')
    expect(notNow).toBeTruthy()
    await notNow!.trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
    expect(localStorage.getItem('ssi-org-install-dismissed:u-1')).toBeTruthy()
  })

  it('skips the install walk entirely when already running as an app', async () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as any
    const { wrapper } = mountGate()
    await reachInstall(wrapper)
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('does not nag: dismissed once, never offered again', async () => {
    localStorage.setItem('ssi-org-install-dismissed:u-1', '123')
    const { wrapper } = mountGate()
    await reachInstall(wrapper)
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('sends the manager BACK to their organisation from the full guide', async () => {
    const { wrapper } = mountGate()
    await reachInstall(wrapper)
    await tapPrimary(wrapper) // purpose → doing
    await tapPrimary(wrapper) // "Show me how" — no native prompt captured
    expect(push).toHaveBeenCalledWith({ path: '/install', query: { return: '/org/org-1' } })
  })

  it('uses the native prompt when the browser has offered one', async () => {
    const prompt = vi.fn()
    const { wrapper } = mountGate({
      installPrompt: { prompt, userChoiceResult: Promise.resolve({ outcome: 'accepted' }) },
    })
    await reachInstall(wrapper)
    await tapPrimary(wrapper) // purpose → doing
    expect(primary(wrapper).text()).toContain('Chrome app')
    await tapPrimary(wrapper)
    expect(prompt).toHaveBeenCalled()
    expect(wrapper.emitted('close')).toHaveLength(1)
  })
})
