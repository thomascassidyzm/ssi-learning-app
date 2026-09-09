/**
 * THE SIGN-IN SCREEN REMEMBERS THE LAST ADDRESS USED ON THIS DEVICE.
 *
 * Tom, 2026-09-09: "Most of the time we have support issues with people who
 * cannot remember which email they signed up with." An empty box asks the one
 * question this app cannot help with. The device already knows the answer.
 *
 * The contract pinned here:
 *   1. an empty box until a sign-in has happened on this device;
 *   2. afterwards the address is offered, already filled in;
 *   3. sending a code remembers the address — and only the address;
 *   4. "Use a different address" empties the box and forgets it, so a shared
 *      phone or a second account never has to fight the field.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref } from 'vue'

import SignInModal from './SignInModal.vue'
import { useAuthModal } from '@/composables/useAuthModal'
import { rememberSignInEmail, readLastSignInEmail } from '@/auth/lastSignInEmail'

function mountModal() {
  const signInWithOtp = vi.fn().mockResolvedValue({ error: null })
  const supabase = ref({ auth: { signInWithOtp, getSession: vi.fn() } })
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
  const wrapper = mount(SignInModal, {
    global: { provide: { supabase }, stubs: { teleport: true } },
  })
  return { wrapper, signInWithOtp }
}

async function flush() {
  for (let i = 0; i < 6; i++) await Promise.resolve()
  await new Promise((r) => setTimeout(r, 0))
}

describe('SignInModal — the address this device last used', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => {
    useAuthModal().close()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('offers an empty box before any sign-in on this device', async () => {
    const { wrapper } = mountModal()
    useAuthModal().open()
    await flush()
    expect((wrapper.find('#auth-email').element as HTMLInputElement).value).toBe('')
    expect(wrapper.find('.remembered-email').exists()).toBe(false)
  })

  it('offers the remembered address, already filled in', async () => {
    rememberSignInEmail('gwen@example.com')
    const { wrapper } = mountModal()
    useAuthModal().open()
    await flush()
    expect((wrapper.find('#auth-email').element as HTMLInputElement).value).toBe(
      'gwen@example.com',
    )
    expect(wrapper.find('.remembered-email').text()).toContain('last used')
  })

  it('remembers the address once a code has been sent to it', async () => {
    const { wrapper, signInWithOtp } = mountModal()
    useAuthModal().open()
    await flush()
    const input = wrapper.find('#auth-email')
    ;(input.element as HTMLInputElement).value = 'gwen@example.com'
    await input.trigger('input')
    await wrapper.find('form.auth-form').trigger('submit')
    await flush()
    expect(signInWithOtp).toHaveBeenCalled()
    expect(readLastSignInEmail()).toBe('gwen@example.com')
  })

  it('lets a second person on the same phone type their own address', async () => {
    rememberSignInEmail('gwen@example.com')
    const { wrapper } = mountModal()
    useAuthModal().open()
    await flush()
    await wrapper.find('.remembered-email button').trigger('click')
    await flush()
    expect((wrapper.find('#auth-email').element as HTMLInputElement).value).toBe('')
    expect(wrapper.find('.remembered-email').exists()).toBe(false)
    expect(readLastSignInEmail()).toBeNull()
  })
})
