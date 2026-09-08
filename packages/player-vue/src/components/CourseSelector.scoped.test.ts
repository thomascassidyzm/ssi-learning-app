/**
 * CourseSelector, scoped to an org's granted courses.
 *
 * Kai enrolled through a Canolfan link on 2026-09-08, tapped 'Start learning'
 * and got the whole catalogue — every language, with Welsh somewhere below
 * the fold — when the policy grants exactly two courses, North and South
 * Welsh. These tests hold the picker to those two, and to showing them as
 * two tappable dialects rather than one collapsed "Welsh" row.
 */
import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref } from 'vue'

vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('../composables/useUserEntitlements', () => ({
  useSharedUserEntitlements: () => ({ entitlements: ref([]) }),
}))
vi.mock('../composables/useEntitlement', () => ({ hasTryEntitlement: () => false }))
vi.mock('../composables/useSubscription', () => ({
  useSharedSubscription: () => ({ isSubscribed: ref(false) }),
}))
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
 * The Premium header, in a picker where there is nothing to upgrade to.
 *
 * FAILURE MODE (staging, 2026-09-08): the scoped sheet read 'Choose Your
 * Course / Premium — £15/mo — unlimited access to all languages — Upgrade'
 * directly above the two Welsh dialects, to a learner who had just been told
 * their Welsh year is free.
 */
describe('CourseSelector premium header', () => {
  it('FAILURE MODE: no Premium header and no Upgrade CTA when the picker is scoped', () => {
    canPay = true
    const w = mountPicker(['cym_n_for_eng', 'cym_s_for_eng'])
    expect(w.find('.section-header--premium').exists()).toBe(false)
    expect(w.find('.section-header__cta').exists()).toBe(false)
    // The choice itself is untouched.
    expect(rowNames(w)).toContain('Northern')
  })

  it('unscoped, the Premium header and its Upgrade CTA are still there', () => {
    canPay = true
    const w = mountPicker([])
    expect(w.find('.section-header--premium').exists()).toBe(true)
    expect(w.find('.section-header__cta').exists()).toBe(true)
  })
})
