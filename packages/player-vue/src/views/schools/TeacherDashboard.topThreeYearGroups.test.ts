/**
 * TeacherDashboard — Option A (job #306, 2026-09-12): the class table shows
 * three rows then Show all, and a row of year-group tiles sits under the
 * health strip once this week's practice has loaded. Red on the pre-change
 * page (every row rendered, no tiles), green after.
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

function cls(id: string, name: string) {
  return { id, class_name: name, course_code: 'cym_s_for_eng', school_id: 's1', teacher_user_id: 'u1', student_join_code: `J-${id}`, current_seed: 1, last_lego_id: null, class_learner_id: null, is_active: true, student_count: 0, avg_seeds_completed: 1, avg_practice_minutes: 0, created_at: '', belt_distribution: {}, activity_last_7: [0, 0, 0, 0, 0, 0, 0], journey_done: 1, journey_total: 679, teachers: [] }
}
const classes = ref([cls('c1', '7H'), cls('c2', '7O'), cls('c3', '8H'), cls('c4', '8P'), cls('c5', 'B8')])
vi.mock('@/composables/schools/useClassesData', () => ({
  useClassesData: () => ({
    classes, isLoading: ref(false), error: ref(null), classesLoaded: ref(true),
    totalStudentsInClasses: computed(() => 0),
    fetchClasses: vi.fn(async () => {}), createClass: vi.fn(), getClassReport: vi.fn(async () => null),
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

const NOW = new Date().toISOString()
const LONG_AGO = '2026-08-01T08:00:00Z'
function acct(phrases7d: number, lastPractisedAt: string | null, minutes: number) {
  return { started: !!lastPractisedAt, journeyDone: 6, journeyTotal: 679, seedNumber: 3, lastPractisedAt, phrases7d, minutesByDay: [0, 0, 0, 0, 0, 0, minutes] }
}

async function mountView() {
  globalThis.fetch = vi.fn(async (url: any) => {
    const u = String(url)
    if (u.includes('class-practice-7d')) return { ok: true, json: async () => ({
      practiceByClass: { c1: 1020, c2: 660, c3: 1140, c4: 0, c5: 0 }, activeDaysByClass: { c1: 2, c2: 1, c3: 2, c4: 0, c5: 0 },
      rollup: { windowDays: 7, classCount: 5, activeClasses7d: 3, inAppMinutes7d: 47 },
      classAccountByClass: { c1: acct(52, NOW, 17), c2: acct(34, NOW, 11), c3: acct(53, NOW, 19), c4: acct(0, LONG_AGO, 0), c5: acct(0, null, 0) },
    }) } as any
    return { ok: true, json: async () => ({}) } as any
  }) as any
  const { useSchoolContext } = await import('@/composables/schools/useSchoolContext')
  useSchoolContext().currentUser.value = {
    user_id: 'u1', learner_id: 'l1', display_name: 'Angharad', educational_role: 'school_admin',
    platform_role: null, school_id: 's1', school_name: 'Ysgol Cas-gwent',
  } as any
  const supabase = ref({ auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) } } as any)
  const mod = await import('./TeacherDashboard.vue')
  const wrapper = mount(mod.default, {
    global: {
      provide: { isAdminView: false, supabase },
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

beforeEach(() => { vi.resetModules(); Object.keys(store).forEach(k => delete store[k]) })

describe('TeacherDashboard — three rows then Show all, and year-group tiles (job #306)', () => {
  it('five classes render three rows and a Show all 5 classes control; tapping shows five, tapping again folds back', async () => {
    const w = await mountView()
    expect(w.findAll('tbody tr')).toHaveLength(3)
    const control = w.find('.table-show-all .show-all')
    expect(control.text()).toContain('Show all 5 classes')
    await control.trigger('click')
    expect(w.findAll('tbody tr')).toHaveLength(5)
    expect(w.find('.table-show-all .show-all').text()).toContain('Show fewer')
    await w.find('.table-show-all .show-all').trigger('click')
    expect(w.findAll('tbody tr')).toHaveLength(3)
  })

  it('the fold applies to the filtered, sorted result — a health filter that leaves two rows shows both, no control', async () => {
    const w = await mountView()
    const health = w.findAll('select')[1]
    await health.setValue('inactive')
    await flushPromises()
    expect(w.findAll('tbody tr')).toHaveLength(2)
    expect(w.find('.table-show-all').exists()).toBe(false)
  })

  it('year-group tiles under the strip: phrases and classes practising per year, unparsed names in Other', async () => {
    const w = await mountView()
    const tiles = w.find('[data-walk="classes-year-groups"]')
    expect(tiles.exists()).toBe(true)
    expect(tiles.attributes('data-mode')).toBe('year')
    const read = tiles.findAll('.year-tile').map((t) => [t.find('.year-tile-value').text(), t.find('.year-tile-word').text(), t.find('.year-tile-sub').text()])
    expect(read).toEqual([
      ['86', 'Year 7', '2 of 2 classes'],
      ['53', 'Year 8', '1 of 2 classes'],
      ['—', 'Other', 'none of 1 yet'],
    ])
  })
})
