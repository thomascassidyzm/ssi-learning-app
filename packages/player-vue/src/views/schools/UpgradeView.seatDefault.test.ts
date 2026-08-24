/**
 * UpgradeView — seat DEFAULT + billing-safety pin (money path).
 *
 * The bug (Tom, live on the dev alias, 2026-08-07): the Subscribe page offered
 * ONE teacher seat at £15/month to a school that already had three teachers
 * holding accounts. `seatCount` was a hard-coded ref(1) and loadSubscription()
 * only ever overwrote it for an ALREADY-subscribed school, so every trial
 * school opened its checkout at 1 seat.
 *
 * These tests mount the real component against a stubbed
 * /api/school/subscription and a stubbed Paddle, and pin the two things that
 * matter on a money path:
 *   1. the DEFAULT the admin is shown reflects the school's actual staff — and
 *      stays a default: freely steppable up and down, never a cap, never
 *      overwriting a choice the admin already made;
 *   2. DISPLAYED TOTAL === Paddle quantity × price. Whatever number is on
 *      screen at the moment they click is exactly what Paddle is asked to bill.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ref } from 'vue'

const checkoutOpen = vi.fn()
vi.mock('@/lib/paddle', () => ({
  getPaddle: vi.fn(async () => ({ Checkout: { open: checkoutOpen, updateItems: vi.fn() } })),
  paddleConfig: {
    schoolTeacherMonthlyPriceId: 'pri_school_monthly',
    schoolTeacherAnnualPriceId: 'pri_school_annual',
    teacherMonthlyPriceId: 'pri_tutor_monthly',
    teacherAnnualPriceId: 'pri_tutor_annual',
    orgSeatMonthlyPriceId: 'pri_org_monthly',
    orgSeatAnnualPriceId: 'pri_org_annual',
  },
}))

// The roster-derived client list is only the pre-load fallback for the display;
// the seat default comes from the server count. Stub it empty so the tests can
// only pass via the server number.
vi.mock('@/composables/schools/useTeachersData', () => ({
  useTeachersData: () => ({ teachers: ref([]), fetchTeachers: vi.fn(async () => {}) }),
}))

import UpgradeView from './UpgradeView.vue'
import { useSchoolContext } from '@/composables/schools/useSchoolContext'

const PRICE_PER_SEAT_GBP = 15

const supabaseStub = ref({
  auth: {
    getSession: async () => ({ data: { session: { access_token: 'tok', user: { id: 'admin-uid', email: 'admin@example.com' } } } }),
  },
})

/** The school half of a /api/school/subscription response. */
function subscriptionResponse(school: Record<string, unknown>) {
  return { school, teacher: null, active: true, reason: 'active' }
}

let fetchImpl: (url: string) => unknown

function mountUpgrade() {
  return mount(UpgradeView, {
    global: {
      provide: { supabase: supabaseStub },
      stubs: { RouterLink: true },
    },
  })
}

beforeEach(() => {
  checkoutOpen.mockClear()
  const ctx = useSchoolContext()
  ctx.currentUser.value = {
    user_id: 'admin-uid', learner_id: 'l1', display_name: 'Admin',
    educational_role: 'school_admin', platform_role: null, school_id: 'school-1',
  } as any
  fetchImpl = () => subscriptionResponse({ id: 'school-1', platform_status: 'trial', teacher_seats: 1, teacher_count: 3 })
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
    ok: true,
    // A-123 (2026-08-16): opening a school checkout now first asks the server
    // to bind a Paddle customer to THIS school and sign a checkout intent, so
    // the address of the billing write is never a browser-typed email. The
    // composable fails CLOSED without it, so the stub has to answer it.
    json: async () =>
      url.includes('/api/billing/bind-customer')
        ? { customerId: 'ctm_test', intent: 'signed-intent-token', nodeId: 'school-1' }
        : fetchImpl(url),
  })))
})

afterEach(() => {
  vi.unstubAllGlobals()
  useSchoolContext().currentUser.value = null
})

/** The seat number currently on screen (the stepper input). */
function shownSeats(wrapper: ReturnType<typeof mountUpgrade>): number {
  return Number((wrapper.find('.seat-input').element as HTMLInputElement).value)
}

/** The £ total currently on screen, parsed out of the seat-total figure. */
function shownTotalGbp(wrapper: ReturnType<typeof mountUpgrade>): number {
  const text = wrapper.find('.seat-total').text()
  return Number(text.replace(/[^0-9.]/g, ''))
}

