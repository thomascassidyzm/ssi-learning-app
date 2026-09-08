/**
 * A PLATFORM ADMIN IS NEVER SHOWN UPGRADE (Tom, 2026-09-08).
 *
 * On staging, signed in as himself: "I'm being shown an upgrade button, which
 * I probably shouldn't be shown as I am a platform admin." Reproduced as a
 * real ssi_admin on staging the same morning — the SUBSCRIPTION section
 * offered "Upgrade · £15/month for one account, £25/month for six".
 *
 * The signal read here is `isPlatformAdmin` off /api/subscription, which
 * resolves it from the learner row server-side. It is deliberately NOT
 * useUserRole's `isSsiAdmin`: that composable's state is cached in
 * localStorage under `ssi-user-role`, so keying a money-path decision off it
 * would let any browser talk the app into the admin treatment.
 *
 * The second assertion is the one that guards against curing the sale with a
 * dead button: he has no Paddle subscription, so a portal link or a cancel
 * would error against a subscription that does not exist. One plain row, no
 * billing action.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref } from 'vue'
import { mount } from '@vue/test-utils'
import eng from '../locales/eng.json'

const isPlatformAdmin = ref(false)

vi.mock('../composables/useSubscription', () => ({
  useSharedSubscription: () => ({
    openPortal: vi.fn(),
    isLoading: ref(false),
    error: ref(''),
    subscription: ref(null),
    isSubscribed: ref(false),
    cancelSubscription: vi.fn(),
    refresh: vi.fn(),
    isPlatformAdmin,
  }),
}))
vi.mock('../platform/paymentRoute', () => ({
  canTakePayment: () => true,
  paddleBillingAvailable: () => true,
}))

const COPY = (eng as Record<string, any>).settings

async function render() {
  const SettingsScreen = (await import('./SettingsScreen.vue')).default as any
  return mount(SettingsScreen, {
    global: {
      stubs: { Teleport: true, RouterLink: true, teleport: true },
      mocks: { $route: { path: '/' } },
      provide: { auth: { isAuthenticated: ref(true), user: ref({ id: 'u1', email: 'admin@example.com' }) } },
    },
  })
}

const upgradeRow = (w: any) =>
  w.findAll('.setting-row.clickable').find((r: any) => r.text().includes(COPY.upgrade))

beforeEach(() => { isPlatformAdmin.value = false })

describe('the SUBSCRIPTION section, for a platform admin', () => {
  it('does not offer to sell him a plan', async () => {
    isPlatformAdmin.value = true
    const w = await render()
    expect(upgradeRow(w)).toBeUndefined()
    expect(w.text()).not.toContain(COPY.plansFromMonth)
  })

  it('names his access, and offers no billing action that could not work', async () => {
    isPlatformAdmin.value = true
    const w = await render()
    const section = w.findAll('section').find((s: any) => s.text().includes(COPY.subscription))
    expect(section, 'the SUBSCRIPTION section is still on screen').toBeTruthy()
    expect(section!.text()).toContain(COPY.platformAdmin)
    // Nothing to tap: no portal, no cancel, no checkout.
    expect(section!.findAll('.setting-row.clickable').length).toBe(0)
    expect(section!.text()).not.toContain(COPY.cancelSubscription)
  })

  it('still sells to an ordinary learner — the suppression is not universal', async () => {
    const w = await render()
    expect(upgradeRow(w), 'a learner with no subscription is still offered a plan').toBeTruthy()
  })
})
