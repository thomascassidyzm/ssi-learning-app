/**
 * THE INTENT MUST SURVIVE THE SIGNUP DETOUR.
 *
 * Tom, walking the live flow 2026-09-07: "Selected family plan / was asked to
 * create an account / was sent an email / verified email with code / then got
 * nothing of family plan or anything".
 *
 * The plan WAS remembered — `pendingPlan` held 'family' the whole time. What
 * failed is the code that spends it. `completePendingCheckout` is called from
 * PlayerContainer's `@success` handler on the sign-in modal, and useCheckout
 * resolved its Supabase client with `inject('supabase')`. inject() only
 * answers inside setup(); in an event handler `currentInstance` is null, so it
 * returned the ref(null) default, `openPaddleCheckout` bailed on
 * "Sign in again to start checkout", and nothing at all happened on screen.
 *
 * The picker's own tests never caught it because they deliberately bind
 * useCheckout inside a real setup() ("Calling startCheckout from outside setup
 * would fail...") — which is exactly the condition production runs in.
 *
 * So this test calls useCheckout the way PlayerContainer does: OUTSIDE any
 * component. It fails on the pre-fix code (Paddle is never opened) and passes
 * once the client resolves through the module-level fallback.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref } from 'vue'

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
import { setSchoolsClient } from './schools/client'

// The signed-out client the picker sees, then the signed-in one the resume
// sees — the same object, flipped, exactly as Supabase behaves across a
// sign-in within one page load.
let session: any = null
const client: any = {
  auth: { getSession: async () => ({ data: { session } }) },
}

describe('the chosen plan survives account creation', () => {
  beforeEach(() => {
    checkoutOpen.mockClear()
    session = null
    // App.vue registers the client at boot. This is the ONLY route to it from
    // an event handler, and it is what the fix depends on.
    setSchoolsClient(client)
    useCheckout().closeDetails()
    useCheckout().closeCheckout()
  })

  it('resumes into the FAMILY checkout after sign-in, called from outside setup', async () => {
    // 1. Signed out, they choose Family monthly (the picker names the plan).
    const checkout = useCheckout()
    await checkout.startCheckout({ plan: 'family', billingPeriod: 'monthly' })
    expect(checkout.detailsOpen.value, 'the details step should be the signed-out path').toBe(true)
    expect(checkoutOpen).not.toHaveBeenCalled()

    // 2. They create the account (or verify a code) — a session now exists.
    session = { user: { id: 'user-1', email: 'buyer@example.test' } }

    // 3. PlayerContainer's @success handler. NOT inside setup() — this is the
    //    line that used to fail silently.
    await useCheckout().completePendingCheckout()
    await new Promise((r) => setTimeout(r, 0))

    expect(checkoutOpen, 'Paddle should open on resume').toHaveBeenCalledTimes(1)
    const call = checkoutOpen.mock.calls[0][0]
    expect(call.items[0].priceId).toBe('pri_family_monthly_test')
    expect(call.customData.kind).toBe('family_plan')
  })

  it('a Family purchase lands the payer on the family surface, not a course list', async () => {
    session = { user: { id: 'user-1', email: 'buyer@example.test' } }
    await useCheckout().startCheckout({ plan: 'family', billingPeriod: 'annual' })
    await new Promise((r) => setTimeout(r, 0))
    const call = checkoutOpen.mock.calls[0][0]
    expect(call.settings.successUrl).toContain('family=1')
  })

  it('Premium still lands where it always did', async () => {
    session = { user: { id: 'user-1', email: 'buyer@example.test' } }
    await useCheckout().startCheckout({ plan: 'premium', billingPeriod: 'monthly', courseCode: 'spa_for_eng' })
    await new Promise((r) => setTimeout(r, 0))
    const call = checkoutOpen.mock.calls[0][0]
    expect(call.items[0].priceId).toBe('pri_premium_monthly_test')
    expect(call.settings.successUrl).toContain('course=spa_for_eng')
    expect(call.settings.successUrl).not.toContain('family=1')
  })
})
