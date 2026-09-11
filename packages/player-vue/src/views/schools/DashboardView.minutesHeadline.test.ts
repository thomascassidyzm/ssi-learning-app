/**
 * DashboardView — the school leader's practice headline is MINUTES IN THE
 * APP THIS WEEK, off /api/school/class-practice-7d's rollup, never hours and
 * never a zero that is not real.
 *
 * Tom on staging, 2026-09-11 (job #265): "why the fucking hell are they all
 * showing 0h progress. Why the fuck is hours a thing anyway?" The dashboard
 * read all-time hours off school_summary, so a school whose classes had
 * practised for 352 minutes this week showed "6m" all-time from a 0.1h row,
 * and under a role-only View-as it showed 0h as if that were the truth.
 *
 * Red on the pre-#265 code (no minutes headline, "6m"/"0h" instead); green
 * after. Mounts the real SFC.
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
  useRoute: () => ({ name: 'dashboard', params: {}, query: {} }),
  RouterLink: { name: 'RouterLink', props: ['to'], template: '<a><slot /></a>' },
}))

function fakeClient() {
  const chain: any = new Proxy({}, {
    get(_t, prop) {
      if (prop === 'then') return (r: any) => Promise.resolve({ data: [], error: null }).then(r)
      return () => chain
    },
  })
  return {
    from: () => chain,
    auth: { getSession: vi.fn(async () => ({ data: { session: { access_token: 'tok' } } })) },
  } as any
}

const SCHOOL_ADMIN = {
  user_id: 'chep-uid',
  learner_id: 'chep-lid',
  display_name: 'Angharad',
  educational_role: 'school_admin' as const,
  platform_role: null,
  school_id: '0f5bd6e4-f40b-4dbf-ac4f-a93478d20255',
  school_name: 'Ysgol Cas-gwent Chepstow School',
  _scopeSource: 'self' as const,
}

// Chepstow's real shape on 2026-09-11: 34 classes, 0 pupil accounts, 3.1h
// all-time on the DB view — and 352 minutes in the app this week.
const CHEPSTOW_ROSTER = {
  school_id: SCHOOL_ADMIN.school_id, school_name: SCHOOL_ADMIN.school_name, region_code: null, group_id: null,
  admin_user_id: 'chep-uid', teacher_count: 39, class_count: 34, student_count: 0,
  total_practice_hours: 3.1255, staff_practice_hours: 3.1255, name_confirmed: true, created_at: '2026-07-16T06:23:00Z',
}

let practiceCalls: string[] = []

async function mountDashboard(opts: { rollup?: any; practiceStatus?: number; scopeSource?: 'self' | 'admin-view' } = {}) {
  practiceCalls = []
  globalThis.fetch = vi.fn(async (url: any) => {
    const u = String(url)
    if (u.includes('roster')) return { ok: true, json: async () => ({ school: CHEPSTOW_ROSTER }) } as any
    if (u.includes('class-practice-7d')) {
      practiceCalls.push(u)
      if (opts.practiceStatus && opts.practiceStatus !== 200) return { ok: false, status: opts.practiceStatus, json: async () => ({}) } as any
      return { ok: true, json: async () => ({ practiceByClass: {}, activeDaysByClass: {}, rollup: opts.rollup ?? { windowDays: 7, classCount: 34, activeClasses7d: 20, inAppMinutes7d: 352 } }) } as any
    }
    return { ok: true, json: async () => ({}) } as any
  }) as any

  const { setSchoolsClient } = await import('@/composables/schools/client')
  setSchoolsClient(fakeClient())
  const { useSchoolContext } = await import('@/composables/schools/useSchoolContext')
  useSchoolContext().currentUser.value = { ...SCHOOL_ADMIN, _scopeSource: opts.scopeSource ?? 'self' } as any

  const mod = await import('./DashboardView.vue')
  const wrapper = mount(mod.default, {
    global: {
      provide: { isAdminView: opts.scopeSource === 'admin-view' },
      stubs: {
        Greeting: { props: ['lines'], template: '<div><p>{{ lines }}</p><slot name="action" /></div>' },
        BeltDot: true, HealthDot: true, Bench: true, InviteLinkField: true,
        UpdatedStamp: true, CreateClassModal: true, ClassCreatedModal: true,
        RouterLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
      },
    },
  })
  await flushPromises()
  await flushPromises()
  return wrapper
}

describe('DashboardView — MINUTES, this week, the same number the admin reads (job #265)', () => {
  beforeEach(() => {
    vi.resetModules()
    Object.keys(store).forEach(k => delete store[k])
  })
  afterEach(() => { vi.restoreAllMocks() })

  it('the headline is minutes in the app this week with classes practising beneath it — never hours, never the all-time view figure', async () => {
    const wrapper = await mountDashboard()
    const text = wrapper.text()
    expect(text).toContain('352 min')
    expect(text).toContain('Minutes in the app this week')
    expect(text).toContain('20 of 34 classes practising this week')
    // The greeting line carries the same figure.
    expect(text).toContain('352 min in the app this week')
    // No hours anywhere on the page: not "3.1h", not "0h", not "6m" (the old
    // minutes-first rounding of the 0.1h view row).
    expect(text).not.toMatch(/\b\d+(\.\d+)?h\b/)
    expect(text).not.toContain('Hours practised')
    expect(text).not.toContain('all-time')
  })

  it('a rollup that did not load shows a dash and says so — never a 0 that is not real', async () => {
    const wrapper = await mountDashboard({ practiceStatus: 500 })
    const text = wrapper.text()
    expect(text).toContain('—')
    expect(text).toContain('have not loaded')
    expect(text).not.toContain('0 min')
    expect(text).not.toMatch(/\b0h\b/)
  })

  it('under the admin read-view / View-as the school being read is named to the endpoint, so the admin\'s empty scope cannot zero it', async () => {
    await mountDashboard({ scopeSource: 'admin-view' })
    expect(practiceCalls.length).toBe(1)
    expect(practiceCalls[0]).toContain(`school_id=${SCHOOL_ADMIN.school_id}`)
  })

  it('a leader on their own session asks for their own scope — no school_id parameter to be trusted', async () => {
    await mountDashboard({ scopeSource: 'self' })
    expect(practiceCalls.length).toBe(1)
    expect(practiceCalls[0]).not.toContain('school_id=')
  })
})
