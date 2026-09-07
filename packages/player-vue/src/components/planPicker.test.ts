/**
 * The plan picker is the step that makes SSi Family reachable. Before it
 * existed, every upgrade tap opened one hardcoded £15/mo Premium checkout.
 *
 * These assert the two things that must hold: the picker offers all four
 * choices, and each choice opens Paddle on ITS OWN price id — including the
 * £15/mo Premium price, which must keep working exactly as before.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'

const FAMILY_MONTHLY = 'pri_family_monthly_test'
const FAMILY_ANNUAL = 'pri_family_annual_test'
const PREMIUM_MONTHLY = 'pri_premium_monthly_test'
const PREMIUM_ANNUAL = 'pri_premium_annual_test'

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

import PlanPicker from './PlanPicker.vue'
import { useCheckout } from '@/composables/useCheckout'

const supabase = ref({
  auth: {
    getSession: async () => ({ data: { session: { user: { id: 'user-1', email: 'a@b.test' } } } }),
  },
})

function mountPicker() {
  const Host = defineComponent({ setup: () => () => h(PlanPicker) })
  return mount(Host, { global: { provide: { supabase } } })
}

async function chosenPriceId(label: string): Promise<string | undefined> {
  const wrapper = mountPicker()
  const { openPlans } = useCheckout()
  openPlans(null)
  await wrapper.vm.$nextTick()
  const btn = document.body.querySelectorAll('.plan-btn')
  const target = Array.from(btn).find((b) => b.textContent?.trim() === label) as HTMLElement | undefined
  expect(target, `no button labelled ${label}`).toBeTruthy()
  target!.click()
  await new Promise((r) => setTimeout(r, 0))
  await wrapper.vm.$nextTick()
  await new Promise((r) => setTimeout(r, 0))
  const calls = checkoutOpen.mock.calls
  const call = calls.length ? calls[calls.length - 1][0] : undefined
  wrapper.unmount()
  return call?.items?.[0]?.priceId
}

describe('plan picker', () => {
  beforeEach(() => {
    checkoutOpen.mockClear()
    document.body.innerHTML = ''
    useCheckout().closePlans()
    useCheckout().closeCheckout()
  })

  it('offers Premium and Family, monthly and annual', async () => {
    const wrapper = mountPicker()
    useCheckout().openPlans(null)
    await wrapper.vm.$nextTick()
    const labels = Array.from(document.body.querySelectorAll('.plan-btn')).map((b) => b.textContent?.trim())
    expect(labels).toEqual(['£15/month', '£150/year', '£25/month', '£250/year'])
    const text = document.body.textContent || ''
    expect(text).toContain('SSi Premium')
    expect(text).toContain('SSi Family')
    expect(text).toContain('up to 6 accounts')
    wrapper.unmount()
  })

  it('Family monthly opens the family monthly price', async () => {
    expect(await chosenPriceId('£25/month')).toBe(FAMILY_MONTHLY)
  })

  it('Family annual opens the family annual price', async () => {
    expect(await chosenPriceId('£250/year')).toBe(FAMILY_ANNUAL)
  })

  it('Premium monthly still opens the £15 price', async () => {
    expect(await chosenPriceId('£15/month')).toBe(PREMIUM_MONTHLY)
  })

  it('Premium annual opens the annual premium price', async () => {
    expect(await chosenPriceId('£150/year')).toBe(PREMIUM_ANNUAL)
  })
})
