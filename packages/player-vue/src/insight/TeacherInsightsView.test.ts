/**
 * Tests for TeacherInsightsView.vue — the plain-words wrapper over
 * NodeRateEngine (THE LENS, phase 3). Pins: the "Your classes" picker only
 * ever offers the caller's OWN classes from GET /api/me/teaching-context
 * (never any class outside their scope); plain-words copy (no "entity" /
 * "cohort" / "node" anywhere, matching the design law §1.12 pin in
 * NodeRateEngine.test.ts); the embedded prop drops TopNav; and the honest
 * zero-classes empty state.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { reactive, ref } from 'vue'
import TeacherInsightsView from './TeacherInsightsView.vue'

const routeMock = reactive({ query: {} as Record<string, any> })
const replaceMock = vi.fn((to: any) => { routeMock.query = to.query || {} })

vi.mock('vue-router', () => ({
  useRoute: () => routeMock,
  useRouter: () => ({ replace: replaceMock }),
}))

const viewingAsMock = ref<{ userId: string; role: string; name: string; key: string } | null>(null)
vi.mock('@/composables/useUserRole', () => ({
  useUserRole: () => ({ viewingAs: viewingAsMock }),
}))

const getSessionMock = vi.fn(async () => ({ data: { session: { access_token: 'tok' } } }))
vi.mock('@/composables/schools/client', () => ({
  getSchoolsClient: () => ({ auth: { getSession: () => getSessionMock() } }),
}))

vi.mock('./NodeRateEngine.vue', () => ({
  default: {
    name: 'NodeRateEngine',
    props: ['nodeId', 'course', 'compare', 'plainWords', 'getToken'],
    template: '<div class="node-rate-engine-stub">engine for {{ nodeId }}</div>',
  },
}))

vi.mock('@/components/schools/shared/TopNav.vue', () => ({
  default: { name: 'TopNav', template: '<nav class="top-nav-stub" />' },
}))

function teachingContext(overrides: Record<string, any> = {}) {
  return {
    groups: [{ id: 's1', label: 'school' }],
    classes: ['c1', 'c2'],
    can_play_as_class: true,
    groups_detail: [{ id: 's1', label: 'school', name: 'Sunrise Public School' }],
    classes_detail: [
      { id: 'c1', name: 'Year 6 Hindi', course_code: 'hin_for_eng' },
      { id: 'c2', name: 'Year 5 Hindi', course_code: 'hin_for_eng' },
    ],
    ...overrides,
  }
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  routeMock.query = {}
  viewingAsMock.value = null
  replaceMock.mockClear()
  getSessionMock.mockClear()
  fetchMock = vi.fn(async () => ({ ok: true, json: async () => teachingContext() }))
  vi.stubGlobal('fetch', fetchMock)
})

describe('TeacherInsightsView', () => {
  it('fetches teaching-context and offers only the caller\'s own classes in the picker', async () => {
    const wrapper = mount(TeacherInsightsView)
    await flushPromises()

    expect(String(fetchMock.mock.calls[0][0])).toBe('/api/me/teaching-context')
    const select = wrapper.findComponent({ name: 'FrostSelect' })
    const optionLabels = (select.props('options') as { label: string }[]).map((o) => o.label)
    expect(optionLabels).toEqual(['Year 6 Hindi', 'Year 5 Hindi'])

    // Selected class is passed straight through as the engine's node-id —
    // never a class outside classes_detail.
    const engine = wrapper.findComponent({ name: 'NodeRateEngine' })
    expect(engine.props('nodeId')).toBe('c1')
  })

  it('plain-words copy pin: never "entity", "cohort", or "node" anywhere in the view', async () => {
    const wrapper = mount(TeacherInsightsView)
    await flushPromises()

    const engine = wrapper.findComponent({ name: 'NodeRateEngine' })
    expect(engine.props('plainWords')).toBe(true)

    const everything = wrapper.text().toLowerCase()
    expect(everything).not.toContain('entity')
    expect(everything).not.toContain('cohort')
    expect(everything).not.toContain('node')
  })

  it('embedded: renders no TopNav', async () => {
    const embedded = mount(TeacherInsightsView, { props: { embedded: true } })
    await flushPromises()
    expect(embedded.findComponent({ name: 'TopNav' }).exists()).toBe(false)

    const standalone = mount(TeacherInsightsView, { props: { embedded: false } })
    await flushPromises()
    expect(standalone.findComponent({ name: 'TopNav' }).exists()).toBe(true)
  })

  it('honest zero-classes empty state — no engine, no fabricated picker', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => teachingContext({ classes: [], classes_detail: [], can_play_as_class: false }) })
    const wrapper = mount(TeacherInsightsView)
    await flushPromises()

    expect(wrapper.text()).toContain('No classes yet — once you have a class with sessions, it compares here.')
    expect(wrapper.findComponent({ name: 'NodeRateEngine' }).exists()).toBe(false)
  })

  it('a missing session reads as a sign-in prompt, not an empty class', async () => {
    getSessionMock.mockResolvedValueOnce({ data: { session: null } })
    const wrapper = mount(TeacherInsightsView)
    await flushPromises()
    expect(wrapper.text()).toContain('Sign in to see your class')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('old ?scope=learner&name= deep link shows the class view with an honest note, not a seeded preview', async () => {
    routeMock.query = { scope: 'learner', name: 'Priya' }
    const wrapper = mount(TeacherInsightsView)
    await flushPromises()

    expect(wrapper.text()).toContain('Priya')
    expect(wrapper.text()).toContain("per-learner rates aren't available")
    expect(wrapper.findComponent({ name: 'NodeRateEngine' }).exists()).toBe(true)
  })

  it('?class= deep link pre-selects that class when it is one of the caller\'s own', async () => {
    routeMock.query = { class: 'c2' }
    const wrapper = mount(TeacherInsightsView)
    await flushPromises()
    const engine = wrapper.findComponent({ name: 'NodeRateEngine' })
    expect(engine.props('nodeId')).toBe('c2')
  })

  // Job #788 (2026-09-15): under View As the token is the admin's, and every
  // ssi_admin teaches no classes — so the view asks for the VIEWED teacher's
  // context by uid. A class whose only practice is play-as-class (11P,
  // 18 minutes that week) then renders the engine, not "No classes yet".
  it('View As: asks teaching-context for the viewed teacher and renders their class', async () => {
    viewingAsMock.value = { key: 'teacher:t-1', userId: 'teacher-uid', role: 'teacher', name: 'R Jeffery' }
    fetchMock.mockImplementation(async (url: string) => ({
      ok: true,
      json: async () => (String(url).includes('as=teacher-uid')
        ? teachingContext({ classes: ['c-11p'], classes_detail: [{ id: 'c-11p', name: '11P', course_code: 'cym_s_for_eng' }] })
        : teachingContext({ classes: [], classes_detail: [] })),
    }))
    const wrapper = mount(TeacherInsightsView)
    await flushPromises()
    expect(String(fetchMock.mock.calls[0][0])).toBe('/api/me/teaching-context?as=teacher-uid')
    expect(wrapper.text()).not.toContain('No classes yet')
    expect(wrapper.findComponent({ name: 'NodeRateEngine' }).props('nodeId')).toBe('c-11p')
  })
})
