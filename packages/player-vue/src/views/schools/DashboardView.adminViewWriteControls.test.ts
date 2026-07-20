/**
 * DashboardView — write affordances must be absent in the ssi_admin read-only
 * admin drill-in view (isAdminView, e.g. /admin/groups/:id). Regression for
 * the founder's report: the "Create school" form (and the name-your-group /
 * confirm-school-name write cards) still rendered under the read-only view.
 *
 * Mounts the real SFC with isAdminView provided, seeds a group-leader scope,
 * and asserts the create-school input+button render only for a real leader
 * (isAdminView false), not the admin read-view.
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

// A minimal chainable client so the composables' getSchoolsClient() calls and
// getSession() don't throw. All DB reads resolve empty; the data comes from the
// mocked fetch() for the server-mediated endpoints.
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

const GROUP_LEADER = {
  user_id: 'ime-uid',
  learner_id: 'ime-lid',
  display_name: 'IME Group Leader',
  educational_role: 'govt_admin' as const,
  platform_role: null,
  group_id: 'g1',
  group_path: 'g1',
  organization_name: 'IME Demo Programme',
}

async function mountDashboard(isAdminView: boolean, scopeSource: 'self' | 'admin-view') {
  const { setSchoolsClient } = await import('@/composables/schools/client')
  setSchoolsClient(fakeClient())
  const { useSchoolContext } = await import('@/composables/schools/useSchoolContext')
  const ctx = useSchoolContext()
  ctx.currentUser.value = { ...GROUP_LEADER, _scopeSource: scopeSource } as any

  const mod = await import('./DashboardView.vue')
  const wrapper = mount(mod.default, {
    global: {
      provide: { isAdminView },
      stubs: {
        Greeting: { template: '<div><slot name="action" /></div>' },
        BeltDot: true, HealthDot: true, Bench: true, InviteLinkField: true,
        RouterLink: { props: ['to'], template: '<a><slot /></a>' },
      },
    },
  })
  await flushPromises()
  return wrapper
}

describe('DashboardView — write controls hidden in the admin read-view', () => {
  beforeEach(() => {
    vi.resetModules()
    Object.keys(store).forEach(k => delete store[k])
    // group-summary / school-links both resolve to empty payloads.
    globalThis.fetch = vi.fn(async (url: any) => {
      const u = String(url)
      if (u.includes('group-summary')) return { ok: true, json: async () => ({ group: null, schools: [] }) } as any
      if (u.includes('school-links')) return { ok: true, json: async () => ({ links: [] }) } as any
      return { ok: true, json: async () => ({}) } as any
    }) as any
  })
  afterEach(() => { vi.restoreAllMocks() })

  it('hides the Create school form in the admin read-view of a group leader (read only)', async () => {
    const wrapper = await mountDashboard(true, 'admin-view')
    expect(wrapper.find('input[placeholder="School name"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Create school')
  })

  it('shows the Create school form for a real group leader (own dashboard)', async () => {
    const wrapper = await mountDashboard(false, 'self')
    expect(wrapper.find('input[placeholder="School name"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('Create school')
  })
})
