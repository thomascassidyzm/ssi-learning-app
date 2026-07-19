/**
 * Tests for NodeHomeView.vue — THE VIEW's one recursive node home
 * (docs/THE-VIEW.md). Pins the founder ruling: the SAME page grammar at
 * every level (org root / mid group / school / class) — map rail with
 * you-are-here, identity header, stats row, children list — plus the two
 * navigation rules: lenses are filters over the one view (query-driven,
 * never separate pages) and clicking any node name lands on that node's
 * home.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { reactive } from 'vue'
import NodeHomeView from './NodeHomeView.vue'

const routeMock = reactive({ params: { id: 'programme' } as Record<string, any>, query: {} as Record<string, any> })
const pushMock = vi.fn()
const replaceMock = vi.fn((to: any) => { routeMock.query = to.query || {} })

vi.mock('vue-router', () => ({
  useRoute: () => routeMock,
  useRouter: () => ({ push: pushMock, replace: replaceMock }),
}))

vi.mock('@/composables/useAdminClient', () => ({
  useAdminClient: () => ({ getAuthToken: async () => 'test-token' }),
}))

const ROLLUP = { childGroupCount: 1, teacherCount: 2, classCount: 1, learnerCount: 80 }

function nodePayload(overrides: Record<string, any> = {}) {
  return {
    kind: 'node',
    node: { id: 'programme', name: 'IME Demo Programme', label: 'programme', is_demo: true, hasSchool: false, rollup: ROLLUP, commercial: null },
    ancestors: [{ id: 'nation', name: 'India', label: 'nation', hasSchool: false }],
    siblings: [{ id: 'programme-2', name: 'Other Programme', label: 'programme', hasSchool: false }],
    children: [
      { id: 'school-node', name: 'Sunrise Public School', label: 'school', hasSchool: true, is_demo: true, rollup: { childGroupCount: 0, teacherCount: 3, classCount: 4, learnerCount: 42 }, commercial: { schoolId: 'school-1', platformStatus: 'trial', trialCourseCode: 'hin_for_eng' } },
    ],
    practiceHours: 266.4,
    ...overrides,
  }
}

function classPayload() {
  return {
    kind: 'class',
    node: { id: 'class-1', name: 'Year 6 Hindi', label: 'class', is_demo: true, rollup: { childGroupCount: 0, teacherCount: 2, classCount: 1, learnerCount: 2 }, commercial: null },
    ancestors: [
      { id: 'nation', name: 'India', label: 'nation', hasSchool: false },
      { id: 'school-node', name: 'Sunrise Public School', label: 'school', hasSchool: true },
    ],
    siblings: [],
    children: [],
    teachers: [
      { user_id: 't1', name: 'Ms Mehta', is_lead: true },
      { user_id: 't2', name: 'Mr Rao', is_lead: false },
    ],
    students: [
      { learner_id: 'l1', name: 'Asha', practice_hours: 2, last_active_at: '2026-07-18T10:00:00Z' },
      { learner_id: 'l2', name: 'Ravi', practice_hours: 1, last_active_at: null },
    ],
    practiceHours: 3,
    schoolId: 'school-1',
    nodeId: 'school-node',
  }
}

// vue-router is mocked at module level, so <router-link> isn't registered —
// stub it as a plain anchor carrying its `to` as href.
const RouterLinkStub = {
  props: { to: { type: [String, Object], required: true } },
  template: `<a :href="typeof to === 'string' ? to : ''"><slot /></a>`,
}

function mountView() {
  return mount(NodeHomeView, { global: { stubs: { RouterLink: RouterLinkStub } } })
}

let fetchMock: ReturnType<typeof vi.fn>
let lastPayload: any

function setupFetch(payload: any) {
  lastPayload = payload
  fetchMock = vi.fn(async () => ({ ok: true, json: async () => lastPayload }))
  vi.stubGlobal('fetch', fetchMock)
}

beforeEach(() => {
  vi.unstubAllGlobals()
  pushMock.mockClear()
  replaceMock.mockClear()
  routeMock.params = { id: 'programme' }
  routeMock.query = {}
})

describe('NodeHomeView — one grammar at every level', () => {
  it('group level: map rail (ancestors, you-are-here, siblings, children), identity, stats, children rows', async () => {
    setupFetch(nodePayload())
    const wrapper = mountView()
    await flushPromises()

    const text = wrapper.text()
    // Map rail: ancestor, you-are-here, sibling toggle, child
    expect(text).toContain('India')
    expect(text).toContain("you're here")
    expect(text).toContain('1 other at this level')
    // Identity header
    expect(wrapper.find('.identity-name').text()).toBe('IME Demo Programme')
    expect(text).toContain('Demo')
    // Stats row — subtree totals + hours
    expect(text).toContain('80')
    expect(text).toContain('266.4h')
    // Children list — school child with the same row grammar
    expect(wrapper.find('.child-name').text()).toBe('Sunrise Public School')
    // Lens chips present (filters over the one view)
    expect(text).toContain('All schools')
    expect(text).toContain('All teachers')
  })

  it('org-root level: renders with no ancestors and no siblings', async () => {
    setupFetch(nodePayload({ ancestors: [], siblings: [] }))
    const wrapper = mountView()
    await flushPromises()
    expect(wrapper.find('.identity-name').text()).toBe('IME Demo Programme')
    expect(wrapper.text()).toContain("you're here")
    expect(wrapper.text()).not.toContain('at this level')
  })

  it('school level: same page, trial state named in the header', async () => {
    routeMock.params = { id: 'school-1' }
    setupFetch(nodePayload({
      node: { id: 'school-node', name: 'Sunrise Public School', label: 'school', is_demo: false, hasSchool: true, rollup: ROLLUP, commercial: { schoolId: 'school-1', platformStatus: 'trial', trialCourseCode: 'hin_for_eng' } },
      children: [],
    }))
    const wrapper = mountView()
    await flushPromises()
    expect(wrapper.find('.identity-text .schools-kicker').text()).toBe('School')
    expect(wrapper.text()).toContain('Trial — hin_for_eng')
    // Analytics verb targets the school's deep tools
    expect(wrapper.find('a[href="/admin/schools/school-1/analytics"]').exists()).toBe(true)
  })

  it('class level: same grammar — rail to the school, read-only teachers (lead first), students as children', async () => {
    routeMock.params = { id: 'class-1' }
    setupFetch(classPayload())
    const wrapper = mountView()
    await flushPromises()

    const text = wrapper.text()
    expect(wrapper.find('.identity-name').text()).toBe('Year 6 Hindi')
    expect(text).toContain('Sunrise Public School') // rail ancestor
    expect(text).toContain('Ms Mehta')
    expect(text).toContain('(lead)')
    expect(text).toContain('Mr Rao')
    // Students rendered in the same child-row grammar
    const names = wrapper.findAll('.child-name').map((n) => n.text())
    expect(names).toEqual(['Asha', 'Ravi'])
    // No lens chips at class level
    expect(text).not.toContain('All schools')
  })

  it('lens chips are filters over the one view: chip → query update → lens payload rendered', async () => {
    setupFetch(nodePayload())
    const wrapper = mountView()
    await flushPromises()

    setupFetch(nodePayload({
      schools: [
        { schoolId: 'school-1', nodeId: 'school-node', name: 'Sunrise Public School', teacherCount: 3, classCount: 4, studentCount: 42, practiceHours: 135.1, hasAdmin: true, teachers: ['Ms Mehta', 'Mr Rao'] },
        { schoolId: 'school-2', nodeId: 'school-node-2', name: 'St Mary\'s Academy', teacherCount: 3, classCount: 2, studentCount: 38, practiceHours: 131.3, hasAdmin: false, teachers: [] },
      ],
    }))
    const chips = wrapper.findAll('.chip')
    await chips.find((c) => c.text() === 'All schools')!.trigger('click')
    await flushPromises()

    expect(replaceMock).toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('lens=schools'), expect.anything())
    const names = wrapper.findAll('.child-name').map((n) => n.text())
    expect(names).toEqual(['Sunrise Public School', "St Mary's Academy"])
    expect(wrapper.text()).toContain('Awaiting admin')
  })

  it('NAVIGATION PIN: clicking a child name goes to that node\'s home; rail ancestors do too', async () => {
    setupFetch(nodePayload())
    const wrapper = mountView()
    await flushPromises()

    await wrapper.find('.child-btn').trigger('click')
    expect(pushMock).toHaveBeenCalledWith('/admin/groups/school-node')

    await wrapper.find('.rail-link').trigger('click')
    expect(pushMock).toHaveBeenCalledWith('/admin/groups/nation')
  })

  it('class students click through to the learner progress view', async () => {
    routeMock.params = { id: 'class-1' }
    setupFetch(classPayload())
    const wrapper = mountView()
    await flushPromises()
    await wrapper.find('.child-btn').trigger('click')
    expect(pushMock).toHaveBeenCalledWith('/admin/users/l1/progress')
  })
})
