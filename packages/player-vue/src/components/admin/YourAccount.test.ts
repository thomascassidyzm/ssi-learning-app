/**
 * YourAccount — the permanent account area on an org leader's node page
 * (founder ruling 2026-08-06: the password and the install must be reachable
 * AT ANY TIME, not only during the one-time first-login gate).
 *
 * What is worth pinning here is what makes this surface DURABLE where the
 * gate was not: the three walk anchors exist in every state (including
 * "already installed", where there is no button to point at), so the two pack
 * walks registered against them can never find nothing; the password logic is
 * the gate's own validator, not a second copy; and the install wording is the
 * gate's own context-aware framing, not a second copy.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ref } from 'vue'

const push = vi.fn()
vi.mock('vue-router', () => ({
  useRouter: () => ({ push, currentRoute: { value: { fullPath: '/org/org-1' } } }),
}))

import YourAccount from './YourAccount.vue'

const DESKTOP_CHROME =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'

function setUa(ua: string) {
  Object.defineProperty(navigator, 'userAgent', { value: ua, configurable: true })
}

function setStandalone(on: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    value: () => ({ matches: on, addEventListener() {}, removeEventListener() {} }),
    configurable: true,
  })
}

function mountAccount(opts: {
  metadata?: Record<string, unknown>
  email?: string
  updatePassword?: any
  installPrompt?: any
} = {}) {
  const updatePassword = opts.updatePassword ?? vi.fn(async () => ({}))
  const auth = {
    user: ref({
      id: 'u-1',
      email: opts.email ?? 'deborah@example.org',
      user_metadata: opts.metadata ?? {},
    }),
    updatePassword,
  }
  const wrapper = mount(YourAccount, {
    global: { provide: { auth, installPrompt: ref(opts.installPrompt ?? null) } },
  })
  return { wrapper, updatePassword }
}

beforeEach(() => {
  push.mockClear()
  setUa(DESKTOP_CHROME)
  setStandalone(false)
})

describe('YourAccount — the walk anchors', () => {
  it('carries all three anchors the two pack walks point at', () => {
    const { wrapper } = mountAccount()
    for (const id of ['account-card', 'account-password', 'account-install']) {
      expect(wrapper.find(`[data-walk="${id}"]`).exists()).toBe(true)
    }
  })

  it('keeps the install anchor when there is nothing left to install', () => {
    setStandalone(true)
    const { wrapper } = mountAccount()
    // No button — but the row, and therefore the anchor, is still there.
    expect(wrapper.find('[data-walk="account-install"]').exists()).toBe(true)
    expect(wrapper.find('[data-walk="account-install"] button').exists()).toBe(false)
    expect(wrapper.text()).toContain('The app is installed')
  })
})

describe('YourAccount — password', () => {
  it('offers to SET a password when the account has none, and CHANGE it when it has', () => {
    expect(mountAccount().wrapper.text()).toContain('Set a password')
    expect(mountAccount({ metadata: { has_password: true } }).wrapper.text()).toContain('Change it')
  })

  it('opens the form on tap and does not write anything before then', async () => {
    const { wrapper, updatePassword } = mountAccount()
    expect(wrapper.find('#account-password-new').exists()).toBe(false)
    await wrapper.find('[data-walk="account-password"] button').trigger('click')
    expect(wrapper.find('#account-password-new').exists()).toBe(true)
    expect(updatePassword).not.toHaveBeenCalled()
  })

  it('refuses a mismatch with the gate\'s own message, and never calls the API', async () => {
    const { wrapper, updatePassword } = mountAccount()
    await wrapper.find('[data-walk="account-password"] button').trigger('click')
    await wrapper.find('#account-password-new').setValue('longenough')
    await wrapper.find('#account-password-confirm').setValue('different')
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(wrapper.text()).toContain('Passwords do not match')
    expect(updatePassword).not.toHaveBeenCalled()
  })

  it('saves, closes the form and confirms', async () => {
    const { wrapper, updatePassword } = mountAccount()
    await wrapper.find('[data-walk="account-password"] button').trigger('click')
    await wrapper.find('#account-password-new').setValue('longenough')
    await wrapper.find('#account-password-confirm').setValue('longenough')
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(updatePassword).toHaveBeenCalledWith('longenough')
    expect(wrapper.find('#account-password-new').exists()).toBe(false)
    expect(wrapper.text()).toContain('Password saved.')
  })

  it('surfaces the server\'s own words when it rejects the password', async () => {
    const { wrapper } = mountAccount({
      updatePassword: vi.fn(async () => ({ error: 'Password should be at least 8 characters' })),
    })
    await wrapper.find('[data-walk="account-password"] button').trigger('click')
    await wrapper.find('#account-password-new').setValue('longenough')
    await wrapper.find('#account-password-confirm').setValue('longenough')
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(wrapper.text()).toContain('Password should be at least 8 characters')
  })
})

describe('YourAccount — install', () => {
  it('says APP on a desktop and HOME SCREEN on a phone', () => {
    expect(mountAccount().wrapper.text()).toContain('Chrome app')
    setUa(IPHONE_SAFARI)
    expect(mountAccount().wrapper.text()).toContain('home screen')
  })

  it('uses the browser\'s own prompt when there is one', async () => {
    const prompt = { prompt: vi.fn(), userChoiceResult: Promise.resolve({ outcome: 'accepted' }) }
    const { wrapper } = mountAccount({ installPrompt: prompt })
    await wrapper.find('[data-walk="account-install"] button').trigger('click')
    await flushPromises()
    expect(prompt.prompt).toHaveBeenCalled()
    expect(push).not.toHaveBeenCalled()
  })

  it('falls back to the full walkthrough when the browser offers no prompt', async () => {
    const { wrapper } = mountAccount()
    await wrapper.find('[data-walk="account-install"] button').trigger('click')
    await flushPromises()
    expect(push).toHaveBeenCalledWith({ path: '/install', query: { return: '/org/org-1' } })
  })
})

describe('YourAccount — identity', () => {
  it('shows a real email address', () => {
    expect(mountAccount().wrapper.text()).toContain('deborah@example.org')
  })

  it('never shows a link-auth placeholder as if it were an inbox', () => {
    const { wrapper } = mountAccount({ email: 'link-abc123@invite.saysomethingin.app' })
    expect(wrapper.text()).not.toContain('invite.saysomethingin.app')
  })
})
