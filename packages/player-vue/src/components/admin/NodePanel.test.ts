/**
 * Tests for NodePanel.vue — THE-MODEL.md §1.12 "VERBS ON TOP, MODEL
 * UNDERNEATH" (founder-ruled): the node panel opens with plain-language
 * task buttons, empty states are teaching buttons (never captions), and
 * everything else is progressive disclosure behind "More". Also covers
 * §1.10 (ways-in links list, links-first) and the plain-language acceptance
 * check (no "node"/"entitlement"/"subtree"/"primitive" in visible copy).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ref } from 'vue'
import NodePanel from './NodePanel.vue'
import type { StructureApi, StructureNode } from './structureApi'

vi.mock('@/composables/useAdminClient', () => ({
  useAdminClient: () => ({
    getClient: () => ({ from: () => ({ select: () => ({ in: () => ({ order: async () => ({ data: [], error: null }) }) }) }) }),
    getAuthToken: async () => 'test-token',
  }),
}))

function makeNode(overrides: Partial<StructureNode> = {}): StructureNode {
  return {
    id: 'group-a',
    name: 'Gwynedd',
    label: 'organisation',
    parent_id: null,
    is_demo: false,
    is_test: false,
    rollup: { childGroupCount: 0, teacherCount: 0, classCount: 0, learnerCount: 0 },
    commercial: null,
    children: [],
    ...overrides,
  }
}

function makeApi(overrides: Partial<StructureApi> = {}): StructureApi {
  return {
    editingId: ref(null),
    editingName: ref(''),
    startRename: vi.fn(),
    saveRename: vi.fn(async () => {}),
    cancelRename: vi.fn(),
    updateLabel: vi.fn(async () => {}),
    openDashboard: vi.fn(),
    createChild: vi.fn(async () => true),
    requestDelete: vi.fn(),
    submitInvite: vi.fn(async () => true),
    submitDemoMint: vi.fn(async () => true),
    drillInto: vi.fn(),
    selectNode: vi.fn(),
    ...overrides,
  }
}

let fetchMock: ReturnType<typeof vi.fn>

function setupFetch(handlers: Record<string, any>) {
  fetchMock = vi.fn(async (url: string) => {
    for (const [pattern, respond] of Object.entries(handlers)) {
      if (url.includes(pattern)) {
        const body = typeof respond === 'function' ? respond(url) : respond
        return { ok: true, json: async () => body }
      }
    }
    return { ok: true, json: async () => ({}) }
  })
  vi.stubGlobal('fetch', fetchMock)
}

beforeEach(() => {
  vi.unstubAllGlobals()
})

function mountPanel(node: StructureNode, api: StructureApi) {
  return mount(NodePanel, {
    props: { node },
    global: { provide: { structureApi: api } },
  })
}

describe('NodePanel — verbs on top (§1.12.1)', () => {
  it('shows the empty-state teaching buttons when counts are zero, not passive captions', async () => {
    setupFetch({ '/invites': { links: [] } })
    const wrapper = mountPanel(makeNode(), makeApi())
    await flushPromises()
    const verbButtons = wrapper.findAll('.verb-btn').map((b) => b.text())
    expect(verbButtons).toContain('No teachers yet → Invite one')
    expect(verbButtons).toContain('No groups below yet → Add one')
    expect(verbButtons).toContain('See progress')
  })

  it('shows task-forward (not empty-state) copy once counts are non-zero', async () => {
    setupFetch({ '/invites': { links: [] } })
    const node = makeNode({ rollup: { childGroupCount: 2, teacherCount: 3, classCount: 1, learnerCount: 10 } })
    const wrapper = mountPanel(node, makeApi())
    await flushPromises()
    const verbButtons = wrapper.findAll('.verb-btn').map((b) => b.text())
    expect(verbButtons).toContain('Invite a teacher')
    expect(verbButtons).toContain('Add a group')
  })

  it('"See progress" calls openDashboard with no intermediate form', async () => {
    setupFetch({ '/invites': { links: [] } })
    const api = makeApi()
    const wrapper = mountPanel(makeNode(), api)
    await flushPromises()
    await wrapper.findAll('.verb-btn').find((b) => b.text() === 'See progress')!.trigger('click')
    expect(api.openDashboard).toHaveBeenCalledWith(expect.objectContaining({ id: 'group-a' }))
  })

  it('the invite verb opens a role picker and submits via the shared api', async () => {
    setupFetch({ '/invites': { links: [] } })
    const api = makeApi()
    const wrapper = mountPanel(makeNode(), api)
    await flushPromises()
    await wrapper.findAll('.verb-btn')[0].trigger('click')
    await wrapper.find('.verb-form .btn-primary-sm').trigger('click')
    expect(api.submitInvite).toHaveBeenCalledWith(expect.objectContaining({ id: 'group-a' }), { role: 'teacher' })
  })

  it('the add-group verb submits via the shared api', async () => {
    setupFetch({ '/invites': { links: [] } })
    const api = makeApi()
    const wrapper = mountPanel(makeNode(), api)
    await flushPromises()
    await wrapper.findAll('.verb-btn')[1].trigger('click')
    await wrapper.find('.verb-form input.frost-input').setValue('New sub-group')
    await wrapper.find('.verb-form .btn-primary-sm').trigger('click')
    expect(api.createChild).toHaveBeenCalledWith('group-a', 'New sub-group', 'group', false)
  })
})

describe('NodePanel — refresh demo activity (demo nodes only, founder-ruled 2026-07-19)', () => {
  it('shows the verb only on demo nodes', async () => {
    setupFetch({ '/invites': { links: [] } })
    const plain = mountPanel(makeNode(), makeApi())
    await flushPromises()
    expect(plain.findAll('.verb-btn').map((b) => b.text())).not.toContain('Refresh demo activity')

    const demo = mountPanel(makeNode({ is_demo: true }), makeApi())
    await flushPromises()
    expect(demo.findAll('.verb-btn').map((b) => b.text())).toContain('Refresh demo activity')
  })

  it('posts to /api/groups/:id/demo-refresh and reports the regenerated activity', async () => {
    setupFetch({
      '/invites': { links: [] },
      '/demo-refresh': { success: true, noop: false, learnersTouched: 62, sessionsWritten: 540 },
    })
    const wrapper = mountPanel(makeNode({ is_demo: true }), makeApi())
    await flushPromises()
    await wrapper.findAll('.verb-btn').find((b) => b.text() === 'Refresh demo activity')!.trigger('click')
    await flushPromises()
    const call = fetchMock.mock.calls.find((c) => (c[0] as string).includes('/api/groups/group-a/demo-refresh'))
    expect(call).toBeTruthy()
    expect(call![1].method).toBe('POST')
    expect(wrapper.text()).toContain('62 learners')
    expect(wrapper.text()).toContain('540 practice sessions')
  })
})

describe('NodePanel — ways in, links-first (§1.10)', () => {
  it('renders existing invite links as ready-to-share URLs, grouped by role', async () => {
    setupFetch({
      '/invites': {
        links: [
          { role: 'teacher', url: 'https://app.example.com/redeem/ABC123', code: 'ABC123', limits: {}, useCount: 0 },
          { role: 'leader', url: 'https://app.example.com/group/DEF456', code: 'DEF456', limits: {}, useCount: 1 },
        ],
      },
    })
    const wrapper = mountPanel(makeNode(), makeApi())
    await flushPromises()
    const linkRows = wrapper.findAll('.link-row')
    expect(linkRows).toHaveLength(2)
    expect(wrapper.text()).toContain('https://app.example.com/redeem/ABC123')
    expect(wrapper.text()).toContain('https://app.example.com/group/DEF456')
  })

  it('shows a teaching hint (not a dead "manage in Invites" link) when there are no links yet', async () => {
    setupFetch({ '/invites': { links: [] } })
    const wrapper = mountPanel(makeNode(), makeApi())
    await flushPromises()
    expect(wrapper.text()).not.toContain('Manage in Invites')
    expect(wrapper.text()).toContain('No invite links yet')
  })
})

describe('NodePanel — progressive disclosure (§1.12.2)', () => {
  it('rename, relabel, delete and the courses control are hidden until "More" is opened', async () => {
    setupFetch({ '/invites': { links: [] } })
    const wrapper = mountPanel(makeNode(), makeApi())
    await flushPromises()
    expect(wrapper.find('.more-section').exists()).toBe(false)
    await wrapper.find('.more-toggle').trigger('click')
    expect(wrapper.find('.more-section').exists()).toBe(true)
  })
})

describe('NodePanel — plain language (§1.12.4)', () => {
  it('never says node, entitlement, subtree or primitive in visible copy', async () => {
    setupFetch({ '/invites': { links: [] } })
    const wrapper = mountPanel(makeNode(), makeApi())
    await flushPromises()
    await wrapper.find('.more-toggle').trigger('click')
    await flushPromises()
    const text = wrapper.text().toLowerCase()
    for (const banned of ['node', 'entitlement', 'subtree', 'primitive']) {
      expect(text).not.toContain(banned)
    }
  })
})
