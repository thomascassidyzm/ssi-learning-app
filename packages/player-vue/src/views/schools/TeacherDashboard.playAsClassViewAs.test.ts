/**
 * TeacherDashboard — Play as class on the classes list row (job #683).
 *
 * Tom, 2026-09-14 16:17Z, touring staging under View As: "every single Play
 * as Class button has GONE!!!! That should be prominent next to the class,
 * not invisible". The 2026-07-16 gate (`canPlayAsClass = staff && !isAdminView`)
 * hid the row button under View As. Now it is present for a signed-in leader
 * and present-but-disabled under View As. Red on the old gate, green after.
 * Also pins the relabel: the column is a seven-day TOTAL, so its header no
 * longer reads "min/wk" (rates were ruled out in job #673).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref, computed } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'

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
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), currentRoute: { value: { query: {} } } }),
  useRoute: () => ({ name: 'classes', path: '/schools/classes', params: {}, query: {} }),
  RouterLink: { name: 'RouterLink', props: ['to'], template: '<a><slot /></a>' },
}))

const classes = ref([
  { id: 'c-7h', class_name: '7H', course_code: 'cym_s_for_eng', school_id: 's1', teacher_user_id: 'u1', student_join_code: 'ABC123', current_seed: 3, last_lego_id: null, class_learner_id: null, is_active: true, student_count: 0, avg_seeds_completed: 3, avg_practice_minutes: 0, created_at: '', belt_distribution: {}, activity_last_7: [0, 1, 0, 1, 1, 0, 0], journey_done: 3, journey_total: 334, teachers: [] },
])
vi.mock('@/composables/schools/useClassesData', () => ({
  useClassesData: () => ({
    classes, isLoading: ref(false), error: ref(null), classesLoaded: ref(true),
    totalStudentsInClasses: computed(() => 0),
    fetchClasses: vi.fn(async () => {}), createClass: vi.fn(), getClassReport: vi.fn(async () => null),
  }),
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

async function mountView(isAdminView: boolean) {
  globalThis.fetch = vi.fn(async (url: any) => {
    const u = String(url)
    if (u.includes('class-practice-7d')) return { ok: true, json: async () => ({ classPlayByClass: { 'c-7h': 25 }, activeDaysByClass: { 'c-7h': 1 }, rollup: { windowDays: 7, classCount: 1, activeClasses7d: 1, inAppMinutes7d: 1 }, classAccountByClass: { 'c-7h': { started: true, journeyDone: 6, journeyTotal: 679, seedNumber: 3, lastPractisedAt: new Date().toISOString(), phrases7d: 2, minutesByDay: [0, 0, 0, 0, 0, 0, 1] } } }) } as any
    return { ok: true, json: async () => ({}) } as any
  }) as any
  const { useSchoolContext } = await import('@/composables/schools/useSchoolContext')
  useSchoolContext().currentUser.value = {
    user_id: 'u1', learner_id: 'l1', display_name: 'Angharad', educational_role: 'school_admin',
    platform_role: null, school_id: 's1', school_name: 'Ysgol Cas-gwent', _scopeSource: isAdminView ? 'admin-view' : 'self',
  } as any
  const supabase = ref({ auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) } } as any)
  const mod = await import('./TeacherDashboard.vue')
  const wrapper = mount(mod.default, {
    global: {
      provide: { isAdminView, supabase },
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

beforeEach(() => { vi.resetModules(); Object.keys(store).forEach(k => delete store[k]) })

describe('TeacherDashboard — Play as class beside every class (job #683)', () => {
  it('a signed-in school leader gets a live Play as class button on the row', async () => {
    const wrapper = await mountView(false)
    const btn = wrapper.find('[data-walk="classes-row-play"]')
    expect(btn.exists()).toBe(true)
    expect(btn.attributes('disabled')).toBeUndefined()
  })

  it('under View As the button stays on the row, disabled, and says why', async () => {
    const wrapper = await mountView(true)
    const btn = wrapper.find('[data-walk="classes-row-play"]')
    expect(btn.exists()).toBe(true)
    expect(btn.attributes('disabled')).toBeDefined()
    expect(btn.attributes('title')).toContain('Read only while you are viewing as someone else')
  })

  it('the time column is a total for the week, never a rate, and 25 seconds reads 1 min', async () => {
    const wrapper = await mountView(false)
    expect(wrapper.text()).not.toContain('min/wk')
    expect(wrapper.text()).toContain('Played as class, this week')
    const cell = wrapper.find('tbody td[data-label="Played as class, this week"]')
    expect(cell.text()).toBe('1 min')
  })
})
