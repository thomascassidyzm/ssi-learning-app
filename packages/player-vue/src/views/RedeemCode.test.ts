/**
 * RedeemCode.vue — possession-based onboarding (docs/schools/
 * email-deliverability-plan.md, Option A): a possession-eligible invite
 * (teacher/school_admin/school_admin_join/govt_admin/student) defaults to
 * the no-OTP-wait "details" screen; everything else keeps the OTP flow.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref } from 'vue'

vi.mock('vue-router', () => ({
  useRoute: () => ({ name: 'redeem-code', params: { code: 'TEACH-1' }, query: {} }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}))

import RedeemCode from './RedeemCode.vue'
import { useAuthModal } from '../composables/useAuthModal'

function mockFetchByUrl(handlers: Record<string, unknown>) {
  return vi.fn(async (url: string, opts?: any) => {
    const handler = handlers[url]
    if (!handler) throw new Error(`Unhandled fetch: ${url}`)
    const body = typeof handler === 'function' ? handler(JSON.parse(opts?.body || '{}')) : handler
    return { json: async () => body } as any
  })
}

function mountRedeemCode(fetchHandlers: Record<string, unknown>, authOverrides: any = {}, extraProvide: any = {}) {
  const supabase = ref({
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'sess-tok' } } }),
      setSession: vi.fn().mockResolvedValue({ error: null }),
      signOut: vi.fn().mockResolvedValue({}),
      signInWithOtp: vi.fn().mockResolvedValue({ error: null }),
      verifyOtp: vi.fn().mockResolvedValue({ error: null }),
    },
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    })),
  })
  const auth = {
    isAuthenticated: ref(false),
    user: ref(null),
    refreshRole: vi.fn().mockResolvedValue(undefined),
    ...authOverrides,
  }
  vi.stubGlobal('fetch', mockFetchByUrl(fetchHandlers))
  const wrapper = mount(RedeemCode, {
    global: { provide: { supabase, auth, ...extraProvide } },
  })
  return { wrapper, supabase, auth }
}

async function flushAsync() {
  await Promise.resolve()
  await Promise.resolve()
  await new Promise((r) => setTimeout(r, 0))
}

describe('RedeemCode.vue — possession-based onboarding', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('a teacher invite defaults to the no-email-wait details screen (no OTP sent)', async () => {
    const { wrapper, supabase } = mountRedeemCode({
      '/api/code/validate': { valid: true, codeKind: 'invite', inviteCodeId: 'inv-1', codeType: 'teacher', context: { schoolName: 'Test School' } },
    })
    await flushAsync()

    expect(wrapper.find('#redeem-details-email').exists()).toBe(true)
    expect(wrapper.find('#redeem-name').exists()).toBe(true)
    expect(supabase.value.auth.signInWithOtp).not.toHaveBeenCalled()
  })

  it('submitting details mints a session, calls setSession, and redeems the code', async () => {
    const { wrapper, supabase, auth } = mountRedeemCode({
      '/api/code/validate': { valid: true, codeKind: 'invite', inviteCodeId: 'inv-1', codeType: 'teacher', context: {} },
      '/api/auth/possession-redeem': (body: any) => {
        expect(body.code).toBe('TEACH-1')
        expect(body.email).toBe('teacher@school.example')
        return { success: true, session: { access_token: 'at-1', refresh_token: 'rt-1' } }
      },
      '/api/code/redeem': { success: true, role: 'teacher', redirectTo: '/schools', label: 'Teacher Invite' },
    })
    await flushAsync()

    await wrapper.find('#redeem-details-email').setValue('teacher@school.example')
    await wrapper.find('form').trigger('submit.prevent')
    await flushAsync()
    await flushAsync()

    expect(supabase.value.auth.setSession).toHaveBeenCalledWith({ access_token: 'at-1', refresh_token: 'rt-1' })
    expect(auth.refreshRole).toHaveBeenCalled()
    // pendingCode is cleared by useInviteCode.redeemCode() on success (same
    // for the OTP path), so the success screen falls back to its generic
    // copy rather than a role-specific heading — this is pre-existing
    // behaviour, not something the possession path changes.
    expect(wrapper.text()).toContain("You're all set!")
  })

  it('an already-registered email falls back to sign-in-instead, never minting a session', async () => {
    const { wrapper, supabase } = mountRedeemCode({
      '/api/code/validate': { valid: true, codeKind: 'invite', inviteCodeId: 'inv-1', codeType: 'teacher', context: {} },
      '/api/auth/possession-redeem': { success: false, reason: 'already_registered', error: 'An account already exists for this email. Please sign in instead.' },
    })
    await flushAsync()

    await wrapper.find('#redeem-details-email').setValue('existing@school.example')
    await wrapper.find('form').trigger('submit.prevent')
    await flushAsync()

    expect(supabase.value.auth.setSession).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('An account already exists')

    await wrapper.find('button.btn--primary').trigger('click')
    await flushAsync()
    expect(supabase.value.auth.signInWithOtp).toHaveBeenCalledWith({ email: 'existing@school.example' })
  })

  it('closes the global sign-in modal on mount (regression: App.vue boot-time pendingCode check can race ahead and open it, stranding it open over the post-redemption dashboard)', async () => {
    useAuthModal().open()
    expect(useAuthModal().isOpen.value).toBe(true)

    mountRedeemCode({
      '/api/code/validate': { valid: true, codeKind: 'invite', inviteCodeId: 'inv-1', codeType: 'teacher', context: {} },
    })
    await flushAsync()

    expect(useAuthModal().isOpen.value).toBe(false)
  })

  it('a non-possession-eligible code (tester) keeps the OTP-only flow', async () => {
    const { wrapper, supabase } = mountRedeemCode({
      '/api/code/validate': { valid: true, codeKind: 'invite', inviteCodeId: 'inv-2', codeType: 'tester', context: {} },
    })
    await flushAsync()

    expect(wrapper.find('#redeem-details-email').exists()).toBe(false)
    expect(wrapper.find('#redeem-email').exists()).toBe(true)
    expect(supabase.value.auth.signInWithOtp).not.toHaveBeenCalled()
  })
})

describe('RedeemCode.vue — class-course landing (2026-07-15 finding)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // Regression for: a student who joined a class via the invite link landed
  // in the catalogue default course instead of their class's — App.vue's
  // activeCourse is resolved ONCE at boot, before this page's redemption
  // completes, so a bare localStorage write (the old fix) was never re-read.
  // The fix routes through App.vue's own handleCourseSelect, the same
  // machinery CourseSelector uses for an explicit switch.
  it('a student class-invite redemption switches the app onto the class course via handleCourseSelect', async () => {
    const handleCourseSelect = vi.fn().mockResolvedValue(undefined)
    const enrolledCourses = ref([
      { course_code: 'zho_for_eng', display_name: 'Chinese' },
      { course_code: 'cym_for_eng', display_name: 'Welsh' },
    ])
    const { wrapper } = mountRedeemCode(
      {
        '/api/code/validate': { valid: true, codeKind: 'invite', inviteCodeId: 'inv-3', codeType: 'student', context: { className: 'Welsh 101' } },
        '/api/auth/possession-redeem': { success: true, session: { access_token: 'at-1', refresh_token: 'rt-1' } },
        '/api/code/redeem': { success: true, role: 'student', redirectTo: '/', courseCode: 'cym_for_eng', label: 'Student Invite' },
      },
      {},
      { handleCourseSelect, enrolledCourses }
    )
    await flushAsync()

    await wrapper.find('#redeem-details-email').setValue('student@school.example')
    await wrapper.find('form').trigger('submit.prevent')
    await flushAsync()
    await flushAsync()

    expect(handleCourseSelect).toHaveBeenCalledTimes(1)
    expect(handleCourseSelect).toHaveBeenCalledWith(
      expect.objectContaining({ course_code: 'cym_for_eng', display_name: 'Welsh' })
    )
  })

  it('falls back to fetching the course row from Supabase when the catalogue has not loaded yet', async () => {
    const handleCourseSelect = vi.fn().mockResolvedValue(undefined)
    const enrolledCourses = ref([]) // catalogue not loaded yet at redemption time
    const maybeSingle = vi.fn().mockResolvedValue({ data: { course_code: 'cym_for_eng', display_name: 'Welsh' }, error: null })
    const supabaseOverride = ref({
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'sess-tok' } } }),
        setSession: vi.fn().mockResolvedValue({ error: null }),
        signOut: vi.fn().mockResolvedValue({}),
        signInWithOtp: vi.fn().mockResolvedValue({ error: null }),
        verifyOtp: vi.fn().mockResolvedValue({ error: null }),
      },
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle,
      })),
    })
    const auth = { isAuthenticated: ref(false), user: ref(null), refreshRole: vi.fn().mockResolvedValue(undefined) }
    vi.stubGlobal('fetch', mockFetchByUrl({
      '/api/code/validate': { valid: true, codeKind: 'invite', inviteCodeId: 'inv-4', codeType: 'student', context: { className: 'Welsh 101' } },
      '/api/auth/possession-redeem': { success: true, session: { access_token: 'at-1', refresh_token: 'rt-1' } },
      '/api/code/redeem': { success: true, role: 'student', redirectTo: '/', courseCode: 'cym_for_eng', label: 'Student Invite' },
    }))
    const wrapper = mount(RedeemCode, {
      global: { provide: { supabase: supabaseOverride, auth, handleCourseSelect, enrolledCourses } },
    })
    await flushAsync()

    await wrapper.find('#redeem-details-email').setValue('student@school.example')
    await wrapper.find('form').trigger('submit.prevent')
    await flushAsync()
    await flushAsync()

    expect(maybeSingle).toHaveBeenCalled()
    expect(handleCourseSelect).toHaveBeenCalledWith(
      expect.objectContaining({ course_code: 'cym_for_eng' })
    )
  })
})
