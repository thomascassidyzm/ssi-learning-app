/**
 * NO SECOND PURCHASE WHILE ONE IS IN FLIGHT.
 *
 * Tom paid £25 for SSi Family on staging (2026-09-07), saw nothing happen for
 * several minutes, and was able to loop straight back into buying it again —
 * "then spins endlessly". A person who pays twice for one intention holds two
 * live subscriptions and gets one plan, because the webhook correctly refuses
 * to overwrite a live subscription row under a different provider id.
 *
 * THIS TEST FAILS ON THE PRE-FIX useCheckout, which had no notion of a
 * purchase that had been paid for but not yet landed: `hasLiveSubscription()`
 * answers "no" for the whole of that window, so every door — the plan picker,
 * startCheckout, and openPaddleCheckout itself — opened onto Paddle again.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'


const { checkoutOpen } = vi.hoisted(() => ({ checkoutOpen: vi.fn() }))

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

import { useCheckout } from './useCheckout'
import { beginPendingPurchase, landPendingPurchase } from './usePendingPurchase'
import { setSchoolsClient } from './schools/client'

// Signed in, and — as far as /api/subscription is concerned — NOT subscribed.
// That is exactly the state Tom was in with £25 already taken.
const session = { access_token: 'tok', user: { id: 'user-1', email: 'buyer@example.com' } }
const client: any = { auth: { getSession: async () => ({ data: { session } }) } }

beforeEach(() => {
  localStorage.clear()
  landPendingPurchase()
  checkoutOpen.mockClear()
  setSchoolsClient(client)
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ subscription: null, isSubscribed: false }),
  })))
})

describe('a purchase in flight shuts every door onto Paddle', () => {
  it('startCheckout does not open a second checkout', async () => {
    const checkout = useCheckout()
    beginPendingPurchase({ plan: 'family', billingPeriod: 'monthly', transactionId: 'txn_in_flight' })

    await checkout.startCheckout({ plan: 'family', billingPeriod: 'monthly' })

    expect(checkoutOpen).not.toHaveBeenCalled()
  })

  it('the plan picker does not even open', async () => {
    const checkout = useCheckout()
    beginPendingPurchase({ plan: 'family', billingPeriod: 'monthly', transactionId: 'txn_in_flight' })

    checkout.openPlans(null)

    expect(checkout.plansOpen.value).toBe(false)
  })

  it('and once the purchase has landed, buying is possible again', async () => {
    const checkout = useCheckout()
    beginPendingPurchase({ plan: 'premium', billingPeriod: 'monthly', transactionId: 'txn_done' })
    landPendingPurchase()

    checkout.openPlans(null)

    expect(checkout.plansOpen.value).toBe(true)
    checkout.closePlans()
  })
})
