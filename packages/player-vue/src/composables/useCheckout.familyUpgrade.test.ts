/**
 * PREMIUM → FAMILY IS AN UPGRADE, NOT A SECOND PURCHASE.
 *
 * Somebody paying £15/mo who wants their family on it used to hit the
 * already-subscribed notice and be sent to the Paddle customer portal, which
 * cannot change a plan. The money path for our highest-value conversion was a
 * dead end. Now the same tap posts to /api/subscription/change-plan, Paddle
 * swaps the price on the subscription they already hold, and nothing else about
 * the guard moves.
 *
 * These tests FAIL on the pre-change composable — it opened the
 * already-subscribed notice and never called the endpoint — and pass after.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { computed } from 'vue'

const { checkoutOpen, subscribed, planName, refreshed } = vi.hoisted(() => ({
  checkoutOpen: vi.fn(),
  subscribed: { value: true },
  planName: { value: 'SSi Premium' as string | null },
  refreshed: { count: 0 },
}))

vi.mock('@/lib/paddle', () => ({
  paddleConfig: {
    familyMonthlyPriceId: 'pri_family_monthly_test',
    familyAnnualPriceId: 'pri_family_annual_test',
    teacherMonthlyPriceId: 'pri_premium_monthly_test',
    teacherAnnualPriceId: 'pri_premium_annual_test',
  },
  getPaddle: async () => ({ Checkout: { open: checkoutOpen, close: vi.fn() } }),
}))
vi.mock('@/platform/paymentRoute', () => ({ canTakePayment: () => true, paddleBillingAvailable: () => true }))
vi.mock('@/composables/useAuthModal', () => ({ useAuthModal: () => ({ open: vi.fn() }) }))
vi.mock('./useSubscription', () => ({
  useSharedSubscription: () => ({
    isSubscribed: computed(() => subscribed.value),
    subscription: computed(() => (subscribed.value ? { planName: planName.value } : null)),
    refresh: async () => { refreshed.count += 1 },
    openPortal: async () => {},
  }),
}))

import { useCheckout } from './useCheckout'
import { setSchoolsClient } from './schools/client'

const session = { user: { id: 'user-1', email: 'payer@example.test' }, access_token: 'tok-1' }
const client: any = { auth: { getSession: async () => ({ data: { session } }) } }

const settle = () => new Promise((r) => setTimeout(r, 0))

let fetchMock: ReturnType<typeof vi.fn>

describe('Premium → Family runs as a plan change', () => {
  beforeEach(() => {
    checkoutOpen.mockClear()
    refreshed.count = 0
    subscribed.value = true
    planName.value = 'SSi Premium'
    setSchoolsClient(client)
    fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, planName: 'SSi Family', billingPeriod: 'monthly' }),
    }))
    vi.stubGlobal('fetch', fetchMock)
    const c = useCheckout()
    c.closeDetails()
    c.closeCheckout()
    c.closePlans()
    c.closeAlreadySubscribed()
    c.clearFamilyUpgrade()
  })

  it('a Premium subscriber choosing Family posts the plan change and never opens Paddle', async () => {
    const checkout = useCheckout()
    await checkout.startCheckout({ plan: 'family', billingPeriod: 'monthly' })
    await settle()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as any[]
    expect(url).toBe('/api/subscription/change-plan')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ plan: 'family', billingPeriod: 'monthly' })
    expect(init.headers.Authorization).toBe('Bearer tok-1')

    // No second subscription, and no dead-end notice.
    expect(checkoutOpen).not.toHaveBeenCalled()
    expect(checkout.alreadySubscribedOpen.value).toBe(false)
    expect(checkout.familyUpgradeDone.value).toBe(true)
    // The app re-reads so it shows SSi Family straight away.
    expect(refreshed.count).toBeGreaterThan(0)
  })

  it('the door is offered to a plain Premium subscriber and to nobody else', async () => {
    const checkout = useCheckout()
    expect(checkout.canUpgradeToFamily()).toBe(true)

    planName.value = 'SSi Family'
    expect(checkout.canUpgradeToFamily(), 'an owner is already there').toBe(false)

    planName.value = 'SSi Family (member)'
    expect(checkout.canUpgradeToFamily(), 'a member owns no row to change').toBe(false)

    planName.value = 'SSi Premium (tutor bundle)'
    expect(checkout.canUpgradeToFamily(), 'a different product').toBe(false)

    subscribed.value = false
    planName.value = 'SSi Premium'
    expect(checkout.canUpgradeToFamily(), 'nothing to upgrade FROM').toBe(false)
  })

  it('a Family owner tapping Family is still BLOCKED — the double-subscription guard is intact', async () => {
    planName.value = 'SSi Family'
    const checkout = useCheckout()
    await checkout.startCheckout({ plan: 'family', billingPeriod: 'monthly' })
    await settle()

    expect(fetchMock).not.toHaveBeenCalled()
    expect(checkoutOpen).not.toHaveBeenCalled()
    expect(checkout.alreadySubscribedOpen.value).toBe(true)
  })

  it('a Premium subscriber tapping PREMIUM again is still blocked', async () => {
    const checkout = useCheckout()
    await checkout.startCheckout({ plan: 'premium', billingPeriod: 'monthly' })
    await settle()

    expect(checkoutOpen).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(checkout.alreadySubscribedOpen.value).toBe(true)
  })

  it('a failing endpoint says so and leaves them where they were', async () => {
    fetchMock = vi.fn(async () => ({
      ok: false,
      json: async () => ({ error: 'Resolve the outstanding payment before changing your plan' }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const checkout = useCheckout()
    const ok = await checkout.upgradeToFamily()
    expect(ok).toBe(false)
    expect(checkout.familyUpgradeError.value).toMatch(/outstanding payment/i)
    expect(checkout.familyUpgradeDone.value).toBe(false)
    expect(checkoutOpen).not.toHaveBeenCalled()
  })

  it('a signed-out caller cannot change anybody’s plan', async () => {
    setSchoolsClient({ auth: { getSession: async () => ({ data: { session: null } }) } } as any)
    const checkout = useCheckout()
    const ok = await checkout.upgradeToFamily()
    expect(ok).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
    setSchoolsClient(client)
  })
})
