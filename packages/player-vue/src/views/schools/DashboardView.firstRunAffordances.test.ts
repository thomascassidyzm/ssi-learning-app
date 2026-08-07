/**
 * DashboardView — the two school-admin FIRST-RUN affordances must actually
 * render for a school admin. Regression for the Chepstow production
 * inspection (2026-08-06), where both were dead on prod:
 *
 *  1. "Confirm your school's name" computed its predicate correctly
 *     (isSchoolAdmin && !isAdminView && name_confirmed === false) but the CARD
 *     was nested inside the `v-else-if="isGovtAdmin"` branch. Roles are
 *     mutually exclusive (currentRole is one value), so isSchoolAdmin and
 *     isGovtAdmin can never both hold — the card could never paint for any
 *     school admin. A predicate-only test would NOT have caught this, so this
 *     one MOUNTS the real SFC and asserts on rendered output.
 *
 *  2. The guided-setup banner — /schools/setup's only entry point, there being
 *     no nav tab — was gated on `!totalClasses && !totalStudents`. A head who
 *     made one throwaway class on day one lost the wizard forever while her
 *     dashboard stayed a wall of zeros. The signal is ZERO PUPILS.
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
  school_id: 'chep-school',
  school_name: 'Ysgol Cas-gwent Chepstow School',
  _scopeSource: 'self' as const,
}

// The shape /api/school/roster returns for the admin's own school.
function roster(overrides: Record<string, unknown> = {}) {
  return {
    school_id: 'chep-school',
    school_name: 'Ysgol Cas-gwent Chepstow School',
    region_code: null,
    group_id: null,
    admin_user_id: 'chep-uid',
    teacher_count: 2,
    class_count: 3,
    student_count: 0,
    total_practice_hours: 0.1,
    staff_practice_hours: 0.1,
    name_confirmed: false,
    created_at: '2026-07-16T06:23:00Z',
    ...overrides,
  }
}

async function mountDashboard(schoolRow: Record<string, unknown>) {
  globalThis.fetch = vi.fn(async (url: any) => {
    const u = String(url)
    if (u.includes('roster')) return { ok: true, json: async () => ({ school: schoolRow }) } as any
    return { ok: true, json: async () => ({}) } as any
  }) as any

  const { setSchoolsClient } = await import('@/composables/schools/client')
  setSchoolsClient(fakeClient())
  const { useSchoolContext } = await import('@/composables/schools/useSchoolContext')
  useSchoolContext().currentUser.value = { ...SCHOOL_ADMIN } as any

  const mod = await import('./DashboardView.vue')
  const wrapper = mount(mod.default, {
    global: {
      provide: { isAdminView: false },
      stubs: {
        Greeting: { template: '<div><slot name="action" /></div>' },
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

const setupLink = (w: any) => w.findAll('a').filter((a: any) => a.attributes('href') === '/schools/setup')

describe('DashboardView — school-admin first-run affordances', () => {
  beforeEach(() => {
    vi.resetModules()
    Object.keys(store).forEach(k => delete store[k])
  })
  afterEach(() => { vi.restoreAllMocks() })

  it("renders the 'Confirm your school's name' card for a school admin whose name is unconfirmed", async () => {
    const wrapper = await mountDashboard(roster())
    expect(wrapper.text()).toContain("Confirm your school's name")
    expect(wrapper.find('input[placeholder="e.g. Ysgol y Garnedd"]').exists()).toBe(true)
  })

  it('hides the confirm-name card once the name is confirmed', async () => {
    const wrapper = await mountDashboard(roster({ name_confirmed: true }))
    expect(wrapper.text()).not.toContain("Confirm your school's name")
  })

  it('offers the setup wizard to a school with classes but ZERO pupils (Chepstow: 3 classes, 0 students)', async () => {
    const wrapper = await mountDashboard(roster({ class_count: 3, student_count: 0 }))
    expect(setupLink(wrapper).length).toBeGreaterThan(0)
    expect(wrapper.text()).toContain('Start setup')
  })

  it('does not nag a school that is up and running (pupils enrolled)', async () => {
    const wrapper = await mountDashboard(roster({ class_count: 3, student_count: 24 }))
    expect(wrapper.text()).not.toContain('Start setup')
  })

  it('keeps a quiet permanent route to the wizard even for a running school', async () => {
    // /schools/setup has no nav tab — once the banner retires, the Quick
    // links entry is the only way back in.
    const wrapper = await mountDashboard(roster({ class_count: 3, student_count: 24 }))
    expect(setupLink(wrapper).length).toBe(1)
  })
})
