/**
 * TeacherDashboard — MY CLASSES IS THE TEACHER'S HOME (Tom's ruling,
 * 2026-09-16: "Dashboard and My Classes become one page called My Classes —
 * the Welcome back, <name> line and the this-week summary sit above the
 * classes table; the old Dashboard route redirects").
 *
 * This file is the teacher half of DashboardView.teacherPlayAsClass.test.ts,
 * moved with the capabilities it guards. It keeps the Chepstow evidence that
 * made those figures play-as-class in the first place (job #651): teacher
 * florencecotten, class 10C, whose home read "0 students, 0 min" because
 * every figure was summed off pupils' individual accounts, while her Library
 * said 12 minutes — her Wednesday lesson had run on her OWN account.
 *
 * Red on the pre-fold code, where TeacherDashboard carried no greeting, no
 * own-practice line and no teaching totals; green after.
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
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), currentRoute: { value: { query: {} } } }),
  useRoute: () => ({ name: 'classes', path: '/schools/classes', params: {}, query: {} }),
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

async function mountMyClasses(opts: { practice?: any; practiceStatus?: number; isAdminView?: boolean } = {}) {
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

  const mod = await import('./TeacherDashboard.vue')
  const wrapper = mount(mod.default, {
    global: {
      provide: { isAdminView: !!opts.isAdminView, supabase: { value: fakeClient() } },
      stubs: {
        Greeting: { props: ['name', 'lines', 'date'], template: '<div><h1>{{ name }}</h1><p>{{ lines }}</p><slot name="action" /></div>' },
        BeltDot: true, Sparkline: true, FrostSelect: true, YearGroupTiles: true, ShowAll: true, WalkOffer: true,
        UpdatedStamp: true, CreateClassModal: true, ClassCreatedModal: true, SchoolsPasswordPrompt: true, MailboxCheckPrompt: true,
        RouterLink: { props: ['to'], template: '<a><slot /></a>' },
      },
    },
  })
  await flushPromises()
  await flushPromises()
  await flushPromises()
  return wrapper
}

describe('TeacherDashboard — the dashboard folded into My Classes (Tom, 2026-09-16)', () => {
  beforeEach(() => {
    vi.resetModules()
    Object.keys(store).forEach(k => delete store[k])
  })
  afterEach(() => { vi.restoreAllMocks() })

  it('greets the teacher by name above the table, with this week summarised', async () => {
    const wrapper = await mountMyClasses()
    const text = wrapper.text()
    expect(text).toContain('Welcome back, florencecotten.')
    expect(text).toContain('One class on the go. 9 min in the app this week.')
    // The page is still My Classes, and the table is still the class's own
    // account: minutes, phrases and journey, never a pupil count.
    expect(text).toContain('My Classes')
    expect(text).toContain('10C')
    expect(text).toContain('9 min')
    expect(text).not.toContain('0 students')
    // One fetch, the same endpoint the leader pages read.
    expect(practiceCalls.length).toBeGreaterThanOrEqual(1)
    expect(practiceCalls[0]).toContain(`class_ids=${CLASS_10C.id}`)
  })

  it('totals the teaching week under the table, with the pupils own accounts kept apart', async () => {
    const wrapper = await mountMyClasses()
    const stats = wrapper.find('[data-walk="dash-teacher-stats"]')
    expect(stats.exists()).toBe(true)
    expect(stats.text()).toContain('1 class')
    expect(stats.text()).toContain('9 min')
    expect(stats.text()).toContain('in the app this week')
    expect(stats.text()).toContain('7')
    expect(stats.text()).toContain('phrases practised')
    // No pupil played on an own account: the second line says so in words
    // rather than hiding (Tom, 2026-09-14, job #662).
    const own = wrapper.find('[data-walk="dash-teacher-own-accounts"]')
    expect(own.exists()).toBe(true)
    expect(own.text()).toContain('Nothing on pupils’ own accounts this week')
  })

  it('names the teacher\'s OWN practice as hers, not the class\'s, and points at Play as class', async () => {
    const wrapper = await mountMyClasses()
    const line = wrapper.find('[data-walk="dash-own-practice"]')
    expect(line.exists()).toBe(true)
    expect(line.text()).toContain('You practised 12 min on your own account this week, last on Wed 9 Sept.')
    expect(line.text()).toContain('Use Play as class')
  })

  it('a quiet own account draws no line — its absence means nothing went astray', async () => {
    const wrapper = await mountMyClasses({ practice: { ...PRACTICE, callerOwn: { ...PRACTICE.callerOwn, inAppMinutes7d: 0, lastPlayedDay: null } } })
    expect(wrapper.find('[data-walk="dash-own-practice"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('You are now playing as yourself')
  })

  // TWO FIGURES, KEPT APART, NEVER SUMMED (Tom, 2026-09-14, job #662).
  it('totals the pupils own-account minutes apart from the classes own play — never their sum', async () => {
    const { useClassesData } = await import('@/composables/schools/useClassesData')
    const wrapper = await mountMyClasses({ practice: { ...PRACTICE, practiceByClass: { [CLASS_10C.id]: 300 } } })
    // Two pupils signed in themselves for 5 minutes between them.
    useClassesData().classes.value = [{ ...(useClassesData().classes.value[0] as any), student_count: 2 }]
    await flushPromises()
    const text = wrapper.text()
    expect(text).toContain('One class on the go. 9 min in the app this week.')
    expect(text).toContain('2 pupils on their own accounts · 5 min on those accounts this week')
    expect(text).not.toContain('14 min')
  })

  // Tom, 2026-09-14 16:17Z: "every single Play as Class button has GONE!!!!
  // That should be prominent next to the class". Present and enabled for a
  // teacher; present and DISABLED under View As, never hidden.
  it('Play as class is present and enabled beside the class for a signed-in teacher', async () => {
    const wrapper = await mountMyClasses()
    const btn = wrapper.find('[data-walk="classes-row-play"]')
    expect(btn.exists()).toBe(true)
    expect(btn.attributes('disabled')).toBeUndefined()
  })

  it('under View As the button is still there beside the class, disabled and saying why', async () => {
    const wrapper = await mountMyClasses({ isAdminView: true })
    const btn = wrapper.find('[data-walk="classes-row-play"]')
    expect(btn.exists()).toBe(true)
    expect(btn.attributes('disabled')).toBeDefined()
    expect(btn.attributes('title')).toContain('Read only while you are viewing as someone else')
  })

  // A leader reading this same page as Classes keeps the plain head: the
  // greeting and the teaching totals are the TEACHER's, and no leader page
  // changed shape when the dashboard folded.
  it('a school leader reading the same page gets no greeting and no teaching totals', async () => {
    const { setSchoolsClient } = await import('@/composables/schools/client')
    setSchoolsClient(fakeClient())
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => PRACTICE })) as any
    const { useSchoolContext } = await import('@/composables/schools/useSchoolContext')
    useSchoolContext().currentUser.value = { ...TEACHER, educational_role: 'school_admin' } as any
    const mod = await import('./TeacherDashboard.vue')
    const wrapper = mount(mod.default, {
      global: {
        provide: { isAdminView: false, supabase: { value: fakeClient() } },
        stubs: {
          Greeting: { props: ['name', 'lines', 'date'], template: '<div><h1>{{ name }}</h1></div>' },
          BeltDot: true, Sparkline: true, FrostSelect: true, YearGroupTiles: true, ShowAll: true, WalkOffer: true,
          UpdatedStamp: true, CreateClassModal: true, ClassCreatedModal: true, SchoolsPasswordPrompt: true, MailboxCheckPrompt: true,
          RouterLink: { props: ['to'], template: '<a><slot /></a>' },
        },
      },
    })
    await flushPromises()
    await flushPromises()
    expect(wrapper.text()).not.toContain('Welcome back')
    expect(wrapper.find('[data-walk="dash-teacher-stats"]').exists()).toBe(false)
    expect(wrapper.find('[data-walk="dash-own-practice"]').exists()).toBe(false)
  })

  it('a practice fetch that failed says so and shows no minutes — never a 0 that is not real', async () => {
    const wrapper = await mountMyClasses({ practiceStatus: 403 })
    const text = wrapper.text()
    expect(text).toContain("Couldn't load this week's practice")
    expect(text).toContain('One class on the go.')
    expect(text).not.toContain('0 min in the app this week')
  })
})
