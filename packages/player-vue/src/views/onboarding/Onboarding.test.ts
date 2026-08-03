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

describe('Onboarding.vue — org door (track: org)', () => {
  function mountOrgOnboarding(auth: any, fetchMock: ReturnType<typeof vi.fn>) {
    vi.stubGlobal('fetch', fetchMock)
    const supabase = ref({
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'tok' } } }),
        signOut: vi.fn().mockResolvedValue({}),
        signInWithOtp: vi.fn().mockResolvedValue({ error: null }),
        verifyOtp: vi.fn().mockResolvedValue({ error: null }),
      },
    })
    return mount(Onboarding, {
      props: { track: 'org' },
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

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows the organisation-name field, never the language/course picker, and skips the catalogue fetch', async () => {
    const auth = { isAuthenticated: ref(false), user: ref(null) }
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => LIVE_COURSES })
    const wrapper = mountOrgOnboarding(auth, fetchMock)
    await flushAsync()

    expect(wrapper.find('#ob-org-name').exists()).toBe(true)
    expect(wrapper.find('.ob-langset').exists()).toBe(false)
    expect(wrapper.find('.ob-known-wrap').exists()).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('Send my code stays disabled until an org name is typed', async () => {
    const auth = { isAuthenticated: ref(false), user: ref(null) }
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => LIVE_COURSES })
    const wrapper = mountOrgOnboarding(auth, fetchMock)
    await flushAsync()

    const sendButton = wrapper.findAll('button').find((b) => b.text().includes('Send my code'))!
    expect(sendButton.attributes('disabled')).toBeDefined()

    await wrapper.find('#ob-org-name').setValue('Cardiff Council')
    await wrapper.find('#ob-email').setValue('leader@example.com')
    await flushAsync()

    expect(sendButton.attributes('disabled')).toBeUndefined()
  })

  it('provisioning sends org_name (not course_code) to /api/onboarding/provision', async () => {
    const auth = { isAuthenticated: ref(true), user: ref({ email: 'leader@example.com' } as any) }
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        role: 'govt_admin',
        platform_trial: { track: 'org', kind: 'trial', expires_at: '2026-09-01T00:00:00.000Z', days: 30 },
        existing: false,
        redirect: '/org/group-new',
      }),
    })
    const wrapper = mountOrgOnboarding(auth, fetchMock)
    await flushAsync()

    await wrapper.find('#ob-org-name').setValue('Cardiff Council')
    const continueButton = wrapper.findAll('button').find((b) => b.text() === 'Continue')!
    await continueButton.trigger('click')
    await flushAsync()

    const call = fetchMock.mock.calls.find(([url]: [string]) => url === '/api/onboarding/provision')
    expect(call).toBeTruthy()
    const body = JSON.parse(call![1].body)
    expect(body).toEqual({ track: 'org', org_name: 'Cardiff Council' })
    expect(wrapper.text()).toContain('Cardiff Council is ready')
  })
})

// The /orgs door signs up councils, companies and community groups whose
// learners are ADULTS — the Cardiff finding counts PUPILS, so it belongs to the
// school/tutor doors only (Tom, 2026-08-03). The org door leads with the
// adult-learner record and two verbatim learner quotes from
// www.saysomethingin.com instead.
describe('Onboarding.vue — proof panel is dressing-aware', () => {
  function mountTrack(track: 'org' | 'school' | 'tutor') {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => LIVE_COURSES }))
    const supabase = ref({
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
        signOut: vi.fn().mockResolvedValue({}),
        signInWithOtp: vi.fn().mockResolvedValue({ error: null }),
        verifyOtp: vi.fn().mockResolvedValue({ error: null }),
      },
    })
    return mount(Onboarding, {
      props: { track },
      global: {
        provide: { supabase, auth: { isAuthenticated: ref(false), user: ref(null) } },
        stubs: {
          AtmosphereBackdrop: true,
          FrostCard: { template: '<div><slot /></div>' },
          Button: { template: '<button><slot /></button>' },
        },
      },
    })
  }

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('org door: no pupils stat, adult proof plus real learner quotes', async () => {
    const wrapper = mountTrack('org')
    await flushAsync()

    const text = wrapper.text()
    expect(text).not.toContain('pupils')
    expect(text).not.toContain('Cardiff University')
    expect(text).toContain('Adult learners — since January 2009')
    expect(text).toContain('Tens of thousands')
    expect(wrapper.findAll('.ob-quote')).toHaveLength(2)
    expect(text).toContain('hold a conversation with them')
    expect(text).toContain('Jeremy, learning Welsh with his partner')
  })

  it('school door: keeps the Cardiff pupils stat and shows no quotes', async () => {
    const wrapper = mountTrack('school')
    await flushAsync()

    const text = wrapper.text()
    expect(text).toContain('Independently evaluated — Cardiff University')
    expect(text).toContain('pupils in the top 10%')
    expect(wrapper.findAll('.ob-quote')).toHaveLength(0)
  })
})
