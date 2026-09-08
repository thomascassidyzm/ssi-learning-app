/**
 * NOBODY IS SHOWN A PRICE FOR A COURSE THAT IS ALREADY PAID FOR — AND
 * EVERYBODY IS SHOWN THE PRICE FOR ONE THAT IS NOT.
 *
 * Kai, 2026-09-08, from the Canolfan welcome pack: a learner enrolled on the
 * funded free year (org_enrolments.free_access_until) was still shown
 * "Premium — £15/mo — Upgrade". The pack had to carry a warning telling
 * learners to ignore it, and a payment warning is exactly what makes a
 * nervous, non-tech-savvy learner quietly not sign up.
 *
 * The grant is PER COURSE (Kai, 2026-09-08): Canolfan buys Welsh, so Welsh is
 * silent on price and Spanish is quoted the ordinary one. Three failure modes,
 * all conditional, all pinned by mounting rather than string-matching:
 *
 *   - the price PRESENT on the funded course, which is the defect being cured;
 *   - the price ABSENT on a language they were never given, which would be a
 *     lie, and would quietly kill the only route the app has to a subscriber;
 *   - a bare "you need a subscription" on that language, which reads as
 *     contradicting the free year they were just promised.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref, computed } from 'vue'
import { mount } from '@vue/test-utils'

const YEAR_AWAY = new Date(Date.now() + 300 * 24 * 3600 * 1000).toISOString()

const freeAccess = ref<{ groupId: string; orgName: string | null; until: string; courses: string[] } | null>(null)
const WELSH_GRANT = {
  groupId: 'g1',
  orgName: 'the National Centre for Learning Welsh',
  until: '',
  courses: ['cym_n_for_eng', 'cym_s_for_eng'],
}
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

const SPANISH = { course_code: 'spa_for_eng', target_lang: 'spa', known_lang: 'eng', display_name: 'Spanish', new_app_status: 'live', pricing_tier: 'premium' }

const WELSH = [
  { course_code: 'cym_n_for_eng', target_lang: 'cym_n', known_lang: 'eng', display_name: 'North Welsh', new_app_status: 'live', pricing_tier: 'premium' },
  { course_code: 'cym_s_for_eng', target_lang: 'cym_s', known_lang: 'eng', display_name: 'South Welsh', new_app_status: 'live', pricing_tier: 'premium' },
]

function mountPicker(catalogue = WELSH, onlyCourses = ['cym_n_for_eng', 'cym_s_for_eng']) {
  return mount(CourseSelector, {
    props: { isOpen: true, enrolledCourses: catalogue, onlyCourses, supabase: null },
    global: { provide: { learnerEnrollments: ref(new Map()) }, stubs: { LanguageFlag: true } },
  })
}

const grantWelsh = () => { freeAccess.value = { ...WELSH_GRANT, until: YEAR_AWAY } }

beforeEach(() => {
  freeAccess.value = null
})

describe('the course picker, for a learner on a funded free year', () => {
  it('FAILURE MODE: no Upgrade button and no £15 price above their own courses', () => {
    grantWelsh()
    const w = mountPicker()
    expect(w.find('.section-header__cta').exists()).toBe(false)
    expect(w.text()).not.toContain(PRICE_LINE)
    expect(w.text()).not.toContain('£15')
  })

  it('in a scoped picker it says nothing at all — the header goes, and the rows carry it', () => {
    grantWelsh()
    // A scoped picker IS the two Welsh dialects, all of them already paid for.
    // There is no premium block to label and nothing to upgrade to, so the
    // header goes entirely rather than restating the cover above two rows that
    // each say it for themselves. The sentence itself still has a home: the
    // settings screen, asserted below, and the unscoped case just here.
    const w = mountPicker()
    expect(w.find('.section-header--premium').exists()).toBe(false)
    expect(w.text()).not.toContain('£15')
  })

  it('unscoped and wholly covered, the header stays as the block label and states the cover', () => {
    freeAccess.value = { ...WELSH_GRANT, until: YEAR_AWAY }
    // The full catalogue, where everything premium on screen happens to be
    // theirs: the header is still labelling a block, so it stays — saying what
    // is free instead of what it costs.
    const text = mountPicker(WELSH, []).text()
    expect(text).toContain('Welsh is free until')
    expect(text).toContain('the National Centre for Learning Welsh')
    expect(text).not.toContain('£15')
  })

  it('FAILURE MODE: a language they have NO grant for is still sold, honestly', () => {
    grantWelsh()
    // The unscoped picker: their Welsh sits beside a Spanish nobody bought.
    const w = mountPicker([...WELSH, SPANISH], [])
    expect(w.find('.section-header__cta').text()).toBe(UPGRADE)
    expect(w.text()).toContain(PRICE_LINE)
  })

  it('and their own courses still say, row by row, that they are free', () => {
    grantWelsh()
    // One dialect on offer, so each language is a single row of its own.
    const w = mountPicker([WELSH[0], SPANISH], [])
    const welshRow = w.findAll('.course-row').find((r) => r.text().includes('Welsh'))
    const spanishRow = w.findAll('.course-row').find((r) => r.text().includes('Spanish'))
    expect(welshRow!.text()).toContain('Free through your group')
    // Spanish is not theirs, and says nothing that suggests it is. What it
    // says instead is the picker's existing business: `enrolledCourses` is the
    // catalogue rather than the learner's enrolments — a misnaming this file
    // deliberately leaves alone — so the row's status slot stays as it was.
    expect(spanishRow!.text()).not.toContain('Free through your group')
  })

  it('the dialect rows say it too, once the language is opened', async () => {
    grantWelsh()
    // A collapsed language row shows its variant count, as it always has —
    // the per-course statement belongs on the courses themselves.
    const w = mountPicker([...WELSH, SPANISH], [])
    const welshRow = w.findAll('.course-row').find((r) => r.text().includes('Welsh'))
    await welshRow!.trigger('click')
    const variants = w.findAll('.course-row.variant')
    expect(variants.length).toBe(2)
    for (const v of variants) expect(v.text()).toContain('Free through your group')
  })

  it('an EXPIRED grant is no grant — the ordinary offer comes back', () => {
    freeAccess.value = { ...WELSH_GRANT, until: '2020-01-01T00:00:00.000Z' }
    const w = mountPicker()
    expect(w.find('.section-header__cta').exists()).toBe(true)
    expect(w.text()).toContain(PRICE_LINE)
  })

  it('a grant covering NO course suppresses nothing', () => {
    freeAccess.value = { ...WELSH_GRANT, until: YEAR_AWAY, courses: [] }
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
    grantWelsh()
    const w = await mountSettings()
    const rows = w.findAll('.setting-row').map((r) => r.text())
    expect(rows.some((t) => t.includes(UPGRADE))).toBe(false)
  })

  it('states which language is free, until when, and who is paying', async () => {
    grantWelsh()
    const text = (await mountSettings()).text()
    expect(text).toContain('Welsh is free until')
    expect(text).toContain('the National Centre for Learning Welsh')
  })

  it('and says plainly that the rest of the catalogue is not included', async () => {
    grantWelsh()
    expect((await mountSettings()).text()).toContain('Other languages need their own subscription')
  })

  it('CONTROL: an ordinary learner still sees the Upgrade row', async () => {
    const w = await mountSettings()
    const rows = w.findAll('.setting-row').map((r) => r.text())
    expect(rows.some((t) => t.includes(UPGRADE))).toBe(true)
  })
})
