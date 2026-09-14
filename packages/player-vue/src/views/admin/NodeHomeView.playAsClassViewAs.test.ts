/**
 * NodeHomeView — the class page's Play as class under View As (job #683).
 * Tom, 2026-09-14 16:17Z, touring the 9AWI class page as Mr Williams under
 * View As: no Play as class button anywhere. The 2026-07-16 gate in
 * usePlayAsClass hid it. Present and enabled for a signed-in teacher of the
 * class; present and disabled under View As. Red on the old gate, green after.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import NodeHomeView from './NodeHomeView.vue'
import { clearNodeHomeCache } from '@/composables/admin/nodeHomeCache'
import { useSchoolContext } from '@/composables/schools/useSchoolContext'

const routeMock: any = { params: { id: 'class-1' }, query: {}, path: '/org/class-1' }
vi.mock('vue-router', () => ({
  useRoute: () => routeMock,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}))
vi.mock('@/composables/useAdminClient', () => ({
  useAdminClient: () => ({ getAuthToken: async () => 'test-token' }),
}))

function classPayload() {
  return {
    kind: 'class',
    node: { id: 'class-1', name: 'Year 7 Welsh', label: 'class', is_demo: true, rollup: { childGroupCount: 0, teacherCount: 1, classCount: 1, learnerCount: 0 }, commercial: null, course_code: 'cym_s_for_eng' },
    ancestors: [{ id: 'school-node', name: 'ZZ Test School', label: 'school', hasSchool: true }],
    siblings: [], children: [],
    teachers: [{ user_id: 'u1', name: 'Bethan', is_lead: true }],
    students: [],
    journey: { done: 6, total: 320 },
    practiceHours: 0,
    schoolId: 'school-1',
    nodeId: 'school-node',
    callerTeachesClass: true,
    classLearnerId: 'cl-1',
  }
}

const RouterLinkStub = { props: { to: { type: [String, Object], required: true } }, template: `<a :href="typeof to === 'string' ? to : ''"><slot /></a>` }

async function mountView(isAdminView: boolean) {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => classPayload() })))
  const w = mount(NodeHomeView, { global: { stubs: { RouterLink: RouterLinkStub }, provide: { isAdminView } } })
  await flushPromises()
  await flushPromises()
  return w
}

describe('NodeHomeView — the class page keeps Play as class beside the class name', () => {
  beforeEach(() => {
    clearNodeHomeCache()
    vi.unstubAllGlobals()
    useSchoolContext().currentUser.value = { user_id: 'u1', learner_id: 'l1', display_name: 'Bethan', educational_role: 'teacher', platform_role: null, school_id: 'school-1' } as any
  })

  it('a signed-in teacher of the class gets a live Play as class button', async () => {
    const w = await mountView(false)
    const btn = w.find('[data-walk="class-page-play"]')
    expect(btn.exists()).toBe(true)
    expect(btn.attributes('disabled')).toBeUndefined()
  })

  it('under View As the button is present, disabled, and says why', async () => {
    const w = await mountView(true)
    const btn = w.find('[data-walk="class-page-play"]')
    expect(btn.exists()).toBe(true)
    expect(btn.attributes('disabled')).toBeDefined()
    expect(btn.attributes('title')).toContain('Read only while you are viewing as someone else')
  })
})
