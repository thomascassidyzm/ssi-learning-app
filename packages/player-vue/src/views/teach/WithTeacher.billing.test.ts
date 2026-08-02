/**
 * TUTOR-CLASS STUDENTS ARE MONTHLY-ONLY (founder ruling, 2026-08-02).
 *
 * The £5 rebate accrues per PAID TRANSACTION, so an annual £100 tutor student
 * would pay 12 months up front and accrue £5 once — the edge case flagged OPEN
 * in docs/DECISIONS.md (2026-08-02, tutor rebate ledger). The ruling closes the
 * annual door in the tutor lane instead of special-casing the ledger.
 *
 * SCHOOL classes keep BOTH £5/mo and £50/yr — that half is pinned here too, so
 * a future tidy-up can't take the school annual option down with it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'

vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { code: 'abc-123' } }),
}))

import WithTeacher from './WithTeacher.vue'

// course_is_free:false → the paid price block (with the billing toggle) renders.
function classResponse(schoolId: string | null) {
  return {
    class: {
      id: 'class-1',
      class_name: 'Beginners Welsh',
      course_code: 'cym_for_eng',
      student_join_code: 'ABC-123',
      school_id: schoolId,
      course_is_free: false,
    },
    teacher: {
      id: 'teacher-1',
      display_name: 'Ms Jones',
      photo_url: null,
      bio: null,
      country: null,
      teaching_languages: [],
    },
    seats_remaining: null,
    is_full: false,
  }
}

function mockFetch(response: any) {
  return vi.fn(async (url: string) => {
    if (String(url).startsWith('/api/teacher/by-code')) {
      return { status: 200, ok: true, json: async () => response } as any
    }
    throw new Error(`Unhandled fetch: ${url}`)
  })
}

const supabase = {
  auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) },
  from: vi.fn(() => {
    throw new Error('no DB access expected in these specs')
  }),
}

async function flushAsync() {
  await Promise.resolve()
  await Promise.resolve()
  await new Promise((r) => setTimeout(r, 0))
}

async function mountFor(schoolId: string | null) {
  vi.stubGlobal('fetch', mockFetch(classResponse(schoolId)))
  const wrapper = mount(WithTeacher, {
    global: { provide: { supabase: { value: supabase } }, stubs: { 'router-link': true } },
  })
  await flushAsync()
  return wrapper
}

describe('WithTeacher.vue — billing period by class type', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('TUTOR class (school_id null): no billing toggle at all — £10/month is the only offer', async () => {
    const wrapper = await mountFor(null)

    expect(wrapper.find('.billing-toggle').exists()).toBe(false)
    expect(wrapper.text()).toContain('£10')
    expect(wrapper.text()).toContain('/ month')
    // The retired annual figure must not appear anywhere in the tutor lane.
    expect(wrapper.text()).not.toContain('£100')
    expect(wrapper.text()).not.toContain('/ year')
  })

  it('SCHOOL class: keeps both periods — £5/month and £50/year', async () => {
    const wrapper = await mountFor('school-1')

    expect(wrapper.find('.billing-toggle').exists()).toBe(true)
    expect(wrapper.text()).toContain('£5')

    const annualTab = wrapper.findAll('.billing-opt')[1]
    await annualTab.trigger('click')
    await flushAsync()

    expect(wrapper.text()).toContain('£50')
    expect(wrapper.text()).toContain('/ year')
  })
})
