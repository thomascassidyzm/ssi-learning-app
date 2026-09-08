/**
 * THE CANCEL DIALOG OFFERS THE DOWNGRADE (Tom, 2026-09-08).
 *
 * He cancelled his own Family plan and did not see the "Change to SSi Premium"
 * row sitting directly above Cancel in the settings list. The row was there and
 * was deployed; it was simply not where he was looking. His ruling: the
 * alternative belongs in the confirmation he actually reads.
 *
 * Rendered rather than string-matched, because the two ways this goes wrong are
 * both conditional. It can be ABSENT for the Family owner it is meant for,
 * which is the defect being cured; or it can be PRESENT for somebody it does
 * not apply to — a Premium subscriber, or an owner with a change already
 * scheduled — where it either errors or offers a plan change that cannot be
 * made.
 *
 * The third assertion is the one that guards Tom's constraint rather than his
 * feature: cancelling must stay exactly as reachable as it was. No extra
 * confirmation, no disabled button, no pre-selected alternative.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref } from 'vue'
import { mount } from '@vue/test-utils'
import eng from '../locales/eng.json'

const subscription = ref<any>(null)
const canDowngrade = ref(false)

vi.mock('../composables/useSubscription', () => ({
  useSharedSubscription: () => ({
    openPortal: vi.fn(),
    isLoading: ref(false),
    error: ref(''),
    subscription,
    isSubscribed: ref(true),
    cancelSubscription: vi.fn(),
    refresh: vi.fn(),
  }),
}))
vi.mock('../composables/useCheckout', () => ({
  useCheckout: () => ({
    startCheckout: vi.fn(),
    canUpgradeToFamily: () => false,
    upgradeToFamily: vi.fn(),
    clearFamilyUpgrade: vi.fn(),
    familyUpgradeBusy: ref(false),
    familyUpgradeError: ref(''),
    canDowngradeToPremium: () => canDowngrade.value,
    downgradeToPremium: vi.fn(),
    keepFamily: vi.fn(),
  }),
}))
vi.mock('../platform/paymentRoute', () => ({
  canTakePayment: () => true,
  paddleBillingAvailable: () => true,
}))

const COPY = (eng as Record<string, any>).settings
const OFFER = COPY.cancelChangeToPremiumOffer.split('{')[0].trim()

const familyOwner = {
  planName: 'SSi Family',
  status: 'active',
  currentPeriodEnd: '2026-10-07T23:41:26.033Z',
  cancelAtPeriodEnd: false,
  scheduledPlanName: null,
}


beforeEach(() => {
  subscription.value = { ...familyOwner }
  canDowngrade.value = true
})

async function openCancelDialog() {
  const SettingsScreen = (await import('./SettingsScreen.vue')).default as any
  const w = mount(SettingsScreen, {
    global: {
      stubs: { Teleport: true, RouterLink: true, teleport: true },
      mocks: { $route: { path: '/' } },
      provide: { auth: { isAuthenticated: ref(true), user: ref({ id: 'u1', email: 'owner@example.com' }) } },
    },
  })
  const row = w.findAll('.setting-row.clickable.danger').find((r) => r.text().includes(COPY.cancelSubscription))
  expect(row, 'the cancel row is on screen for a web-billed subscriber').toBeTruthy()
  await row!.trigger('click')
  return w
}

describe('the cancel dialog, for a Family owner', () => {
  it('offers the change to Premium, with its own consequence', async () => {
    const w = await openCancelDialog()
    const dialog = w.find('.reset-overlay')
    expect(dialog.text()).toContain(COPY.changeToPremium)
    expect(dialog.text()).toContain(OFFER)
    // And the truth about cancelling itself: no tail for anybody.
    expect(dialog.text()).toContain('Cancelling carries no further cover')
  })

  it('leaves cancelling exactly one tap, live and undemoted', async () => {
    const w = await openCancelDialog()
    const confirms = w.findAll('.reset-overlay .reset-btn--confirm')
    const confirm = confirms[confirms.length - 1]
    expect(confirm.text()).toBe('Cancel subscription')
    expect(confirm.attributes('disabled')).toBeUndefined()
    // The alternative is never the red confirm, and never pre-selected.
    const alt = w.find('.cancel-alt-btn')
    expect(alt.classes()).not.toContain('reset-btn--confirm')
    expect(alt.attributes('autofocus')).toBeUndefined()
  })

  it('is absent for somebody the downgrade does not apply to', async () => {
    subscription.value = { ...familyOwner, planName: 'SSi Premium' }
    canDowngrade.value = false
    const w = await openCancelDialog()
    expect(w.find('.cancel-alt-btn').exists()).toBe(false)
    expect(w.find('.reset-overlay').text()).toContain('Cancel subscription')
  })

  it('is absent when a plan change is already scheduled', async () => {
    subscription.value = { ...familyOwner, scheduledPlanName: 'SSi Premium', scheduledPlanAt: '2026-10-07T23:41:26.033Z' }
    canDowngrade.value = false
    const w = await openCancelDialog()
    expect(w.find('.cancel-alt-btn').exists()).toBe(false)
  })
})
