/**
 * ONE class page (job #999, Tom's ruling 2026-09-16). There used to be two
 * teacher-facing pages for one class: this one, with the stat tiles, and a
 * flat Class tools page at /schools/classes/:id carrying the roster, the
 * co-teachers, the join link, rename and delete. They are one page now — the
 * tools render here, under Manage class, and that verb scrolls rather than
 * navigates.
 *
 * Red before the fix: nothing rendered the tools here and Manage class was a
 * router-link to the retired route. Green after.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import NodeHomeView from './NodeHomeView.vue'
import { clearNodeHomeCache } from '@/composables/admin/nodeHomeCache'
import { useSchoolContext } from '@/composables/schools/useSchoolContext'
import { useClassesData } from '@/composables/schools/useClassesData'
import { setSchoolsClient } from '@/composables/schools/client'

const routeMock: any = { params: { id: 'class-1' }, query: {}, path: '/org/class-1' }
vi.mock('vue-router', () => ({
  useRoute: () => routeMock,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useLink: () => ({ href: { value: '' }, navigate: vi.fn() }),
}))
vi.mock('@/composables/useAdminClient', () => ({
  useAdminClient: () => ({ getAuthToken: async () => 'test-token' }),
}))

const RouterLinkStub = { props: { to: { type: [String, Object], required: true } }, template: `<a :href="typeof to === 'string' ? to : ''"><slot /></a>` }

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

describe('NodeHomeView — the class page carries the class tools', () => {
  beforeEach(() => {
    clearNodeHomeCache()
    vi.unstubAllGlobals()
    const chain: any = {
      select: () => chain, eq: () => chain, in: () => chain, order: () => chain,
      single: () => Promise.resolve({ data: null, error: null }),
      then: (r: any) => Promise.resolve({ data: [], error: null }).then(r),
    }
    setSchoolsClient({ from: () => chain } as any)
    useClassesData().classes.value = []
    useSchoolContext().currentUser.value = { user_id: 'u1', learner_id: 'l1', display_name: 'Bethan', educational_role: 'teacher', platform_role: null, school_id: 'school-1' } as any
  })

  it('renders the tools under Manage class, and Manage class stays on the page', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => classPayload() })))
    // The tools are an async component; under vitest the dynamic import only
    // resolves in time when the module is already in the graph, so prime it.
    await import('@/views/schools/ClassDetail.vue')
    const w = mount(NodeHomeView, {
      global: { stubs: { RouterLink: RouterLinkStub }, provide: { isAdminView: false } },
    })
    // the tools are an async component — give the dynamic import its turns
    for (let i = 0; i < 12; i++) { await flushPromises(); await new Promise((r) => setTimeout(r, 0)) }

    // The verb is a hop down this page now, not a route to another one.
    const manage = w.find('[data-walk="class-page-manage"]')
    expect(manage.exists()).toBe(true)
    expect(manage.attributes('href')).toBe('#manage-class')

    // …and what it hops to is the tools themselves.
    expect(w.find('#manage-class').exists()).toBe(true)
    expect(w.find('[data-walk="class-teachers"]').exists()).toBe(true)
    expect(w.find('[data-walk="class-roster"]').exists()).toBe(true)
    expect(w.find('[data-walk="class-rename"]').exists()).toBe(true)
    expect(w.find('[data-walk="class-delete"]').exists()).toBe(true)

    // The tools never bring the class page's own figures with them — one
    // Play as class on the page, one course journey, one copy-play repair.
    expect(w.findAll('[data-walk="class-play"]').length).toBe(0)
    expect(w.findAll('[data-walk="class-journey"]').length).toBe(1)
  })
})
