/**
 * TeacherDashboard — the classes list opens sorted by activity.
 *
 * Tom, 2026-09-15 00:52Z, reviewing the live Classes page as the Chepstow
 * leader (job #766): "always sort students/classes/groups of any entity as
 * the default by activity — the most logical being the in-app minutes". So
 * with no ?sort on the URL the table is ordered by time in the app this
 * week, busiest first, and Sort by still offers name and the rest.
 *
 * Seen RED on the pre-change view (default 'name': 6S before 7H) and GREEN
 * after (default 'hours': 7H, 35 min, before 6S, 10 min).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ref, computed } from 'vue'

const store: Record<string, string> = {}
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: vi.fn((k: string) => store[k] ?? null),
    setItem: vi.fn((k: string, v: string) => { store[k] = v }),
    removeItem: vi.fn((k: string) => { delete store[k] }),
    clear: vi.fn(() => { Object.keys(store).forEach(k => delete store[k]) }),
  },
  writable: true,
})

const replace = vi.fn()
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn(), replace, currentRoute: ref({ query: {} }) }),
  useRoute: () => ({ name: 'classes', params: {}, query: {} }),
  RouterLink: { name: 'RouterLink', props: ['to'], template: '<a><slot /></a>' },
}))

// Alphabetical order puts 6S first; activity puts 7H first.
const classes = ref([
  { id: 'c-6s', class_name: '6S', course_code: 'cym_s_for_eng', school_id: 's1', teacher_user_id: 'u1', student_join_code: 'DEF456', current_seed: 1, last_lego_id: null, class_learner_id: null, is_active: true, student_count: 18, avg_seeds_completed: 1, avg_practice_minutes: 0, created_at: '', belt_distribution: {}, activity_last_7: [0, 0, 0, 0, 0, 0, 0], journey_done: 1, journey_total: 334, teachers: [] },
  { id: 'c-7h', class_name: '7H', course_code: 'cym_s_for_eng', school_id: 's1', teacher_user_id: 'u1', student_join_code: 'ABC123', current_seed: 3, last_lego_id: null, class_learner_id: null, is_active: true, student_count: 24, avg_seeds_completed: 3, avg_practice_minutes: 0, created_at: '', belt_distribution: {}, activity_last_7: [0, 1, 0, 1, 1, 0, 0], journey_done: 3, journey_total: 334, teachers: [] },
])
vi.mock('@/composables/schools/useClassesData', () => ({
  useClassesData: () => ({
    classes,
    isLoading: ref(false),
    error: ref(null),
    classesLoaded: ref(true),
    totalStudentsInClasses: computed(() => 42),
    fetchClasses: vi.fn(async () => {}),
    createClass: vi.fn(),
    getClassReport: vi.fn(async () => null),
  }),
}))
vi.mock('@/composables/schools/usePlayAsClass', () => ({
  usePlayAsClass: () => ({ canPlayAsClass: computed(() => true), playAsClassReadOnly: computed(() => false), launchClassSession: vi.fn(), playError: ref(null), switchActiveCourseTo: vi.fn() }),
}))
vi.mock('@/composables/useDashboardRefresh', () => {
  let handler: (() => Promise<void>) | null = null
  return {
    useDashboardRefresh: () => ({
      registerRefresh: (fn: () => Promise<void>) => { handler = fn },
      refresh: async () => { await handler?.() },
      lastUpdated: ref(null), isRefreshing: ref(false), updatedLabel: computed(() => ''), hasHandler: computed(() => true),
    }),
  }
})
vi.mock('@/composables/useMailboxPrompt', () => ({
  useMailboxPrompt: () => ({ isOpen: computed(() => false), primaryEmail: computed(() => null), noteKeepWorthyMoment: vi.fn(), dismiss: vi.fn(), markProved: vi.fn() }),
}))

async function mountView() {
  globalThis.fetch = vi.fn(async (url: any) => {
    const u = String(url)
    // 7H: 2100 s = 35 min; 6S: 600 s = 10 min. Phrases the other way round
    // (6S 40, 7H 20) so a phrases order would be told apart from a minutes one.
    if (u.includes('class-practice-7d')) return { ok: true, json: async () => ({ classPlayByClass: { 'c-7h': 2100, 'c-6s': 600 }, activeDaysByClass: { 'c-7h': 2, 'c-6s': 1 }, rollup: { windowDays: 7, classCount: 2, activeClasses7d: 2, inAppMinutes7d: 45 }, classAccountByClass: { 'c-7h': { started: true, journeyDone: 9, journeyTotal: 334, seedNumber: 3, lastPractisedAt: new Date().toISOString(), phrases7d: 20, minutesByDay: [0, 5, 0, 10, 10, 0, 10] }, 'c-6s': { started: true, journeyDone: 2, journeyTotal: 334, seedNumber: 1, lastPractisedAt: new Date().toISOString(), phrases7d: 40, minutesByDay: [0, 0, 0, 0, 0, 0, 10] } } }) } as any
    return { ok: true, json: async () => ({}) } as any
  }) as any
  const { useSchoolContext } = await import('@/composables/schools/useSchoolContext')
  useSchoolContext().currentUser.value = {
    user_id: 'u1', learner_id: 'l1', display_name: 'Angharad', educational_role: 'school_admin',
    platform_role: null, school_id: 's1', organization_name: 'Ysgol Cas-gwent',
  } as any
  const mod = await import('./TeacherDashboard.vue')
  const wrapper = mount(mod.default, {
    global: {
      provide: { isAdminView: false, supabase: ref({ auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) } } as any) },
      stubs: {
        BeltDot: true, Sparkline: true, UpdatedStamp: true,
        CreateClassModal: true, SchoolsPasswordPrompt: true, ClassCreatedModal: true, MailboxCheckPrompt: true,
        RouterLink: { props: ['to'], template: '<a><slot /></a>' },
      },
    },
  })
  await flushPromises()
  await flushPromises()
  return wrapper
}

beforeEach(() => { Object.keys(store).forEach(k => delete store[k]); replace.mockClear() })

describe('TeacherDashboard — the default order is time in the app this week', () => {
  it('with no ?sort on the URL the table is sorted by hours, busiest class first', async () => {
    const wrapper = await mountView()
    const table = wrapper.find('table[data-walk="classes-table"]')
    expect(table.attributes('data-sorted')).toBe('hours')
    const names = wrapper.findAll('tr[data-walk="classes-row"] .cell-name').map((el) => el.text())
    expect(names).toEqual(['7H', '6S'])
    // The default writes nothing to the URL — a shared link stays clean.
    expect(replace).not.toHaveBeenCalled()
    // Sort by still offers name, one tap away.
    const sortSelect = wrapper.find('.filter-sort').findComponent({ name: 'FrostSelect' })
    expect((sortSelect.props('options') as { value: string }[]).map((o) => o.value)).toContain('name')
  })

  it('the year-group tiles show the same minutes as the rows, not phrases', async () => {
    const wrapper = await mountView()
    const y7 = wrapper.find('[data-year-tile="year:7"]')
    const y6 = wrapper.find('[data-year-tile="year:6"]')
    expect(y7.find('[data-year-tile-minutes]').text()).toBe('35 min')
    expect(y6.find('[data-year-tile-minutes]').text()).toBe('10 min')
    expect(y7.find('.year-tile-word').text()).toBe('Y7')
  })
})
