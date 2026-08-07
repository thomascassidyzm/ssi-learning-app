/**
 * NodeHomeView — the school-admin FIRST-RUN affordances, on the surface a
 * school admin actually lands on.
 *
 * Chepstow production inspection, 2026-08-06: both first-run affordances live
 * in DashboardView (/schools), but nav unification (2026-07-30) redirects
 * every school-scoped school_admin from /schools to /org/:schoolId — this
 * page. So the head of a school with 3 classes, 0 pupils ever and
 * name_confirmed=false had NO route to the setup wizard (which has no nav
 * tab) and NO way to fix a name someone else guessed for her (THE VIEW's
 * Rename verb is `!member`). Both now render here, own school node only.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { reactive } from 'vue'
import NodeHomeView from './NodeHomeView.vue'
import { clearNodeHomeCache } from '@/composables/admin/nodeHomeCache'
import { useSchoolContext } from '@/composables/schools/useSchoolContext'
import { useSchoolData } from '@/composables/schools/useSchoolData'
import { setSchoolsClient } from '@/composables/schools/client'

const SCHOOL_ID = 'chep-school'

const routeMock = reactive({
  params: { id: SCHOOL_ID } as Record<string, any>,
  query: {} as Record<string, any>,
  path: `/org/${SCHOOL_ID}`,
})

vi.mock('vue-router', () => ({
  useRoute: () => routeMock,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}))

vi.mock('@/composables/useAdminClient', () => ({
  useAdminClient: () => ({ getAuthToken: async () => 'test-token' }),
}))

const RouterLinkStub = {
  props: { to: { type: [String, Object], required: true } },
  template: `<a :href="typeof to === 'string' ? to : ''"><slot /></a>`,
}

function schoolNodePayload(learnerCount: number) {
  return {
    kind: 'node',
    node: {
      id: SCHOOL_ID,
      name: 'Ysgol Cas-gwent Chepstow School',
      label: 'school',
      is_demo: false,
      hasSchool: true,
      rollup: { childGroupCount: 0, teacherCount: 2, classCount: 3, learnerCount },
      commercial: null,
    },
    ancestors: [],
    siblings: [],
    children: [],
    practiceHours: 0.1,
  }
}

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

type Opts = {
  role?: 'school_admin' | 'govt_admin'
  learnerCount?: number
  nameConfirmed?: boolean
  path?: string
  routeId?: string
}

async function mountNode(opts: Opts = {}) {
  const {
    role = 'school_admin',
    learnerCount = 0,
    nameConfirmed = false,
    path = `/org/${SCHOOL_ID}`,
    routeId = SCHOOL_ID,
  } = opts

  routeMock.params = { id: routeId }
  routeMock.query = {}
  routeMock.path = path

  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => schoolNodePayload(learnerCount) })))
  setSchoolsClient(fakeClient())

  useSchoolContext().currentUser.value = {
    user_id: 'chep-uid',
    learner_id: 'chep-lid',
    display_name: 'Angharad',
    educational_role: role,
    school_id: SCHOOL_ID,
    group_id: role === 'govt_admin' ? 'g1' : undefined,
    _scopeSource: 'self',
  } as any

  // currentSchool is warm on this surface because SchoolsContainer prefetches
  // it on mount; seed it directly rather than replaying the roster fetch.
  useSchoolData().currentSchool.value = {
    id: SCHOOL_ID,
    school_name: 'Ysgol Cas-gwent Chepstow School',
    region_code: null,
    admin_user_id: 'chep-uid',
    teacher_join_code: 'DCV-054',
    admin_join_code: 'RQM-672',
    teacher_count: 2,
    class_count: 3,
    student_count: learnerCount,
    total_practice_hours: 0.1,
    created_at: '2026-07-16T06:23:00Z',
    name_confirmed: nameConfirmed,
  } as any

  const wrapper = mount(NodeHomeView, { global: { stubs: { RouterLink: RouterLinkStub } } })
  await flushPromises()
  return wrapper
}

const setupLinks = (w: any) => w.findAll('a').filter((a: any) => a.attributes('href') === '/schools/setup')

describe('NodeHomeView — school-admin first run on their own school node', () => {
  beforeEach(() => {
    clearNodeHomeCache()
    vi.unstubAllGlobals()
    // The client must exist before useSchoolData() is touched — the view
    // itself degrades gracefully when it doesn't (see its try/catch), but the
    // fixtures below need the real refs.
    setSchoolsClient(fakeClient())
    useSchoolData().currentSchool.value = null
    useSchoolContext().currentUser.value = null
  })

  it('offers the setup wizard when the school has classes but ZERO pupils (Chepstow)', async () => {
    const wrapper = await mountNode({ learnerCount: 0 })
    expect(setupLinks(wrapper).length).toBe(1)
    expect(wrapper.text()).toContain('Start setup')
  })

  it('does not nag a school that is up and running', async () => {
    const wrapper = await mountNode({ learnerCount: 24 })
    expect(setupLinks(wrapper).length).toBe(0)
  })

  it("renders the confirm-your-school's-name card when name_confirmed is false", async () => {
    const wrapper = await mountNode({ nameConfirmed: false })
    expect(wrapper.text()).toContain("Confirm your school's name")
    expect(wrapper.find('input[placeholder="e.g. Ysgol y Garnedd"]').exists()).toBe(true)
  })

  it('hides the confirm-name card once the name is confirmed', async () => {
    const wrapper = await mountNode({ nameConfirmed: true })
    expect(wrapper.text()).not.toContain("Confirm your school's name")
  })

  it('shows neither on the ssi_admin read-view mount (/admin/schools/:id)', async () => {
    const wrapper = await mountNode({ path: `/admin/schools/${SCHOOL_ID}` })
    expect(setupLinks(wrapper).length).toBe(0)
    expect(wrapper.text()).not.toContain("Confirm your school's name")
  })

  it('shows neither for a group leader on their own org node', async () => {
    const wrapper = await mountNode({ role: 'govt_admin' })
    expect(setupLinks(wrapper).length).toBe(0)
    expect(wrapper.text()).not.toContain("Confirm your school's name")
  })

  it("shows neither on some OTHER node than the admin's own school", async () => {
    const wrapper = await mountNode({ routeId: 'some-other-node', path: '/org/some-other-node' })
    expect(setupLinks(wrapper).length).toBe(0)
    expect(wrapper.text()).not.toContain("Confirm your school's name")
  })
})
