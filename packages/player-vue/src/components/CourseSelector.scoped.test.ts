/**
 * CourseSelector, scoped to an org's granted courses.
 *
 * Kai enrolled through a Canolfan link on 2026-09-08, tapped 'Start learning'
 * and got the whole catalogue — every language, with Welsh somewhere below
 * the fold — when the policy grants exactly two courses, North and South
 * Welsh. These tests hold the picker to those two, and to showing them as
 * two tappable dialects rather than one collapsed "Welsh" row.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref, computed } from 'vue'

vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('../composables/useUserEntitlements', () => ({
  useSharedUserEntitlements: () => ({ entitlements: ref([]) }),
}))
vi.mock('../composables/useEntitlement', () => ({ hasTryEntitlement: () => false }))
// The funder's grant, as /api/subscription reports it. Null unless a test
// gives the learner one — an ordinary learner has none.
const freeAccess = ref<{ groupId: string; orgName: string | null; until: string; courses: string[] } | null>(null)
vi.mock('../composables/useSubscription', () => ({
  useSharedSubscription: () => ({
    isSubscribed: ref(false),
    freeAccess,
    hasFreeAccess: computed(() => freeAccess.value !== null),
  }),
}))

/** Give the learner a live grant over exactly these courses. */
function grant(courses: string[]) {
  freeAccess.value = {
    groupId: 'g1',
    orgName: 'National Centre for Learning Welsh',
    until: '2027-09-08T00:00:00Z',
    courses,
  }
}
/** An expired year, or one that was never there: the server reports nothing. */
function noGrant() {
  freeAccess.value = null
}
vi.mock('../composables/useCheckout', () => ({ useCheckout: () => ({ startCheckout: vi.fn() }) }))
// Payment route is on unless a test turns it off — the Upgrade CTA only
// renders when a purchase can actually be taken.
let canPay = true
vi.mock('../platform/paymentRoute', () => ({ canTakePayment: () => canPay }))
vi.mock('../composables/useUserRole', () => ({ useUserRole: () => ({ platformRole: ref('learner') }) }))

import CourseSelector from './CourseSelector.vue'

const CATALOGUE = [
  { course_code: 'cym_n_for_eng', target_lang: 'cym_n', known_lang: 'eng', display_name: 'North Welsh', new_app_status: 'live', pricing_tier: 'premium' },
  { course_code: 'cym_s_for_eng', target_lang: 'cym_s', known_lang: 'eng', display_name: 'South Welsh', new_app_status: 'live', pricing_tier: 'premium' },
  { course_code: 'spa_for_eng', target_lang: 'spa', known_lang: 'eng', display_name: 'Spanish', new_app_status: 'live', pricing_tier: 'premium' },
  { course_code: 'zho_for_eng', target_lang: 'zho', known_lang: 'eng', display_name: 'Chinese', new_app_status: 'live' },
]

function mountPicker(onlyCourses: string[]) {
  return mount(CourseSelector, {
    props: { isOpen: true, enrolledCourses: CATALOGUE, onlyCourses, supabase: null },
    global: {
      provide: { learnerEnrollments: ref(new Map()) },
      stubs: { LanguageFlag: true },
    },
  })
}

const rowNames = (w: ReturnType<typeof mountPicker>) =>
  w.findAll('.course-row .row-name').map(n => n.text())

describe('CourseSelector scoped to granted courses', () => {
  it('FAILURE MODE: shows only the granted courses, not the whole catalogue', () => {
    const names = rowNames(mountPicker(['cym_n_for_eng', 'cym_s_for_eng'])).join(' ')
    expect(names).not.toContain('Spanish')
    expect(names).not.toContain('Chinese')
    expect(names).toContain('Welsh')
  })

  it('opens with both dialects on screen rather than one collapsed row', () => {
    const names = rowNames(mountPicker(['cym_n_for_eng', 'cym_s_for_eng']))
    expect(names).toContain('Northern')
    expect(names).toContain('Southern')
  })

  it('hides the search box and the I-speak pills when scoped', () => {
    const w = mountPicker(['cym_n_for_eng', 'cym_s_for_eng'])
    expect(w.find('.course-search-input').exists()).toBe(false)
    expect(w.find('.i-speak-row').exists()).toBe(false)
  })

  it('unscoped, it still shows the whole catalogue', () => {
    const names = rowNames(mountPicker([])).join(' ')
    expect(names).toContain('Spanish')
    expect(names).toContain('Chinese')
  })
})

