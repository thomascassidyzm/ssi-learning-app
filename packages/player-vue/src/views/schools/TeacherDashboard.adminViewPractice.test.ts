/**
 * TeacherDashboard — under View-as / the admin read-view the class-practice
 * fetch names the school being read, so the admin's empty scope cannot paint
 * "0 min in the app this week" for 34 classes as if that were true (job #265,
 * 2026-09-11, seen on staging under View-as Angharad). Red before, green after.
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
  { id: 'c-7h', class_name: '7H', course_code: 'cym_s_for_eng', school_id: 's1', teacher_user_id: 'u1', student_join_code: 'ABC123', current_seed: 3, last_lego_id: null, class_learner_id: null, is_active: true, student_count: 0, avg_seeds_completed: 3, avg_practice_minutes: 0, created_at: '', belt_distribution: {}, activity_last_7: [0, 1, 0, 1, 1, 0, 0], journey_done: 3, journey_total: 334, teachers: [] },
])
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

const calls: string[] = []

async function mountView(scopeSource: 'self' | 'admin-view') {
  calls.length = 0
  globalThis.fetch = vi.fn(async (url: any) => {
    const u = String(url)
    calls.push(u)
    if (u.includes('class-practice-7d')) return { ok: true, json: async () => ({ practiceByClass: { 'c-7h': 2100 }, activeDaysByClass: { 'c-7h': 2 }, rollup: { windowDays: 7, classCount: 1, activeClasses7d: 1, inAppMinutes7d: 35 }, classAccountByClass: { 'c-7h': { started: true, journeyDone: 6, journeyTotal: 679, seedNumber: 3, lastPractisedAt: new Date().toISOString(), phrases7d: 53, minutesByDay: [0, 0, 0, 0, 10, 0, 25] } } }) } as any
    return { ok: true, json: async () => ({}) } as any
  }) as any
  const { useSchoolContext } = await import('@/composables/schools/useSchoolContext')
  useSchoolContext().currentUser.value = {
    user_id: 'u1', learner_id: 'l1', display_name: 'Angharad', educational_role: 'school_admin',
    platform_role: null, school_id: 's1', school_name: 'Ysgol Cas-gwent', _scopeSource: scopeSource,
  } as any
  const supabase = ref({ auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) } } as any)
  const mod = await import('./TeacherDashboard.vue')
  const wrapper = mount(mod.default, {
    global: {
      provide: { isAdminView: scopeSource === 'admin-view', supabase },
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

describe('TeacherDashboard — class practice under the admin read-view (job #265)', () => {
  it('names the school being read when the scope source is admin-view, and the minutes then paint', async () => {
    const wrapper = await mountView('admin-view')
    const practice = calls.filter(u => u.includes('class-practice-7d'))
    expect(practice.length).toBe(1)
    expect(practice[0]).toContain('school_id=s1')
    expect(practice[0]).toContain('class_ids=c-7h')
    expect(wrapper.text()).toContain('35 min')
    expect(wrapper.text()).not.toMatch(/\b\d+(\.\d+)?h\b/)
    // The row is the CLASS ACCOUNT's own progress: its journey in LEGOs, no pupil count.
    expect(wrapper.text()).toContain('6 / 679')
    expect(wrapper.text()).not.toContain('Students')
  })

  it('a leader on their own session sends no school_id — their own scope is the truth', async () => {
    await mountView('self')
    const practice = calls.filter(u => u.includes('class-practice-7d'))
    expect(practice.length).toBe(1)
    expect(practice[0]).not.toContain('school_id=')
  })
})
