/**
 * TeacherDashboard — the classes table at phone width.
 *
 * On a 390px phone the table was a 760px-wide scroller with Time in app,
 * Activity, Health and Share off the right edge and no cue (job #259 on
 * staging, 2026-09-11), so "sort the classes by minutes" — Tom's whole answer
 * to the league-table question — was unreachable on the device an admin
 * actually carries. The template now marks the sorted metric cell so the
 * phone stylesheet can pin it beside the class name, and labels every other
 * cell with its column name so the stacked card reads without a header row.
 * This pins the markup the stylesheet relies on.
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

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), currentRoute: ref({ query: {} }) }),
  useRoute: () => ({ name: 'classes', params: {}, query: {} }),
  RouterLink: { name: 'RouterLink', props: ['to'], template: '<a><slot /></a>' },
}))

const classes = ref([
  { id: 'c-7h', class_name: '7H', course_code: 'cym_s_for_eng', school_id: 's1', teacher_user_id: 'u1', student_join_code: 'ABC123', current_seed: 3, last_lego_id: null, class_learner_id: null, is_active: true, student_count: 24, avg_seeds_completed: 3, avg_practice_minutes: 0, created_at: '', belt_distribution: {}, activity_last_7: [0, 1, 0, 1, 1, 0, 0], journey_done: 3, journey_total: 334, teachers: [] },
  { id: 'c-6s', class_name: '6S', course_code: 'cym_s_for_eng', school_id: 's1', teacher_user_id: 'u1', student_join_code: 'DEF456', current_seed: 1, last_lego_id: null, class_learner_id: null, is_active: true, student_count: 18, avg_seeds_completed: 1, avg_practice_minutes: 0, created_at: '', belt_distribution: {}, activity_last_7: [0, 0, 0, 0, 0, 0, 0], journey_done: 1, journey_total: 334, teachers: [] },
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
  usePlayAsClass: () => ({ canPlayAsClass: computed(() => true), launchClassSession: vi.fn(), playError: ref(null), switchActiveCourseTo: vi.fn() }),
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
  // The class-practice payload the rows read (job #265): without it a row
  // shows "…" — honestly unloaded — so this pins the loaded shape.
  globalThis.fetch = vi.fn(async (url: any) => {
    const u = String(url)
    if (u.includes('class-practice-7d')) return { ok: true, json: async () => ({ practiceByClass: { 'c-7h': 2100, 'c-6s': 600 }, activeDaysByClass: { 'c-7h': 2, 'c-6s': 1 }, rollup: { windowDays: 7, classCount: 2, activeClasses7d: 2, inAppMinutes7d: 45 }, classAccountByClass: { 'c-7h': { started: true, journeyDone: 9, journeyTotal: 334, seedNumber: 3, lastPractisedAt: new Date().toISOString(), phrases7d: 20, minutesByDay: [0, 5, 0, 10, 10, 0, 10] }, 'c-6s': { started: true, journeyDone: 2, journeyTotal: 334, seedNumber: 1, lastPractisedAt: new Date().toISOString(), phrases7d: 4, minutesByDay: [0, 0, 0, 0, 0, 0, 10] } } }) } as any
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
        BeltDot: true, HealthDot: true, Sparkline: true, UpdatedStamp: true,
        CreateClassModal: true, SchoolsPasswordPrompt: true, ClassCreatedModal: true, MailboxCheckPrompt: true,
        RouterLink: { props: ['to'], template: '<a><slot /></a>' },
      },
    },
  })
  await flushPromises()
  await flushPromises()
  return wrapper
}

beforeEach(() => { Object.keys(store).forEach(k => delete store[k]) })

describe('TeacherDashboard — the sorted metric is reachable on a phone', () => {
  it('labels every metric cell and pins the time-in-app cell when sorting by it', async () => {
    const wrapper = await mountView()
    const rows = wrapper.findAll('table[data-walk="classes-table"] tbody tr')
    expect(rows.length).toBe(2)

    const sortSelect = wrapper.find('.filter-sort select')
    expect(wrapper.find('.filter-sort .filter-label').text()).toBe('Sort by')
    await sortSelect.setValue('hours')
    await flushPromises()

    const table = wrapper.find('table[data-walk="classes-table"]')
    expect(table.attributes('data-sorted')).toBe('hours')
    const pinned = wrapper.findAll('tbody td.is-sorted')
    expect(pinned.length).toBe(2)
    expect(pinned[0].attributes('data-label')).toBe('Time in app, min/wk')
    expect(pinned[0].text()).toMatch(/ min$/)

    const labelled = wrapper.findAll('tbody tr:first-child td[data-label]').map(td => td.attributes('data-label'))
    expect(labelled).toEqual(['Course', 'Belt', 'Journey, LEGOs', 'Time in app, min/wk', 'Activity', 'Health'])
  })

  it('sorting by name still pins time in app, the school metric', async () => {
    const wrapper = await mountView()
    expect(wrapper.find('table[data-walk="classes-table"]').attributes('data-sorted')).toBe('hours')
    await wrapper.find('.filter-sort select').setValue('journey')
    expect(wrapper.find('table[data-walk="classes-table"]').attributes('data-sorted')).toBe('journey')
    expect(wrapper.find('tbody td.is-sorted').attributes('data-label')).toBe('Journey, LEGOs')
  })
})
