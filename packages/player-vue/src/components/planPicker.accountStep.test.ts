/**
 * THE ACCOUNT STEP, as a signed-out buyer actually meets it.
 *
 * Tom's ruling, 2026-09-07: "when they click upgrade they should be TOLD,
 * please create an account first so we can be sure you're a real person, or so
 * we can make sure your payment links to your verified account".
 *
 * So the assertions here are about what a person SEES and can do — the reason
 * is on screen before the first field, the card field is unreachable until a
 * mailed code checks out, and there is nowhere at all to type a password.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'

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

import PlanPicker from './PlanPicker.vue'
import { useCheckout } from '@/composables/useCheckout'

const verifyOtp = vi.fn()
let session: any = null
const supabase = ref({
  auth: {
    getSession: async () => ({ data: { session } }),
    verifyOtp: (...a: any[]) => verifyOtp(...a),
  },
})

function mountPicker() {
  const Host = defineComponent({
    setup(_, { expose }) {
      expose({ checkout: useCheckout() })
      return () => h(PlanPicker)
    },
  })
  return mount(Host, { global: { provide: { supabase } } })
}

const type = (sel: string, value: string) => {
  const el = document.body.querySelector(sel) as HTMLInputElement
  expect(el, `no input for ${sel}`).toBeTruthy()
  el.value = value
  el.dispatchEvent(new Event('input'))
}
const text = () => (document.body.querySelector('.plans-card') as HTMLElement)?.innerText
  || (document.body.querySelector('.plans-card') as HTMLElement)?.textContent || ''

beforeEach(() => {
  checkoutOpen.mockClear()
  verifyOtp.mockReset().mockResolvedValue({ error: null })
  sendSignInCode.mockReset().mockResolvedValue({ via: 'resend' })
  session = null
  document.body.innerHTML = ''
  localStorage.clear()
  useCheckout().closeDetails()
  useCheckout().closePlans()
  useCheckout().closeCheckout()
  localStorage.clear()
})

describe('the account step a signed-out buyer sees', () => {
  it('SAYS WHY it is asking, before the first field', async () => {
    const wrapper = mountPicker()
    await (wrapper.vm as any).checkout.startCheckout({ plan: 'family', billingPeriod: 'monthly' })
    await wrapper.vm.$nextTick()

    const why = document.body.querySelector('.plans-why')
    expect(why, 'the reason must be on screen, not implied').toBeTruthy()
    // Tom's two reasons: we check the address is really yours, and the payment
    // is tied to an account you can get back into.
    expect(why!.textContent!.toLowerCase()).toContain('code')
    expect(why!.textContent!.toLowerCase()).toMatch(/really yours|account/)
    wrapper.unmount()
  })

  it('has NOWHERE to type a password — the takeover has no field to live in', async () => {
    const wrapper = mountPicker()
    await (wrapper.vm as any).checkout.startCheckout({ plan: 'family', billingPeriod: 'monthly' })
    await wrapper.vm.$nextTick()
    expect(document.body.querySelectorAll('input[type="password"]').length).toBe(0)
    wrapper.unmount()
  })

  it('walks address → code → the SAME plan, and reaches no card field before the code', async () => {
    const wrapper = mountPicker()
    const checkout = (wrapper.vm as any).checkout
    await checkout.startCheckout({ plan: 'family', billingPeriod: 'annual', courseCode: 'cym_for_eng' })
    await wrapper.vm.$nextTick()

    type('input[autocomplete="email"]', 'buyer@example.test')
    const inputs = document.body.querySelectorAll('input[autocomplete="email"]')
    ;(inputs[1] as HTMLInputElement).value = 'buyer@example.test'
    inputs[1].dispatchEvent(new Event('input'))
    await wrapper.vm.$nextTick()

    ;(document.body.querySelector('.submit-btn') as HTMLElement).click()
    await new Promise((r) => setTimeout(r, 0))
    await wrapper.vm.$nextTick()

    expect(sendSignInCode).toHaveBeenCalled()
    expect(checkoutOpen, 'no card field until the code checks out').not.toHaveBeenCalled()
    expect(text()).toMatch(/buyer@example\.test/)

    // Now the code.
    session = { user: { id: 'user-1', email: 'buyer@example.test' } }
    type('input[autocomplete="one-time-code"]', '123456')
    await wrapper.vm.$nextTick()
    ;(document.body.querySelector('.submit-btn') as HTMLElement).click()
    await new Promise((r) => setTimeout(r, 0))
    await wrapper.vm.$nextTick()
    await new Promise((r) => setTimeout(r, 0))

    expect(checkoutOpen, 'straight back to the payment page they clicked').toHaveBeenCalledTimes(1)
    expect(checkoutOpen.mock.calls[0][0].items[0].priceId).toBe('pri_family_annual_test')
    wrapper.unmount()
  })

  it('says nothing about whether the address already had an account', async () => {
    const wrapper = mountPicker()
    await (wrapper.vm as any).checkout.startCheckout({ plan: 'premium', billingPeriod: 'monthly' })
    await wrapper.vm.$nextTick()
    await (wrapper.vm as any).checkout.sendBuyerCode({ email: 'someone@example.test' })
    await wrapper.vm.$nextTick()

    // The old flow answered "You already have an account with this email",
    // which told any caller who banks with us. Nothing on screen may.
    expect(text().toLowerCase()).not.toMatch(/already have an account|already registered|no account/)
    wrapper.unmount()
  })
})
