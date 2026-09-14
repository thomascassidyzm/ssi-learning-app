/**
 * TeacherDashboard — no grading (Tom's ruling, 2026-09-13, job #494): "We
 * don't make any attributions to any class performance. The school admin
 * wants time in app. And that's basically it." Red on the pre-change page
 * (Excellent / Good / Needs eyes tiles, a Health picker, a health column),
 * green after: the page carries the minutes headline and nothing that grades.
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
const classes = ref([cls('c1', '7H'), cls('c2', '7O'), cls('c3', '8H')])
vi.mock('@/composables/schools/useClassesData', () => ({
  useClassesData: () => ({
    classes, isLoading: ref(false), error: ref(null), classesLoaded: ref(true),
    totalStudentsInClasses: computed(() => 0),
    fetchClasses: vi.fn(async () => {}), createClass: vi.fn(), getClassReport: vi.fn(async () => null),
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

const NOW = new Date().toISOString()
function acct(phrases7d: number, lastPractisedAt: string | null, minutes: number) {
  return { started: !!lastPractisedAt, journeyDone: 6, journeyTotal: 679, seedNumber: 3, lastPractisedAt, phrases7d, minutesByDay: [0, 0, 0, 0, 0, 0, minutes] }
}

async function mountView() {
  globalThis.fetch = vi.fn(async (url: any) => {
    const u = String(url)
    if (u.includes('class-practice-7d')) return { ok: true, json: async () => ({
      // One busy class, one quiet class, one that has never played: on the old
      // page these read Excellent, Needs attention and Inactive.
      classPlayByClass: { c1: 3000, c2: 60, c3: 0 }, activeDaysByClass: { c1: 5, c2: 1, c3: 0 },
      rollup: { windowDays: 7, classCount: 3, activeClasses7d: 2, inAppMinutes7d: 51 },
      classAccountByClass: { c1: acct(52, NOW, 50), c2: acct(3, NOW, 1), c3: acct(0, null, 0) },
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

describe('TeacherDashboard grades nothing (job #494)', () => {
  it('no grade word, no health dot, no health picker or column; the minutes headline survives', async () => {
    const w = await mountView()
    const text = w.text()
    for (const word of ['Excellent', 'Needs attention', 'Needs eyes', 'Inactive', 'Health']) {
      expect(text, `page still says "${word}"`).not.toContain(word)
    }
    expect(w.find('.health-dot').exists()).toBe(false)
    expect(w.find('health-dot-stub').exists()).toBe(false)
    expect(w.find('.summary-strip').exists()).toBe(false)
    // Course and Sort by are the only pickers left.
    expect(w.findAllComponents({ name: 'FrostSelect' })).toHaveLength(2)
    expect(w.findAll('select')).toHaveLength(0)
    expect(w.findAll('thead th').map(th => th.text())).not.toContain('Health')
    // Time in app is the figure the page is for, and it is still there.
    expect(w.find('.page-subtitle').text()).toContain('3 classes across Ysgol Cas-gwent')
    expect(w.find('.page-subtitle').text()).toMatch(/in the app this week/)
    // The never-played class still says so in words: a fact, not a grade.
    expect(w.findAll('tbody tr')[2].text()).toContain('Not started')
  })
})
