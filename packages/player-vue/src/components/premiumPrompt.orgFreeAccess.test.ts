/**
 * NOBODY WHOSE YEAR IS ALREADY PAID FOR IS SHOWN A PRICE.
 *
 * Kai, 2026-09-08, from the Canolfan welcome pack: a learner enrolled on the
 * funded free year (org_enrolments.free_access_until) was still shown
 * "Premium — £15/mo — Upgrade". The pack had to carry a warning telling
 * learners to ignore it, and a payment warning is exactly what makes a
 * nervous, non-tech-savvy learner quietly not sign up.
 *
 * The two surfaces that sold to them are pinned here, mounted rather than
 * string-matched, because both failure modes are conditional:
 *
 *   - PRESENT for a funded learner, which is the defect being cured;
 *   - ABSENT for an ordinary free learner, which would quietly kill the only
 *     route the app has to a paying subscriber.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref, computed } from 'vue'
import { mount } from '@vue/test-utils'

const YEAR_AWAY = new Date(Date.now() + 300 * 24 * 3600 * 1000).toISOString()

const freeAccess = ref<{ groupId: string; orgName: string | null; until: string } | null>(null)
const hasFreeAccess = computed(() => {
  const until = freeAccess.value?.until
  return !!until && new Date(until) > new Date()
})

vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }), RouterLink: { render: () => null } }))
vi.mock('../composables/useUserEntitlements', () => ({
  useSharedUserEntitlements: () => ({ entitlements: ref([]) }),
}))
vi.mock('../composables/useEntitlement', () => ({ hasTryEntitlement: () => false }))
vi.mock('../composables/useSubscription', () => ({
  useSharedSubscription: () => ({
    openPortal: vi.fn(),
    isLoading: ref(false),
    error: ref(''),
    subscription: ref(null),
    isSubscribed: ref(false),
    freeAccess,
    hasFreeAccess,
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
    canDowngradeToPremium: () => false,
    downgradeToPremium: vi.fn(),
    keepFamily: vi.fn(),
  }),
}))
vi.mock('../platform/paymentRoute', () => ({
  canTakePayment: () => true,
  paddleBillingAvailable: () => true,
}))
vi.mock('../composables/useUserRole', () => ({
  useUserRole: () => ({
    platformRole: ref('learner'),
    isSsiAdmin: ref(false),
    isTester: ref(false),
    hasSchoolRole: ref(false),
    isGovtAdmin: ref(false),
    educationalRole: ref(null),
  }),
}))

import CourseSelector from './CourseSelector.vue'
import eng from '../locales/eng.json'

const UPGRADE = (eng as Record<string, any>).settings.upgrade
const PRICE_LINE = (eng as Record<string, any>).courseSelector.moUnlimitedAccessAll

const WELSH = [
  { course_code: 'cym_n_for_eng', target_lang: 'cym_n', known_lang: 'eng', display_name: 'North Welsh', new_app_status: 'live', pricing_tier: 'premium' },
  { course_code: 'cym_s_for_eng', target_lang: 'cym_s', known_lang: 'eng', display_name: 'South Welsh', new_app_status: 'live', pricing_tier: 'premium' },
]

function mountPicker() {
  return mount(CourseSelector, {
    props: { isOpen: true, enrolledCourses: WELSH, onlyCourses: ['cym_n_for_eng', 'cym_s_for_eng'], supabase: null },
    global: { provide: { learnerEnrollments: ref(new Map()) }, stubs: { LanguageFlag: true } },
  })
}

beforeEach(() => {
  freeAccess.value = null
})

describe('the course picker, for a learner on a funded free year', () => {
  it('FAILURE MODE: no Upgrade button and no £15 price above their own courses', () => {
    freeAccess.value = { groupId: 'g1', orgName: 'National Centre for Learning Welsh', until: YEAR_AWAY }
    const w = mountPicker()
    expect(w.find('.section-header__cta').exists()).toBe(false)
    expect(w.text()).not.toContain(PRICE_LINE)
    expect(w.text()).not.toContain('£15')
  })

  it('says instead when their access runs out, which costs them nothing', () => {
    freeAccess.value = { groupId: 'g1', orgName: 'National Centre for Learning Welsh', until: YEAR_AWAY }
    expect(mountPicker().text()).toContain('Free until')
  })

  it('an EXPIRED grant is no grant — the ordinary offer comes back', () => {
    freeAccess.value = { groupId: 'g1', orgName: 'Canolfan', until: '2020-01-01T00:00:00.000Z' }
    const w = mountPicker()
    expect(w.find('.section-header__cta').exists()).toBe(true)
    expect(w.text()).toContain(PRICE_LINE)
  })

  it('CONTROL: an ordinary learner is still offered the upgrade', () => {
    const w = mountPicker()
    expect(w.find('.section-header__cta').text()).toBe(UPGRADE)
    expect(w.text()).toContain(PRICE_LINE)
  })
})

describe('the settings screen, for a learner on a funded free year', () => {
  async function mountSettings() {
    const SettingsScreen = (await import('./SettingsScreen.vue')).default as any
    return mount(SettingsScreen, {
      global: {
        stubs: { Teleport: true, RouterLink: true, teleport: true },
        mocks: { $route: { path: '/' } },
        provide: { auth: { isAuthenticated: ref(true), user: ref({ id: 'u1', email: 'dysgwr@example.com' }) } },
      },
    })
  }

  it('FAILURE MODE: no Upgrade row', async () => {
    freeAccess.value = { groupId: 'g1', orgName: 'National Centre for Learning Welsh', until: YEAR_AWAY }
    const w = await mountSettings()
    const rows = w.findAll('.setting-row').map((r) => r.text())
    expect(rows.some((t) => t.includes(UPGRADE))).toBe(false)
  })

  it('states what they have and who is paying for it', async () => {
    freeAccess.value = { groupId: 'g1', orgName: 'National Centre for Learning Welsh', until: YEAR_AWAY }
    const text = (await mountSettings()).text()
    expect(text).toContain('Free until')
    expect(text).toContain('National Centre for Learning Welsh')
  })

  it('CONTROL: an ordinary learner still sees the Upgrade row', async () => {
    const w = await mountSettings()
    const rows = w.findAll('.setting-row').map((r) => r.text())
    expect(rows.some((t) => t.includes(UPGRADE))).toBe(true)
  })
})
