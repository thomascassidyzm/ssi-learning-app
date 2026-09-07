/**
 * VERIFY, THEN PAY — and land back on the payment page you clicked.
 *
 * Tom's ruling, 2026-09-07, reversing his own decision of that morning:
 *
 *   "if they click upgrade and they haven't already got an account, once they
 *    then verify their account by emailed code, it should take them straight
 *    back to the payment page they previously clicked on."
 *
 * The verification is not the ball-ache. LOSING YOUR PLACE is. So the tests
 * that matter here are about the plan surviving the journey — including the
 * journey where the app is torn down while somebody reads their mail, which is
 * the case the old in-memory refs could not survive at all.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { checkoutOpen, sendSignInCode } = vi.hoisted(() => ({
  checkoutOpen: vi.fn(),
  sendSignInCode: vi.fn(),
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
vi.mock('@/auth/sendSignInCode', () => ({ sendSignInCode }))
vi.mock('@/composables/useAuthModal', () => ({ useAuthModal: () => ({ open: vi.fn() }) }))

import { useCheckout } from './useCheckout'
import { setSchoolsClient } from './schools/client'
import { readPendingIntent } from '@/checkout/pendingIntent'

let session: any = null
const verifyOtp = vi.fn()
const client: any = {
  auth: {
    getSession: async () => ({ data: { session } }),
    verifyOtp: (...a: any[]) => verifyOtp(...a),
  },
}

beforeEach(() => {
  checkoutOpen.mockClear()
  verifyOtp.mockReset()
  sendSignInCode.mockReset()
  sendSignInCode.mockResolvedValue({ via: 'resend' })
  verifyOtp.mockResolvedValue({ error: null })
  session = null
  localStorage.clear()
  setSchoolsClient(client)
  useCheckout().closeDetails()
  useCheckout().closeCheckout()
  localStorage.clear()
})

describe('the signed-out buyer', () => {
  it('is asked for an account BEFORE a card, and no password is ever sent anywhere', async () => {
    const checkout = useCheckout()
    await checkout.startCheckout({ plan: 'family', billingPeriod: 'monthly' })

    expect(checkout.detailsOpen.value).toBe(true)
    expect(checkout.detailsStep.value, 'the address is asked for first').toBe('email')
    expect(checkoutOpen, 'no card field before the address is proved').not.toHaveBeenCalled()

    await checkout.sendBuyerCode({ email: 'buyer@example.test' })
    expect(sendSignInCode).toHaveBeenCalledWith(client, 'buyer@example.test')
    // The whole takeover lived in a caller-supplied password on an unverified
    // address. There is no longer anywhere for one to be typed.
    expect(JSON.stringify(sendSignInCode.mock.calls)).not.toMatch(/password/i)
    expect(checkout.detailsStep.value).toBe('code')
    expect(checkoutOpen, 'still no card field').not.toHaveBeenCalled()
  })

  it('lands on the SAME plan the moment the code checks out', async () => {
    const checkout = useCheckout()
    await checkout.startCheckout({ plan: 'family', billingPeriod: 'monthly', courseCode: 'cym_for_eng' })
    await checkout.sendBuyerCode({ email: 'buyer@example.test' })

    session = { user: { id: 'user-1', email: 'buyer@example.test' } }
    await checkout.verifyBuyerCode({ code: '123456' })
    await new Promise((r) => setTimeout(r, 0))

    expect(verifyOtp).toHaveBeenCalledWith({ email: 'buyer@example.test', token: '123456', type: 'email' })
    expect(checkoutOpen, 'straight back to the payment page they clicked').toHaveBeenCalledTimes(1)
    expect(checkoutOpen.mock.calls[0][0].items[0].priceId).toBe('pri_family_monthly_test')
    expect(checkout.detailsOpen.value).toBe(false)
  })

  it('a wrong code keeps them where they are, with the plan intact', async () => {
    verifyOtp.mockResolvedValue({ error: { message: 'Token has expired or is invalid' } })
    const checkout = useCheckout()
    await checkout.startCheckout({ plan: 'premium', billingPeriod: 'annual' })
    await checkout.sendBuyerCode({ email: 'buyer@example.test' })
    await checkout.verifyBuyerCode({ code: '000000' })

    expect(checkoutOpen).not.toHaveBeenCalled()
    expect(checkout.detailsStep.value, 'still on the code step').toBe('code')
    expect(checkout.detailsError.value).toBeTruthy()
    expect(readPendingIntent()?.plan, 'the plan is still held').toBe('premium')
  })
})

describe('the journey that used to lose everything', () => {
  it('WRITES THE CHOICE DOWN BEFORE THE ROUND-TRIP STARTS', async () => {
    // The old flow kept the plan in module-level refs and nowhere else. A phone
    // tearing the PWA down while somebody reads their email loses every one of
    // them, and they come back to a generic upgrade page having already decided
    // — which is the exact ball-ache Tom was designing away.
    await useCheckout().startCheckout({ plan: 'family', billingPeriod: 'annual', courseCode: 'cym_for_eng' })
    const atChoice = readPendingIntent()
    expect(atChoice?.plan, 'written down at the moment of choosing, not later').toBe('family')
    expect(atChoice?.billingPeriod).toBe('annual')
    expect(atChoice?.courseCode).toBe('cym_for_eng')

    await useCheckout().sendBuyerCode({ email: 'buyer@example.test' })
    expect(readPendingIntent()?.email, 'and where the code went, so the code step survives too').toBe('buyer@example.test')
  })

  it('opens the stored plan on resume even with nothing left in memory', async () => {
    // Written down by a previous life of the app; nothing in memory names it.
    const { savePendingIntent } = await import('@/checkout/pendingIntent')
    savePendingIntent({ plan: 'family', billingPeriod: 'annual', courseCode: 'cym_for_eng', email: 'buyer@example.test' })
    session = { user: { id: 'user-1', email: 'buyer@example.test' } }

    await useCheckout().completePendingCheckout()
    await new Promise((r) => setTimeout(r, 0))

    expect(checkoutOpen, 'the resume must find the plan on disk').toHaveBeenCalledTimes(1)
    expect(checkoutOpen.mock.calls[0][0].items[0].priceId).toBe('pri_family_annual_test')
    expect(readPendingIntent(), 'and spend it, so it cannot fire again').toBeNull()
  })

  it('does not reopen a checkout somebody deliberately closed', async () => {
    const checkout = useCheckout()
    await checkout.startCheckout({ plan: 'family', billingPeriod: 'monthly' })
    expect(readPendingIntent()).not.toBeNull()
    checkout.closeDetails()

    session = { user: { id: 'user-1' } }
    await useCheckout().completePendingCheckout()
    expect(checkoutOpen).not.toHaveBeenCalled()
  })
})

describe('somebody who already has an account', () => {
  it('is signed in and paid, not sent round the create-account loop', async () => {
    const checkout = useCheckout()
    await checkout.startCheckout({ plan: 'family', billingPeriod: 'monthly', courseCode: 'cym_for_eng' })
    expect(checkout.detailsOpen.value).toBe(true)

    // They take the "already have an account" door on the account step.
    checkout.signInInstead()
    expect(checkout.detailsOpen.value, 'the create-account step gets out of the way').toBe(false)
    expect(readPendingIntent()?.plan, 'and the plan is NOT thrown away with it').toBe('family')

    // They sign in however they like; PlayerContainer resumes the checkout.
    session = { user: { id: 'user-1', email: 'buyer@example.test' } }
    await useCheckout().completePendingCheckout()
    await new Promise((r) => setTimeout(r, 0))

    expect(checkoutOpen).toHaveBeenCalledTimes(1)
    expect(checkoutOpen.mock.calls[0][0].items[0].priceId).toBe('pri_family_monthly_test')
  })

  it('who is ALREADY signed in never sees the account step at all', async () => {
    session = { user: { id: 'user-1', email: 'buyer@example.test' } }
    const checkout = useCheckout()
    await checkout.startCheckout({ plan: 'premium', billingPeriod: 'monthly' })
    await new Promise((r) => setTimeout(r, 0))

    expect(checkout.detailsOpen.value, 'no account step for an existing session').toBe(false)
    expect(checkoutOpen, 'straight to the card field').toHaveBeenCalledTimes(1)
    expect(checkoutOpen.mock.calls[0][0].items[0].priceId).toBe('pri_premium_monthly_test')
  })
})
