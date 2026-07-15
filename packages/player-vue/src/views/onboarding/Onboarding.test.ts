import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref } from 'vue'

// useRoute is only used to detect the heritage door by route name — stub the
// plain 'onboard-school-2' door so the language dropdown (not the heritage
// course-level picker) renders, keeping the fixture minimal.
vi.mock('vue-router', () => ({
  useRoute: () => ({ name: 'onboard-school-2' }),
}))

import Onboarding from './Onboarding.vue'

const LIVE_COURSES = [
  {
    course_code: 'fra_for_eng',
    target_lang: 'fra',
    known_lang: 'eng',
    pricing_tier: 'premium',
    new_app_status: 'live',
    display_name: 'French for English Speakers',
    learner_display_name: null,
  },
]

describe('Onboarding.vue — session awareness (audit #8)', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => LIVE_COURSES })
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function mountOnboarding(auth: any) {
    const supabase = ref({
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'tok' } } }),
        signOut: vi.fn().mockResolvedValue({}),
        signInWithOtp: vi.fn(),
        verifyOtp: vi.fn(),
      },
    })
    return mount(Onboarding, {
      props: { track: 'school' },
      global: {
        provide: { supabase, auth },
        stubs: {
          AtmosphereBackdrop: true,
          FrostCard: { template: '<div><slot /></div>' },
          Button: {
            props: ['disabled', 'loading'],
            emits: ['click'],
            template: '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
          },
        },
      },
    })
  }

  it('a fresh (signed-out) visitor still sees the email capture step, no greeting', async () => {
    const auth = { isAuthenticated: ref(false), user: ref(null) }
    const wrapper = mountOnboarding(auth)
    await flushAsync()

    expect(wrapper.find('#ob-email').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('Continuing as')
  })

  it('an already-authenticated visitor skips email/OTP and sees a "Continuing as" greeting', async () => {
    const auth = {
      isAuthenticated: ref(true),
      user: ref({ email: 'admin@example.com' } as any),
    }
    const wrapper = mountOnboarding(auth)
    await flushAsync()

    expect(wrapper.find('#ob-email').exists()).toBe(false)
    expect(wrapper.text()).toContain('Continuing as')
    expect(wrapper.text()).toContain('admin@example.com')
    expect(wrapper.text()).toContain('Not you? Sign out')
    // Never a second OTP step for an already-authenticated user.
    expect(wrapper.text()).not.toContain('Check your email')
  })

  it('"Not you? Sign out" signs out and drops back into the fresh-visitor email step', async () => {
    const isAuthenticated = ref(true)
    const auth = { isAuthenticated, user: ref({ email: 'admin@example.com' } as any) }
    const wrapper = mountOnboarding(auth)
    await flushAsync()

    await wrapper.find('button.ob-link').trigger('click')
    // Signing out flips the shared auth state; the component re-renders
    // against the new isAuthenticated value (same reactivity RedeemCode.vue
    // relies on for its own useDifferentEmail escape).
    isAuthenticated.value = false
    await flushAsync()

    expect(wrapper.find('#ob-email').exists()).toBe(true)
  })
})

async function flushAsync() {
  await Promise.resolve()
  await Promise.resolve()
  await new Promise((r) => setTimeout(r, 0))
}
