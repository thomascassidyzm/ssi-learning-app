/**
 * AN EXISTING SUBSCRIBER MUST NOT BE ABLE TO OPEN A SECOND CHECKOUT.
 *
 * The live money bug (#255, found 2026-09-07, the day SSi Family went on sale):
 * `startCheckout` had no subscription guard, so somebody already paying £15/mo
 * for Premium who tapped Family opened a SECOND, independent Paddle
 * subscription at £25/mo. The webhook then correctly refused to write the row —
 * `wouldStealLiveSubscriptionRow()` sees a live row under a different
 * provider_subscription_id, returns early and logs "REFUSED subscription-row
 * write, needs manual remediation". Net result: £40 a month, two live
 * subscriptions, and no Family plan.
 *
 * These tests fail on the pre-fix code — Paddle opens every time — and pass
 * with the guard. The last one is the other half of the bar: a person who is
 * NOT subscribed must still be able to buy, so the guard is not allowed to
 * fail closed.
 *
 * WHAT CHANGED 2026-09-07, and what did NOT. Premium → Family is now a real
 * upgrade: it runs as a Paddle PLAN CHANGE on the existing subscription
 * (useCheckout.familyUpgrade.test.ts pins it). No assertion here was dropped
 * for it — every case below is one the guard must still block, so the
 * subscriber in these tests is on Family and can only be trying to buy a
 * SECOND subscription.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { computed } from 'vue'

const { checkoutOpen, subscribed, planName } = vi.hoisted(() => ({
  checkoutOpen: vi.fn(),
  subscribed: { value: false },
  // The plan they are on. 'SSi Family' here keeps every case below a genuine
  // BLOCK rather than the Premium → Family plan change, which has its own file
  // (useCheckout.familyUpgrade.test.ts). The guard these tests pin is unchanged
  // for everything except that one upgrade.
  planName: { value: 'SSi Family' as string | null },
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
// The subscription lane, stubbed at the seam the guard actually asks:
// refresh() is the authoritative re-read, isSubscribed is the answer.
vi.mock('./useSubscription', () => ({
  useSharedSubscription: () => ({
    isSubscribed: computed(() => subscribed.value),
    subscription: computed(() => (subscribed.value ? { planName: planName.value } : null)),
    refresh: async () => {},
    openPortal: async () => {},
  }),
}))

import { useCheckout } from './useCheckout'
import { setSchoolsClient } from './schools/client'

let session: any = { user: { id: 'user-1', email: 'payer@example.test' } }
const client: any = { auth: { getSession: async () => ({ data: { session } }) } }

const settle = () => new Promise((r) => setTimeout(r, 0))

describe('an existing subscriber cannot open a second checkout', () => {
  beforeEach(() => {
    checkoutOpen.mockClear()
    subscribed.value = true
    planName.value = 'SSi Family'
    session = { user: { id: 'user-1', email: 'payer@example.test' } }
    setSchoolsClient(client)
    const c = useCheckout()
    c.closeDetails()
    c.closeCheckout()
    c.closePlans()
    c.closeAlreadySubscribed?.()
  })

  it('the FRONT DOOR: an upgrade tap shows the notice, not the prices', async () => {
    const checkout = useCheckout()
    await checkout.startCheckout({ courseCode: 'spa_for_eng' })
    await settle()
    expect(checkout.plansOpen.value, 'the plan picker must not open').toBe(false)
    expect(checkout.alreadySubscribedOpen.value).toBe(true)
    expect(checkoutOpen).not.toHaveBeenCalled()
  })

  it('a NAMED plan (the picker going straight to Paddle) is blocked too', async () => {
    // Already on Family — buying it again is exactly the double-subscription
    // this guard exists to stop, and there is no plan change to offer.
    const checkout = useCheckout()
    await checkout.startCheckout({ plan: 'family', billingPeriod: 'monthly' })
    await settle()
    expect(checkoutOpen, 'Family must not open a second subscription').not.toHaveBeenCalled()
    expect(checkout.alreadySubscribedOpen.value).toBe(true)
    expect(checkout.overlayOpen.value, 'no checkout overlay should be left open').toBe(false)
  })

  it('the 409 RE-ENTRY path: a returning buyer resumed after sign-in is blocked', async () => {
    // Signed out, they choose Family — the details step remembers the plan.
    subscribed.value = false
    session = null
    const checkout = useCheckout()
    await checkout.startCheckout({ plan: 'family', billingPeriod: 'monthly' })
    expect(checkout.detailsOpen.value).toBe(true)

    // They turn out to have an account already (409 already_registered), sign
    // in — and that account is ALREADY subscribed, on Family.
    session = { user: { id: 'user-1', email: 'payer@example.test' } }
    subscribed.value = true
    planName.value = 'SSi Family'
    await useCheckout().completePendingCheckout()
    await settle()

    expect(checkoutOpen, 'the resume must not open a second subscription').not.toHaveBeenCalled()
    expect(useCheckout().alreadySubscribedOpen.value).toBe(true)
  })

  it('FAILS OPEN: someone who is not subscribed can still buy', async () => {
    subscribed.value = false
    const checkout = useCheckout()
    await checkout.startCheckout({ plan: 'premium', billingPeriod: 'monthly', courseCode: 'spa_for_eng' })
    await settle()
    expect(checkoutOpen).toHaveBeenCalledTimes(1)
    expect(checkout.alreadySubscribedOpen.value).toBe(false)
  })
})
