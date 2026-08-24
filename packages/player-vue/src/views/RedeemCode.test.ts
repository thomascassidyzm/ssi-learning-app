/**
 * RedeemCode.vue — the link is the credential, with ONE identity-capture
 * screen (founder ruling 2026-07-20). A possession-eligible invite
 * (teacher/school_admin/school_admin_join/govt_admin/student) never OTPs and
 * never does an email round-trip. Named roles get exactly one friendly
 * capture screen on first redeem — "You've been invited as a teacher at X.
 * Your name / your email" — then straight in on the role surface, as a REAL
 * named account (zero link-<uuid> ghosts). Pupil links (student/learner)
 * capture a name only. A re-clicked link under the same session goes straight
 * to the person's surface — no confirm, no second code spend. The email/OTP
 * flow stays as the fallback for code types that need it (entitlement/
 * ssi_admin/tester) and for already-registered emails.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref } from 'vue'

const { routerPush, routerReplace } = vi.hoisted(() => ({
  routerPush: vi.fn(),
  routerReplace: vi.fn(),
}))

vi.mock('vue-router', () => ({
  useRoute: () => ({ name: 'redeem-code', params: { code: 'TEACH-1' }, query: {} }),
  useRouter: () => ({ push: routerPush, replace: routerReplace }),
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

describe('RedeemCode.vue — identity capture, then in (no OTP)', () => {
  beforeEach(() => {
    routerPush.mockClear()
    routerReplace.mockClear()
    sessionStorage.clear()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('a teacher invite shows ONE capture screen (name + email, role + place named) — no OTP, no ghost linkAuth mint', async () => {
    const posted: any[] = []
    const { wrapper, supabase, auth } = mountRedeemCode({
      '/api/code/validate': { valid: true, codeKind: 'invite', inviteCodeId: 'inv-1', codeType: 'teacher', context: { schoolName: 'Test School' } },
      '/api/auth/possession-redeem': (body: any) => {
        posted.push(body)
        return { success: true, session: { access_token: 'at-1', refresh_token: 'rt-1' } }
      },
      '/api/code/redeem': { success: true, role: 'teacher', redirectTo: '/schools', label: 'Teacher Invite' },
    })
    await flushAsync()
    await flushAsync()

    // The capture screen is the FIRST and ONLY screen: role + place in the
    // heading, name + email fields, no OTP input, nothing auto-fired.
    expect(wrapper.text()).toContain("You've been invited as a teacher at Test School")
    expect(wrapper.find('#redeem-name').exists()).toBe(true)
    expect(wrapper.find('#redeem-details-email').exists()).toBe(true)
    expect(wrapper.find('#redeem-otp').exists()).toBe(false)
    expect(posted).toHaveLength(0) // no ghost mint on mount

    await wrapper.find('#redeem-name').setValue('Sian Jones')
    await wrapper.find('#redeem-details-email').setValue('sian@school.example')
    await wrapper.find('form').trigger('submit.prevent')
    await flushAsync()
    await flushAsync()

    // Real identity captured: typed email + name, NEVER linkAuth for a named
    // role (zero link-<uuid> ghosts — the pin).
    expect(posted[0]).toMatchObject({ code: 'TEACH-1', email: 'sian@school.example', displayName: 'Sian Jones' })
    expect(posted[0].linkAuth).toBeUndefined()
    expect(supabase.value.auth.setSession).toHaveBeenCalledWith({ access_token: 'at-1', refresh_token: 'rt-1' })
    expect(auth.refreshRole).toHaveBeenCalled()
    expect(supabase.value.auth.signInWithOtp).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain("You're all set!")
  })

  it('a pupil (student) link captures a NAME ONLY — no email field — and mints via linkAuth with that name', async () => {
    const posted: any[] = []
    const { wrapper, supabase } = mountRedeemCode({
      '/api/code/validate': { valid: true, codeKind: 'invite', inviteCodeId: 'inv-3', codeType: 'student', context: { className: 'Welsh 101', schoolName: 'Test School' } },
      '/api/auth/possession-redeem': (body: any) => {
        posted.push(body)
        return { success: true, session: { access_token: 'at-1', refresh_token: 'rt-1' } }
      },
      '/api/code/redeem': { success: true, role: 'student', redirectTo: '/', courseCode: null, label: 'Student Invite' },
    })
    await flushAsync()
    await flushAsync()

    expect(wrapper.text()).toContain("You're joining Welsh 101")
    expect(wrapper.find('#redeem-pupil-name').exists()).toBe(true)
    expect(wrapper.find('#redeem-details-email').exists()).toBe(false)

    await wrapper.find('#redeem-pupil-name').setValue('Alys')
    await wrapper.find('form').trigger('submit.prevent')
    await flushAsync()
    await flushAsync()

    expect(posted[0]).toMatchObject({ code: 'TEACH-1', linkAuth: true, displayName: 'Alys' })
    expect(posted[0].email).toBeUndefined()
    expect(supabase.value.auth.setSession).toHaveBeenCalledWith({ access_token: 'at-1', refresh_token: 'rt-1' })
    expect(supabase.value.auth.signInWithOtp).not.toHaveBeenCalled()
  })

  it('a PERSONAL link (species 1) signs straight into the bound account — ZERO screens: no capture form, no confirm, lands on the role surface', async () => {
    const posted: any[] = []
    const { wrapper, supabase } = mountRedeemCode({
      '/api/code/validate': { valid: true, codeKind: 'invite', inviteCodeId: 'inv-p1', codeType: 'govt_admin', context: { groupName: 'IME Demo Programme' }, personal: true, alreadyRedeemed: false, redirectTo: '/schools' },
      '/api/auth/possession-redeem': (body: any) => {
        posted.push(body)
        return { success: true, personal: true, session: { access_token: 'at-p', refresh_token: 'rt-p' } }
      },
    })
    await flushAsync()
    await flushAsync()

    // THE PIN: zero screens. No name field, no email field, no OTP, no confirm.
    expect(wrapper.find('#redeem-name').exists()).toBe(false)
    expect(wrapper.find('#redeem-pupil-name').exists()).toBe(false)
    expect(wrapper.find('#redeem-details-email').exists()).toBe(false)
    expect(wrapper.find('#redeem-otp').exists()).toBe(false)
    expect(posted.length).toBe(1)
    expect(supabase.value.auth.setSession).toHaveBeenCalledWith({ access_token: 'at-p', refresh_token: 'rt-p' })
    expect(supabase.value.auth.signInWithOtp).not.toHaveBeenCalled()
    expect(routerReplace).toHaveBeenCalledWith('/schools')
  })

  it('a re-clicked link under a session that already redeemed it goes STRAIGHT to the role surface — no confirm, no second spend', async () => {
    const { supabase } = mountRedeemCode(
      {
        '/api/code/validate': { valid: true, codeKind: 'invite', inviteCodeId: 'inv-1', codeType: 'teacher', context: { schoolName: 'Test School' }, alreadyRedeemed: true, redirectTo: '/schools' },
      },
      { isAuthenticated: ref(true), user: ref({ email: 'sian@school.example' }) }
    )
    await flushAsync()
    await flushAsync()

    expect(routerReplace).toHaveBeenCalledWith('/schools')
    expect(supabase.value.auth.signInWithOtp).not.toHaveBeenCalled()
  })

  it('an already-registered email on the capture screen offers sign-in-instead, never minting a session', async () => {
    const { wrapper, supabase } = mountRedeemCode({
      '/api/code/validate': { valid: true, codeKind: 'invite', inviteCodeId: 'inv-1', codeType: 'teacher', context: {} },
      '/api/auth/possession-redeem': { success: false, reason: 'already_registered', error: 'An account already exists for this email. Please sign in instead.' },
    })
    await flushAsync()
    await flushAsync()

    await wrapper.find('#redeem-name').setValue('Sian Jones')
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
  beforeEach(() => {
    routerPush.mockClear()
    routerReplace.mockClear()
    sessionStorage.clear()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // Regression for: a student who joined a class via the invite link landed
  // in the catalogue default course instead of their class's — App.vue's
  // activeCourse is resolved ONCE at boot, before this page's redemption
  // completes, so a bare localStorage write (the old fix) was never re-read.
  // The fix routes through App.vue's own handleCourseSelect, the same
  // machinery CourseSelector uses for an explicit switch. Now driven from the
  // pupil name-capture submit.
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
    await flushAsync()

    await wrapper.find('#redeem-pupil-name').setValue('Alys')
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
    await flushAsync()

    await wrapper.find('#redeem-pupil-name').setValue('Alys')
    await wrapper.find('form').trigger('submit.prevent')
    await flushAsync()
    await flushAsync()

    expect(maybeSingle).toHaveBeenCalled()
    expect(handleCourseSelect).toHaveBeenCalledWith(
      expect.objectContaining({ course_code: 'cym_for_eng' })
    )
  })
})

// A double-tap on "verify" fires a second verifyOtp with a token the first
// call has already consumed. Supabase answers with its ONE generic "Token has
// expired or is invalid" — the same string it uses for a genuinely wrong code
// — so the pre-fix screen told a learner who was already signed in that their
// code was wrong (the 2026-08-10 diagnosis). The success check now runs BEFORE
// the error.
describe('RedeemCode.vue — a double-tap after a successful verify (2026-08-10)', () => {
  beforeEach(() => {
    routerPush.mockClear()
    routerReplace.mockClear()
    sessionStorage.clear()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('does NOT show an error to a learner who is genuinely signed in — it carries on into the redemption', async () => {
    // The first tap is left in flight so the second one lands while the OTP
    // form is still on screen: the real double-tap, not a sequential retry.
    // Both taps are in flight together — the real double-tap. The FIRST one
    // resolves first (it was sent first) and signs the learner in; the second
    // then comes back with the consumed-token error.
    let releaseFirst: (v: any) => void = () => {}
    let releaseSecond: (v: any) => void = () => {}
    const firstVerify = new Promise((resolve) => { releaseFirst = resolve })
    const secondVerify = new Promise((resolve) => { releaseSecond = resolve })
    const verifyOtp = vi.fn().mockReturnValueOnce(firstVerify).mockReturnValueOnce(secondVerify)

    const supabase = ref({
      auth: {
        // Signed in for real, on the address being verified.
        getSession: vi.fn().mockResolvedValue({
          data: { session: { access_token: 'sess-tok', user: { email: 'tester@example.com' } } },
        }),
        setSession: vi.fn().mockResolvedValue({ error: null }),
        signOut: vi.fn().mockResolvedValue({}),
        signInWithOtp: vi.fn().mockResolvedValue({ error: null }),
        verifyOtp,
      },
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      })),
    })
    const auth = { isAuthenticated: ref(false), user: ref(null), refreshRole: vi.fn().mockResolvedValue(undefined) }
    const redeemPosts: any[] = []
    vi.stubGlobal('fetch', mockFetchByUrl({
      '/api/code/validate': { valid: true, codeKind: 'invite', inviteCodeId: 'inv-2', codeType: 'tester', context: {} },
      '/api/code/redeem': (body: any) => {
        redeemPosts.push(body)
        return { success: true, role: 'tester', redirectTo: '/', label: 'Tester' }
      },
    }))
    const wrapper = mount(RedeemCode, { global: { provide: { supabase, auth } } })
    await flushAsync()

    await wrapper.find('#redeem-email').setValue('tester@example.com')
    await wrapper.find('form').trigger('submit.prevent')
    await flushAsync()

    await wrapper.find('#redeem-otp').setValue('123456')
    await wrapper.find('form').trigger('submit.prevent') // tap 1
    await wrapper.find('form').trigger('submit.prevent') // tap 2 — same code, in flight together
    await flushAsync()

    releaseFirst({ error: null })
    await flushAsync()
    await flushAsync()
    releaseSecond({ error: { message: 'Token has expired or is invalid' } })
    await flushAsync()
    await flushAsync()

    expect(verifyOtp).toHaveBeenCalledTimes(2)
    expect(redeemPosts.length).toBeGreaterThan(0)
    // THE PIN: nothing tells a genuinely signed-in learner their code was wrong.
    expect((wrapper.vm as any).error).toBe('')
    expect(wrapper.text()).not.toContain('Invalid code')
    expect(wrapper.text()).not.toContain('Token has expired or is invalid')
  })

  it('a genuinely failed code logs ONE login_code_failed carrying email/screen/error type — and never the code itself', async () => {
    const supabase = ref({
      auth: {
        // Nobody is signed in — this really is a bad code.
        getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
        setSession: vi.fn().mockResolvedValue({ error: null }),
        signOut: vi.fn().mockResolvedValue({}),
        signInWithOtp: vi.fn().mockResolvedValue({ error: null }),
        verifyOtp: vi.fn().mockResolvedValue({ error: { message: 'Token has expired or is invalid' } }),
      },
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      })),
    })
    const auth = { isAuthenticated: ref(false), user: ref(null), refreshRole: vi.fn().mockResolvedValue(undefined) }
    const logged: any[] = []
    vi.stubGlobal('fetch', mockFetchByUrl({
      '/api/code/validate': { valid: true, codeKind: 'invite', inviteCodeId: 'inv-2', codeType: 'tester', context: {} },
      '/api/player-events': (body: any) => { logged.push(...(body.events || [])); return { ok: true } },
    }))
    const wrapper = mount(RedeemCode, { global: { provide: { supabase, auth } } })
    await flushAsync()

    await wrapper.find('#redeem-email').setValue('tester@example.com')
    await wrapper.find('form').trigger('submit.prevent')
    await flushAsync()

    await wrapper.find('#redeem-otp').setValue('123456')
    await wrapper.find('form').trigger('submit.prevent')
    await flushAsync()
    await flushAsync()

    // The learner is correctly told it did not work...
    expect((wrapper.vm as any).error).toBe('Token has expired or is invalid')
    // ...and, unlike before, the attempt leaves a trace to look up.
    const failures = logged.filter((e) => e.event_type === 'login_code_failed')
    expect(failures).toHaveLength(1)
    expect(failures[0].payload).toMatchObject({
      screen: 'redeem-code',
      email: 'tester@example.com',
      error_type: 'expired_or_invalid',
    })
    // THE PIN: the submitted code never reaches telemetry.
    expect(JSON.stringify(logged)).not.toContain('123456')
  })
})
