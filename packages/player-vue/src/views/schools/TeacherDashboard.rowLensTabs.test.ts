/**
 * TeacherDashboard — the Class Summary Row carries an explicit Overview |
 * Insights pair.
 *
 * Tom, 2026-09-17, reviewing the live row: "it's not clear that clicking
 * anywhere in this row takes you to Overview". The fix reuses the SAME
 * LensTabs segmented pair the class page header already wears (no new word,
 * no "STATS") rather than forking a new control. Row-click-anywhere still
 * goes to Overview; the pair's own click stops propagation so tapping
 * Insights doesn't also fire the row's click handler.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ref, computed } from 'vue'
import LensTabs from '@/components/admin/LensTabs.vue'

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

const push = vi.fn()
vi.mock('vue-router', () => ({
  useRouter: () => ({ push, replace: vi.fn(), currentRoute: ref({ query: {} }) }),
  useRoute: () => ({ name: 'classes', path: '/schools/classes', params: {}, query: {} }),
  RouterLink: { name: 'RouterLink', props: ['to'], template: '<a :href="to"><slot /></a>' },
}))

const classes = ref([
  { id: 'c-7h', class_name: '7H', course_code: 'cym_s_for_eng', school_id: 's1', teacher_user_id: 'u1', student_join_code: 'ABC123', current_seed: 3, last_lego_id: null, class_learner_id: null, is_active: true, student_count: 24, avg_seeds_completed: 3, avg_practice_minutes: 0, created_at: '', belt_distribution: {}, activity_last_7: [0, 1, 0, 1, 1, 0, 0], journey_done: 3, journey_total: 334, teachers: [] },
])
vi.mock('@/composables/schools/useClassesData', () => ({
  useClassesData: () => ({
    classes,
    isLoading: ref(false),
    error: ref(null),
    classesLoaded: ref(true),
    totalStudentsInClasses: computed(() => 24),
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

async function mountView(role: 'school_admin' | 'teacher') {
  globalThis.fetch = vi.fn(async (url: any) => {
    const u = String(url)
    if (u.includes('class-practice-7d')) return { ok: true, json: async () => ({ classPlayByClass: { 'c-7h': 2100 }, activeDaysByClass: { 'c-7h': 2 }, rollup: { windowDays: 7, classCount: 1, activeClasses7d: 1, inAppMinutes7d: 35 }, classAccountByClass: { 'c-7h': { started: true, journeyDone: 9, journeyTotal: 334, seedNumber: 3, lastPractisedAt: new Date().toISOString(), phrases7d: 20, minutesByDay: [0, 5, 0, 10, 10, 0, 10] } } }) } as any
    return { ok: true, json: async () => ({}) } as any
  }) as any
  const { useSchoolContext } = await import('@/composables/schools/useSchoolContext')
  useSchoolContext().currentUser.value = {
    user_id: 'u1', learner_id: 'l1', display_name: 'Angharad', educational_role: role,
    platform_role: null, school_id: 's1', organization_name: 'Ysgol Cas-gwent',
  } as any
  const mod = await import('./TeacherDashboard.vue')
  const wrapper = mount(mod.default, {
    global: {
      provide: { isAdminView: false, supabase: ref({ auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) } } as any) },
      stubs: {
        BeltDot: true, Sparkline: true, UpdatedStamp: true,
        CreateClassModal: true, SchoolsPasswordPrompt: true, ClassCreatedModal: true, MailboxCheckPrompt: true,
      },
    },
  })
  await flushPromises()
  await flushPromises()
  return wrapper
}

beforeEach(() => { Object.keys(store).forEach(k => delete store[k]); push.mockClear() })

describe('TeacherDashboard — the row wears the class page header\'s Overview | Insights pair', () => {
  it('a school_admin row points Overview at the class node home and Insights at its /insights page', async () => {
    const wrapper = await mountView('school_admin')
    const row = wrapper.find('tr[data-walk="classes-row"]')
    const lens = row.findComponent(LensTabs)
    expect(lens.exists()).toBe(true)
    expect(lens.props('overviewPath')).toBe('/org/c-7h')
    expect(lens.props('insightsPath')).toBe('/org/c-7h/insights')
    expect(lens.props('current')).toBe('overview')
  })

  it('a plain teacher (not a leader) gets the teacher-scoped analytics tool for Insights', async () => {
    const wrapper = await mountView('teacher')
    const row = wrapper.find('tr[data-walk="classes-row"]')
    const lens = row.findComponent(LensTabs)
    expect(lens.props('insightsPath')).toBe('/schools/analytics?class=c-7h')
  })

  it('clicking the Insights tab does not also fire the row\'s own click-to-Overview handler', async () => {
    const wrapper = await mountView('school_admin')
    const row = wrapper.find('tr[data-walk="classes-row"]')
    const insightsLink = row.find('[data-lens-tab="insights"]')
    expect(insightsLink.exists()).toBe(true)
    await insightsLink.trigger('click')
    // The row's own click handler pushes via schoolsLink('class-detail', ...)
    // to the SAME /org/c-7h path — asserting push was never called proves the
    // row handler didn't ALSO fire (LensTabs' own router-link is stubbed, so
    // no navigation of its own reaches `push`).
    expect(push).not.toHaveBeenCalled()
  })
})
