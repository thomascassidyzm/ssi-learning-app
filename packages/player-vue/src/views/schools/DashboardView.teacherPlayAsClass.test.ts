/**
 * DashboardView — the TEACHER home reads play-as-class, never the pupils'
 * aggregate (job #651, Ysgol Cas-gwent Chepstow, 2026-09-14).
 *
 * The school wrote in: "some teachers say 0 minutes, yet they screenshot and
 * it says they have done some." Teacher florencecotten, class 10C: her home
 * read "One class on the go, 0 students across it", benchmarks 0c, and a
 * footer of "0 students · 0 min practised · 0 sessions" — every figure summed
 * off the pupils' individual accounts (class_activity_stats), which in a
 * class taught from the front is always zero. Meanwhile her Library said
 * 12 minutes: her Wednesday lesson had run on her OWN account, not the
 * class's.
 *
 * Red on the pre-#651 code (students/benchmarks/sessions, no own-account
 * line); green after. Mounts the real SFC with a teacher persona and one
 * class, and feeds the SAME payload the classes list and leader pages read.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
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
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useRoute: () => ({ name: 'schools-dashboard', path: '/schools', params: {}, query: {} }),
  RouterLink: { name: 'RouterLink', props: ['to'], template: '<a><slot /></a>' },
}))

const CLASS_10C = {
  id: '5382a091-a94e-48a3-a706-adc32106b7e8', class_name: '10C', course_code: 'cym_s_for_eng',
  school_id: '0f5bd6e4-f40b-4dbf-ac4f-a93478d20255', teacher_user_id: '42666839-f7b5-44fd-aca7-6ebf8cca1b3d',
  student_join_code: 'EKA-766', current_seed: 1, last_lego_id: 'S0001L01', class_learner_id: 'a7c4d1cf-906f-41b3-89a8-07d2fc89d115', is_active: true, created_at: '2026-09-03T15:42:58Z',
}

// A fake PostgREST client: the classes table carries 10C, class_teachers
// says the teacher teaches it, and every other table is empty — so the pupil
// spine (class_student_progress) has nothing, exactly like Chepstow.
function fakeClient() {
  const rowsFor = (table: string): any[] => {
    if (table === 'classes') return [CLASS_10C]
    if (table === 'class_teachers') return [{ class_id: CLASS_10C.id, teacher_user_id: CLASS_10C.teacher_user_id }]
    return []
  }
  const chainFor = (table: string): any => new Proxy({}, {
    get(_t, prop) {
      if (prop === 'then') return (r: any) => Promise.resolve({ data: rowsFor(table), error: null }).then(r)
      return () => chainFor(table)
    },
  })
  return {
    from: (table: string) => chainFor(table),
    auth: { getSession: vi.fn(async () => ({ data: { session: { access_token: 'tok' } } })) },
  } as any
}

const TEACHER = {
  user_id: CLASS_10C.teacher_user_id,
  learner_id: 'ca7ca8d4-d863-405e-a888-4f6fe6186805',
  display_name: 'florencecotten',
  educational_role: 'teacher' as const,
  platform_role: null,
  school_id: CLASS_10C.school_id,
  school_name: 'Ysgol Cas-gwent Chepstow School',
  _scopeSource: 'self' as const,
}

// What /api/school/class-practice-7d says for 10C in the week of 2026-09-14:
// the class account played 9 minutes (Mon 14th), 7 phrases, 8 LEGOs; no pupil
// played on an own account (practiceByClass is the pupils' aggregate, job
// #662); the teacher's OWN account carries 12 minutes, last on Wednesday the 9th.
const PRACTICE = {
  practiceByClass: { [CLASS_10C.id]: 0 },
  classPlayByClass: { [CLASS_10C.id]: 540 },
  audioPlayedByClass: { [CLASS_10C.id]: 0 },
  activeDaysByClass: { [CLASS_10C.id]: 1 },
  rollup: { windowDays: 7, classCount: 1, activeClasses7d: 1, inAppMinutes7d: 21 },
  classAccountByClass: {
    [CLASS_10C.id]: { started: true, journeyDone: 8, journeyTotal: 1200, seedNumber: 8, lastPractisedAt: '2026-09-09T08:01:11Z', phrases7d: 7, minutesByDay: [0, 0, 0, 0, 0, 0, 9] },
  },
  callerOwn: { learnerId: TEACHER.learner_id, inAppMinutes7d: 12, minutesByDay: [0, 0, 12, 0, 0, 0, 0], lastPlayedDay: '2026-09-09' },
}

let practiceCalls: string[] = []

async function mountTeacherHome(opts: { practice?: any; practiceStatus?: number } = {}) {
  practiceCalls = []
  globalThis.fetch = vi.fn(async (url: any) => {
    const u = String(url)
    if (u.includes('class-practice-7d')) {
      practiceCalls.push(u)
      if (opts.practiceStatus && opts.practiceStatus !== 200) return { ok: false, status: opts.practiceStatus, json: async () => ({ error: 'boom' }) } as any
      return { ok: true, json: async () => (opts.practice ?? PRACTICE) } as any
    }
    return { ok: true, json: async () => ({}) } as any
  }) as any

  const { setSchoolsClient } = await import('@/composables/schools/client')
  setSchoolsClient(fakeClient())
  const { useSchoolContext } = await import('@/composables/schools/useSchoolContext')
  useSchoolContext().currentUser.value = { ...TEACHER } as any

  const mod = await import('./DashboardView.vue')
  const wrapper = mount(mod.default, {
    global: {
      provide: { isAdminView: false, supabase: { value: fakeClient() } },
      stubs: {
        Greeting: { props: ['name', 'lines'], template: '<div><h1>{{ name }}</h1><p>{{ lines }}</p><slot name="action" /></div>' },
        BeltDot: true, InviteLinkField: true,
        UpdatedStamp: true, CreateClassModal: true, ClassCreatedModal: true, SchoolsPasswordPrompt: true, MailboxCheckPrompt: true,
        RouterLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
      },
    },
  })
  await flushPromises()
  await flushPromises()
  await flushPromises()
  return wrapper
}

describe('DashboardView — the teacher home is play-as-class first (job #651)', () => {
  beforeEach(() => {
    vi.resetModules()
    Object.keys(store).forEach(k => delete store[k])
  })
  afterEach(() => { vi.restoreAllMocks() })

  it('a class row carries the CLASS ACCOUNT\'s minutes, phrases, LEGOs and last-played day — never a pupil count or a cycles benchmark', async () => {
    const wrapper = await mountTeacherHome()
    const text = wrapper.text()
    expect(text).toContain('Welcome back, florencecotten.')
    expect(text).toContain('One class on the go. 9 min in the app this week.')
    expect(text).toContain('10C')
    expect(text).toContain('9 min')
    expect(text).toContain('7 phrases')
    expect(text).toContain('8/1200 LEGOs')
    expect(text).toContain('Last played Wed 9 Sept')
    // The pupils' aggregate is gone from the class row and the footer.
    expect(text).not.toContain('students across it')
    expect(text).not.toContain('0 students')
    expect(text).not.toContain('Benchmarks')
    expect(text).not.toContain('sessions')
    // No pupil played on an own account: the second figure says so in words
    // rather than hiding (Tom, 2026-09-14, job #662).
    expect(text).toContain('Nothing on pupils’ own accounts this week')
    expect(text).toContain('nothing on pupils’ own accounts')
    // The footer totals are this week's class play.
    expect(text).toContain('in the app this week')
    expect(text).toContain('phrases practised')
    // One fetch, the same endpoint the classes list and the leader pages read.
    expect(practiceCalls.length).toBe(1)
    expect(practiceCalls[0]).toContain(`class_ids=${CLASS_10C.id}`)
  })

  it('names the teacher\'s OWN practice as hers, not the class\'s, and points at Play as class', async () => {
    const wrapper = await mountTeacherHome()
    const line = wrapper.find('[data-walk="dash-own-practice"]')
    expect(line.exists()).toBe(true)
    expect(line.text()).toContain('You practised 12 min on your own account this week, last on Wed 9 Sept.')
    expect(line.text()).toContain('Use Play as class')
  })

  it('a quiet own account draws no line — its absence means nothing went astray', async () => {
    const wrapper = await mountTeacherHome({ practice: { ...PRACTICE, callerOwn: { ...PRACTICE.callerOwn, inAppMinutes7d: 0, lastPlayedDay: null } } })
    expect(wrapper.find('[data-walk="dash-own-practice"]').exists()).toBe(false)
    expect(wrapper.find('[data-walk="dash-playing-as-yourself"]').exists()).toBe(false)
  })

  // Tom, 2026-09-14 13:07Z (job #662): "a warning across the dashboard
  // navigation? You are now playing as yourself. If you want to play as class
  // please go here." — in his words, across the top of the teacher home, the
  // link taking her to her classes. Red before the banner existed.
  it('when her own account has practised this week, the warning sits across the top in Tom\'s words and links to her classes', async () => {
    const wrapper = await mountTeacherHome()
    const banner = wrapper.find('[data-walk="dash-playing-as-yourself"]')
    expect(banner.exists()).toBe(true)
    expect(banner.text()).toContain('You are now playing as yourself. If you want to play as class please go here.')
    expect(banner.find('a').attributes('href')).toBe('/schools/classes')
    // It comes before the welcome, not after the classes.
    const html = wrapper.html()
    expect(html.indexOf('dash-playing-as-yourself')).toBeLessThan(html.indexOf('Welcome back'))
  })

  // TWO FIGURES, KEPT APART, NEVER SUMMED (Tom, 2026-09-14, job #662). Red on
  // the #651 code, which read the summed practiceByClass into the class row
  // and showed 14 min; green after.
  it('the class row carries the class account\'s minutes and, apart from them, the pupils\' own-account minutes — never their sum', async () => {
    const { useClassesData } = await import('@/composables/schools/useClassesData')
    const wrapper = await mountTeacherHome({ practice: { ...PRACTICE, practiceByClass: { [CLASS_10C.id]: 300 } } })
    // Two pupils signed in themselves for 5 minutes between them.
    useClassesData().classes.value = [{ ...(useClassesData().classes.value[0] as any), student_count: 2 }]
    await flushPromises()
    const text = wrapper.text()
    expect(text).toContain('One class on the go. 9 min in the app this week.')
    expect(wrapper.find('[data-walk="dash-class-week-pupils"]').text()).toBe('pupils’ own accounts 5 min')
    expect(text).toContain('2 pupils on their own accounts · 5 min on those accounts this week')
    expect(text).not.toContain('14 min')
  })

  it('a practice fetch that failed says so and shows no minutes — never a 0 that is not real', async () => {
    const wrapper = await mountTeacherHome({ practiceStatus: 403 })
    const text = wrapper.text()
    expect(text).toContain("Couldn't load this week's practice")
    expect(text).toContain('One class on the go.')
    expect(text).not.toContain('0 min in the app this week')
    expect(text).not.toContain('Not started')
  })
})
