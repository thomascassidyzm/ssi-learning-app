/**
 * NodeHomeView — everything on the school overview is tappable (job #624).
 *
 * Tom on staging (2026-09-14) as a school leader: each stat card and each
 * year-group tile is a link to that figure broken down — the classes list
 * sorted or filtered to answer the card, the staff list for teachers, and
 * the classes list narrowed to a year for a tile. Only on a school leader's
 * own member surface; the admin mount keeps plain figures.
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

function schoolNodePayload() {
  return {
    kind: 'node',
    nodeId: 'node-1',
    schoolId: SCHOOL_ID,
    node: {
      id: 'node-1',
      name: 'Ysgol Cas-gwent Chepstow School',
      label: 'school',
      is_demo: false,
      hasSchool: true,
      rollup: { childGroupCount: 0, teacherCount: 4, classCount: 34, learnerCount: 50 },
      commercial: null,
    },
    ancestors: [],
    siblings: [],
    children: [],
    practiceHours: 5,
    classPractice: { phrases7d: 1200, activeClasses7d: 20, classCount: 34, inAppMinutes7d: 300, windowDays: 7, topPhrases7d: [], classInAppMinutes7d: 200, audioPlayedMinutes7d: 100 },
    tree: { id: 'node-1', name: 'Ysgol', label: 'school', children: [], staff: [], classes: [
      { id: 'c-7h', name: '7H', phrases7d: 40, lastPractisedAt: new Date().toISOString() },
      { id: 'c-8h', name: '8H', phrases7d: 0, lastPractisedAt: null },
      { id: 'c-x', name: 'Rachel personal', phrases7d: 0, lastPractisedAt: null },
    ] },
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

async function mountNode(opts: { role?: 'school_admin' | 'govt_admin'; path?: string } = {}) {
  const { role = 'school_admin', path = `/org/${SCHOOL_ID}` } = opts
  routeMock.params = { id: SCHOOL_ID }
  routeMock.query = {}
  routeMock.path = path
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => schoolNodePayload() })))
  setSchoolsClient(fakeClient())
  useSchoolContext().currentUser.value = {
    user_id: 'chep-uid', learner_id: 'chep-lid', display_name: 'Angharad', educational_role: role,
    school_id: SCHOOL_ID, group_id: role === 'govt_admin' ? 'g1' : undefined, _scopeSource: 'self',
  } as any
  useSchoolData().currentSchool.value = {
    id: SCHOOL_ID, school_name: 'Ysgol Cas-gwent Chepstow School', region_code: null, admin_user_id: 'chep-uid',
    teacher_join_code: 'DCV-054', admin_join_code: 'RQM-672', teacher_count: 4, class_count: 34, student_count: 50,
    total_practice_hours: 5, created_at: '2026-07-16T06:23:00Z', name_confirmed: true,
  } as any
  const wrapper = mount(NodeHomeView, { global: { stubs: { RouterLink: RouterLinkStub } } })
  await flushPromises()
  await flushPromises()
  return wrapper
}

describe('NodeHomeView — everything on the school overview is tappable (job #624)', () => {
  beforeEach(() => {
    clearNodeHomeCache()
    vi.unstubAllGlobals()
    setSchoolsClient(fakeClient())
    useSchoolData().currentSchool.value = null
    useSchoolContext().currentUser.value = null
  })

  it("each stat card on a school leader's own school links to its breakdown", async () => {
    const wrapper = await mountNode()
    const cards = wrapper.findAll('[data-walk="node-stats"] a.stat-card')
    expect(cards.map((c) => c.attributes('href'))).toEqual([
      '/schools/classes?sort=phrases',
      '/schools/classes?practising=1&sort=hours',
      '/schools/classes?sort=hours',
      '/schools/teachers',
    ])
    const tiles = wrapper.findAll('[data-walk="node-year-groups"] a.year-tile')
    expect(tiles.map((t) => t.attributes('href'))).toEqual([
      '/schools/classes?year=7',
      '/schools/classes?year=8',
      '/schools/classes?year=other',
    ])
  })

  it('on the ssi_admin read-view mount the figures stay plain', async () => {
    const wrapper = await mountNode({ path: '/admin/groups/node-1' })
    expect(wrapper.findAll('[data-walk="node-stats"] a.stat-card').length).toBe(0)
    expect(wrapper.findAll('[data-walk="node-stats"] .stat-card').length).toBe(4)
    expect(wrapper.findAll('[data-walk="node-year-groups"] a.year-tile').length).toBe(0)
  })
})
