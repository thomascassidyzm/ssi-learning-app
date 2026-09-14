/**
 * The I-speak filter is remembered in localStorage, so a learner who once
 * tapped 中文 opens the picker later to five rows and a sheet that cannot
 * scroll, because there is nothing below (Aran, Chromebook, 2026-09-14:
 * "choose your course not scrolling"). The foot of a filtered list names
 * the filter and offers one tap out. Red before the foot existed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref, computed } from 'vue'

vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('../composables/useUserEntitlements', () => ({ useSharedUserEntitlements: () => ({ entitlements: ref([]) }) }))
vi.mock('../composables/useEntitlement', () => ({ hasTryEntitlement: () => false }))
vi.mock('../composables/useSubscription', () => ({
  useSharedSubscription: () => ({ isSubscribed: ref(false), freeAccess: ref(null), hasFreeAccess: computed(() => false) }),
}))
vi.mock('../composables/useCheckout', () => ({ useCheckout: () => ({ startCheckout: vi.fn() }) }))
vi.mock('../platform/paymentRoute', () => ({ canTakePayment: () => true }))
vi.mock('../composables/useUserRole', () => ({ useUserRole: () => ({ platformRole: ref('learner') }) }))

import CourseSelector from './CourseSelector.vue'

const CATALOGUE = [
  { course_code: 'spa_for_zho', target_lang: 'spa', known_lang: 'zho', display_name: 'Spanish', new_app_status: 'beta', pricing_tier: 'premium' },
  { course_code: 'fra_for_zho', target_lang: 'fra', known_lang: 'zho', display_name: 'French', new_app_status: 'beta', pricing_tier: 'premium' },
  { course_code: 'cym_n_for_eng', target_lang: 'cym_n', known_lang: 'eng', display_name: 'North Welsh', new_app_status: 'live', pricing_tier: 'premium' },
  { course_code: 'ita_for_eng', target_lang: 'ita', known_lang: 'eng', display_name: 'Italian', new_app_status: 'live', pricing_tier: 'premium' },
]

const mountPicker = (onlyCourses: string[] = []) =>
  mount(CourseSelector, {
    props: { isOpen: true, enrolledCourses: CATALOGUE, onlyCourses, supabase: null },
    global: { provide: { learnerEnrollments: ref(new Map()) }, stubs: { LanguageFlag: true } },
  })
const rowNames = (w: ReturnType<typeof mountPicker>) => w.findAll('.course-row .row-name').map(n => n.text())

beforeEach(() => localStorage.setItem('ssi-i-speak', 'zho'))

describe('CourseSelector foot of an I-speak-filtered list', () => {
  it('FAILURE MODE: a remembered 中文 filter shows only its courses and says the list is complete', () => {
    const w = mountPicker()
    expect(rowNames(w)).not.toContain('Italian')
    const foot = w.find('[data-walk="course-picker-list-foot"]')
    expect(foot.exists()).toBe(true)
    expect(foot.text()).toContain('中文')
  })

  it('Show all languages clears the filter, the whole catalogue comes back, and the foot goes', async () => {
    const w = mountPicker()
    await w.find('[data-walk="course-picker-show-all"]').trigger('click')
    expect(rowNames(w)).toContain('Italian')
    expect(rowNames(w)).toContain('Spanish')
    expect(w.find('[data-walk="course-picker-list-foot"]').exists()).toBe(false)
    expect(localStorage.getItem('ssi-i-speak')).toBe('')
  })

  it('no foot in a scoped picker: the org chose those courses, not a filter', () => {
    const w = mountPicker(['cym_n_for_eng'])
    expect(w.find('[data-walk="course-picker-list-foot"]').exists()).toBe(false)
  })
})