/**
 * The Premium header, reconciled.
 *
 * Two fixes met here and disagreed. One hid the header whenever the picker was
 * scoped, because a Canolfan learner choosing between two granted Welsh
 * dialects has nothing to upgrade TO. The other suppressed the price per
 * course, from the grant /api/subscription reports. Merged naively the first
 * won outright, so the header stayed hidden even when the funded year had run
 * out and there really was something to sell again.
 *
 * The grant is the ground truth. 'Scoped' only predicts 'all paid for', and
 * when the two disagree the grant decides.
 *
 * FAILURE MODE (staging, 2026-09-08): the scoped sheet read 'Choose Your
 * Course / Premium — £15/mo — unlimited access to all languages — Upgrade'
 * directly above the two Welsh dialects, to a learner who had just been told
 * their Welsh year is free.
 */
describe('CourseSelector premium header', () => {
  beforeEach(() => {
    canPay = true
    noGrant()
  })

  it('FAILURE MODE: scoped, and every course on screen is granted — no header, no CTA', () => {
    grant(['cym_n_for_eng', 'cym_s_for_eng'])
    const w = mountPicker(['cym_n_for_eng', 'cym_s_for_eng'])
    expect(w.find('.section-header--premium').exists()).toBe(false)
    expect(w.find('.section-header__cta').exists()).toBe(false)
    // The choice itself is untouched.
    expect(rowNames(w)).toContain('Northern')
  })

  it('FAILURE MODE: scoped, but one course on screen is NOT granted — header back at full strength', () => {
    grant(['cym_n_for_eng'])
    const w = mountPicker(['cym_n_for_eng', 'cym_s_for_eng'])
    expect(w.find('.section-header--premium').exists()).toBe(true)
    expect(w.find('.section-header__cta').exists()).toBe(true)
    expect(w.find('.section-header__sub').text()).toContain('£15')
  })

  it('FAILURE MODE: scoped, but the funded year has expired — header back at full strength', () => {
    noGrant()
    const w = mountPicker(['cym_n_for_eng', 'cym_s_for_eng'])
    expect(w.find('.section-header--premium').exists()).toBe(true)
    expect(w.find('.section-header__cta').exists()).toBe(true)
  })

  it('unscoped, with a grant covering everything premium on screen — header stays as the section label, but it states the cover and never sells', () => {
    grant(['cym_n_for_eng', 'cym_s_for_eng', 'spa_for_eng'])
    const w = mountPicker([])
    // Unscoped, the header is doing a second job: it labels the premium block
    // in a full catalogue. It keeps that job, and swaps the price for the
    // truth — which is what the per-course suppression fix intended.
    expect(w.find('.section-header--premium').exists()).toBe(true)
    expect(w.find('.section-header__cta').exists()).toBe(false)
    const sub = w.find('.section-header__sub').text()
    expect(sub).toContain('free')
    expect(sub).not.toContain('£15')
  })

  it('unscoped, with an ungranted premium course on screen — the ordinary offer, unchanged', () => {
    grant(['cym_n_for_eng', 'cym_s_for_eng'])
    const w = mountPicker([])
    expect(w.find('.section-header--premium').exists()).toBe(true)
    expect(w.find('.section-header__cta').exists()).toBe(true)
    expect(w.find('.section-header__sub').text()).toContain('£15')
  })

  it('unscoped, no grant at all — the Premium header and its Upgrade CTA are still there', () => {
    noGrant()
    const w = mountPicker([])
    expect(w.find('.section-header--premium').exists()).toBe(true)
    expect(w.find('.section-header__cta').exists()).toBe(true)
  })
})
