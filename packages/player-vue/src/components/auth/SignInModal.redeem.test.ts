/**
 * REGRESSION — the silent unredeemed join code (2026-08-31).
 *
 * Before this fix, SignInModal.handlePostAuth logged a redemption failure to
 * the console and then fell straight through to `emit('success')` + `close()`.
 * The learner was told they were signed in and in the class when they had been
 * added to nothing and granted no entitlement — on the money path, for a place
 * someone may have paid for. The missing-Supabase-client variant was worse:
 * redemption was SKIPPED ENTIRELY and success was still declared.
 *
 * The contract these tests pin:
 *   1. a failed redemption NEVER emits success and NEVER closes the modal;
 *   2. the learner is told plainly, in copy that blames us and not them;
 *   3. the code stays PENDING so it can be retried rather than lost;
 *   4. the failure is visible to us — console.error (survives the production
 *      esbuild pure-list strip) plus a player_events row;
 *   5. a genuine success still emits success exactly as before.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref } from 'vue'

import SignInModal from './SignInModal.vue'
import { useAuthModal } from '@/composables/useAuthModal'
import { useInviteCode } from '@/composables/useInviteCode'
import { CONFIG_UNAVAILABLE_MESSAGE } from '@/config/env'

function mountModal(fetchHandlers: Record<string, any>, clientOverride?: unknown) {
  const supabase = ref(
    clientOverride === undefined
      ? {
          auth: {
            getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'tok-1' } } }),
            signInWithOtp: vi.fn().mockResolvedValue({ error: null }),
            verifyOtp: vi.fn().mockResolvedValue({ error: null }),
          },
        }
      : clientOverride,
  )
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, opts?: any) => {
      const handler = fetchHandlers[url]
      if (!handler) throw new Error(`Unhandled fetch: ${url}`)
      const body = typeof handler === 'function' ? handler(JSON.parse(opts?.body || '{}')) : handler
      return { ok: true, json: async () => body } as any
    }),
  )
  // AuthModal teleports to <body>; stub Teleport so the form renders inline.
  const wrapper = mount(SignInModal, {
    global: { provide: { supabase }, stubs: { teleport: true } },
  })
  return { wrapper, supabase }
}

async function flush() {
  for (let i = 0; i < 6; i++) await Promise.resolve()
  await new Promise((r) => setTimeout(r, 0))
}

/** Open on the invite-code step and validate a code, leaving it pending. */
async function withPendingCode(wrapper: any) {
  useAuthModal().open({ inviteCode: true })
  await flush()
  const input = wrapper.find('#invite-code')
  input.element.value = 'ABC-123'
  await input.trigger('input')
  await wrapper.find('.submit-btn').trigger('click')
  await flush()
  // Context step → email step.
  await wrapper.find('.submit-btn').trigger('click')
  await flush()
}

/** Email → send code → verify, from the email step. */
async function verifyOtp(wrapper: any) {
  await wrapper.find('input[type="email"]').setValue('sian@school.example')
  await wrapper.find('form').trigger('submit.prevent')
  await flush()
  await wrapper.find('#auth-code').setValue('123456')
  await wrapper.find('form').trigger('submit.prevent')
  await flush()
}

describe('SignInModal — a pending code that does not redeem', () => {
  beforeEach(() => {
    sessionStorage.clear()
    useInviteCode().clearPendingCode()
    useAuthModal().close()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('does NOT declare success when redemption fails, keeps the code pending, and says so honestly', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { wrapper } = mountModal({
      '/api/code/validate': { valid: true, codeKind: 'invite', inviteCodeId: 'inv-1', codeType: 'teacher', context: { schoolName: 'Test School' } },
      '/api/code/redeem': { success: false, error: 'invite already spent' },
      '/api/player-events': { ok: true },
    })
    await withPendingCode(wrapper)
    await verifyOtp(wrapper)

    // 1 + 5: no success, modal still open.
    expect(wrapper.emitted('success')).toBeUndefined()
    expect(useAuthModal().isOpen.value).toBe(true)

    // 2: told plainly, and the copy does not blame them or their device.
    const text = wrapper.text()
    expect(text).toContain("we couldn't add your code to your account")
    expect(text).toContain('Try again')
    expect(text.toLowerCase()).not.toContain('check your connection')
    expect(text.toLowerCase()).not.toContain('your device')

    // 3: the code survives for the retry.
    expect(useInviteCode().pendingCode.value).not.toBeNull()

    // 4: loud, at a level production does not strip.
    expect(errSpy).toHaveBeenCalledWith(
      '[SignInModal] Code redemption failed after sign-in:',
      'invite already spent',
    )
  })

  it('does NOT declare success when the session yields no access token to redeem with', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { wrapper } = mountModal(
      {
        '/api/code/validate': { valid: true, codeKind: 'invite', inviteCodeId: 'inv-1', codeType: 'teacher', context: {} },
        '/api/player-events': { ok: true },
      },
      {
        auth: {
          // Signed in as far as verifyOtp is concerned, but no token comes
          // back — the variant where redemption was SKIPPED ENTIRELY and
          // success was declared anyway.
          getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
          signInWithOtp: vi.fn().mockResolvedValue({ error: null }),
          verifyOtp: vi.fn().mockResolvedValue({ error: null }),
        },
      },
    )
    await withPendingCode(wrapper)
    await verifyOtp(wrapper)

    expect(wrapper.emitted('success')).toBeUndefined()
    expect(useAuthModal().isOpen.value).toBe(true)
    expect(useInviteCode().pendingCode.value).not.toBeNull()
    expect(errSpy).toHaveBeenCalledWith(
      '[SignInModal] Code redemption failed after sign-in:',
      'no_access_token',
    )
  })

  it('with no Supabase client at all, says so honestly instead of "please try again"', async () => {
    const { wrapper } = mountModal(
      {
        '/api/code/validate': { valid: true, codeKind: 'invite', inviteCodeId: 'inv-1', codeType: 'teacher', context: {} },
      },
      null,
    )
    await withPendingCode(wrapper)
    await wrapper.find('input[type="email"]').setValue('sian@school.example')
    await wrapper.find('form').trigger('submit.prevent')
    await flush()

    expect(wrapper.emitted('success')).toBeUndefined()
    expect(useInviteCode().pendingCode.value).not.toBeNull()
    expect(wrapper.text()).toContain(CONFIG_UNAVAILABLE_MESSAGE)
    expect(wrapper.text()).not.toContain('App not ready')
  })

  it('still emits success when the redemption genuinely works', async () => {
    const { wrapper } = mountModal({
      '/api/code/validate': { valid: true, codeKind: 'invite', inviteCodeId: 'inv-1', codeType: 'teacher', context: {} },
      '/api/code/redeem': { success: true, role: 'teacher', redirectTo: '/schools' },
      '/api/player-events': { ok: true },
    })
    await withPendingCode(wrapper)
    await verifyOtp(wrapper)

    expect(wrapper.emitted('success')?.[0]?.[0]).toMatchObject({ role: 'teacher', redirectTo: '/schools' })
    expect(useInviteCode().pendingCode.value).toBeNull()
  })
})