describe('UpgradeView — school seat default', () => {
  it('seeds the stepper from the school’s ACTUAL teacher count when not yet subscribed (the Chepstow bug: 1 → 3)', async () => {
    const wrapper = mountUpgrade()
    await flushPromises()

    expect(shownSeats(wrapper)).toBe(3)
    expect(shownTotalGbp(wrapper)).toBe(3 * PRICE_PER_SEAT_GBP)
    expect(wrapper.text()).toContain('3 teachers joined')
  })

  it('is a DEFAULT, not a cap — the admin can still step down to 1 and up past the count', async () => {
    const wrapper = mountUpgrade()
    await flushPromises()

    const [minus, plus] = wrapper.findAll('.seat-btn')
    await minus.trigger('click')
    await minus.trigger('click')
    expect(shownSeats(wrapper)).toBe(1)
    expect(shownTotalGbp(wrapper)).toBe(1 * PRICE_PER_SEAT_GBP)

    for (let i = 0; i < 5; i++) await plus.trigger('click')
    expect(shownSeats(wrapper)).toBe(6)
    expect(shownTotalGbp(wrapper)).toBe(6 * PRICE_PER_SEAT_GBP)
  })

  it('never overwrites a choice the admin already made while the load was in flight', async () => {
    let resolveFetch: (v: unknown) => void = () => {}
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: () => new Promise((r) => { resolveFetch = r }),
    })))

    const wrapper = mountUpgrade()
    await flushPromises()
    // Admin steps to 6 BEFORE the subscription response lands.
    const plus = wrapper.findAll('.seat-btn')[1]
    for (let i = 0; i < 5; i++) await plus.trigger('click')
    expect(shownSeats(wrapper)).toBe(6)

    resolveFetch(subscriptionResponse({ id: 'school-1', platform_status: 'trial', teacher_seats: 1, teacher_count: 3 }))
    await flushPromises()

    expect(shownSeats(wrapper)).toBe(6) // their 6, not the seeded 3
  })

  it('an ALREADY-subscribed school still seeds from teacher_seats (paid), not from the staff count', async () => {
    fetchImpl = () => subscriptionResponse({ id: 'school-1', platform_status: 'active', teacher_seats: 5, teacher_count: 3 })
    const wrapper = mountUpgrade()
    await flushPromises()

    expect(shownSeats(wrapper)).toBe(5)
    expect(wrapper.text()).toContain('3 teachers joined')
    expect(wrapper.text()).toContain('5 seats paid')
  })

  it('falls back to 1 seat when the server returns no count (nothing worse than before)', async () => {
    fetchImpl = () => subscriptionResponse({ id: 'school-1', platform_status: 'trial', teacher_seats: null })
    const wrapper = mountUpgrade()
    await flushPromises()
    expect(shownSeats(wrapper)).toBe(1)
  })
})

describe('UpgradeView — billing safety: displayed total === billed quantity × price', () => {
  it.each([
    ['the seeded default', 0, 3],
    ['stepped down', -2, 1],
    ['stepped up', 4, 7],
  ])('%s → Paddle is asked for exactly the seats on screen', async (_label, steps, expected) => {
    const wrapper = mountUpgrade()
    await flushPromises()

    const [minus, plus] = wrapper.findAll('.seat-btn')
    for (let i = 0; i < Math.abs(steps); i++) await (steps < 0 ? minus : plus).trigger('click')

    const seatsOnScreen = shownSeats(wrapper)
    const totalOnScreen = shownTotalGbp(wrapper)
    expect(seatsOnScreen).toBe(expected)

    // Click Subscribe — the exact click the admin makes on the money path.
    await wrapper.find('.upgrade-cta').trigger('click')
    await flushPromises()

    expect(checkoutOpen).toHaveBeenCalledTimes(1)
    const items = (checkoutOpen.mock.calls[0][0] as any).items
    expect(items).toHaveLength(1)
    expect(items[0].priceId).toBe('pri_school_monthly')
    // THE PIN: the quantity Paddle bills is the number on screen, and the
    // displayed total is exactly that quantity × the per-seat price.
    expect(items[0].quantity).toBe(seatsOnScreen)
    expect(totalOnScreen).toBe(items[0].quantity * PRICE_PER_SEAT_GBP)
  })
})
