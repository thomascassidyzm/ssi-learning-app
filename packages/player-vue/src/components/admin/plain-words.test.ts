/**
 * Plain-words pin (THE-MODEL.md §1.12.4): "no 'node', 'entitlement',
 * 'primitive', 'subtree' in user-facing copy" — enforced by test across the
 * three Structure-surface files a school leader actually reads: the
 * page (AdminStructure.vue), the tree row (StructureTreeNode.vue), and the
 * courses control (NodeEntitlementControl.vue). Checks RENDERED text, not
 * source — class names, prop names and code comments are exempt by design
 * (only what the browser paints matters here).
 */
import { describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ref } from 'vue'
import router from '@/router/index'
import AdminStructure from '@/views/admin/AdminStructure.vue'
import StructureTreeNode from './StructureTreeNode.vue'
import NodeEntitlementControl from '@/components/schools/NodeEntitlementControl.vue'
import type { StructureApi, StructureNode } from './structureApi'

const BANNED = ['node', 'entitlement', 'subtree', 'primitive']

function assertNoBannedWords(text: string): void {
  const lower = text.toLowerCase()
  for (const word of BANNED) {
    expect(lower).not.toContain(word)
  }
}

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
    is_demo: true,
    is_test: false,
    rollup: { childGroupCount: 2, teacherCount: 3, classCount: 1, learnerCount: 10 },
    commercial: { schoolId: 's1', platformStatus: 'trial', trialCourseCode: 'spa_for_eng', trialKind: 'premium', platformExpiresAt: null, teacherSeats: 3 },
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
    requestDelete: vi.fn(),
    drillInto: vi.fn(),
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

describe('Structure surface — plain words only (§1.12.4)', () => {
  it('AdminStructure.vue renders no banned words', async () => {
    setupFetch({
      '/api/groups/tree': { roots: [makeNode()] },
      '/api/groups/table': { rows: [makeNode()], total: 1, page: 1, pageSize: 25 },
      '/invites': { links: [] },
    })
    await router.push('/admin/structure')
    await router.isReady()
    const wrapper = mount(AdminStructure, { global: { plugins: [router] } })
    await flushPromises()
    assertNoBannedWords(wrapper.text())
    vi.unstubAllGlobals()
  })

  it('StructureTreeNode.vue renders no banned words, including the ⋯ menu, label picker and demo/status pills', async () => {
    const wrapper = mount(StructureTreeNode, {
      props: { node: makeNode(), depth: 0 },
      global: { provide: { structureApi: makeApi() } },
    })
    assertNoBannedWords(wrapper.text())
    await wrapper.find('.overflow-toggle').trigger('click')
    assertNoBannedWords(wrapper.text())
    const changeLabel = wrapper.findAll('.overflow-item').find((b) => b.text() === 'Change label')!
    await changeLabel.trigger('click')
    assertNoBannedWords(wrapper.text())
  })

  it('NodeEntitlementControl.vue renders no banned words in any state (loading, trial, paid, not-set)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ grants: [] }) })))
    const notSet = mount(NodeEntitlementControl, { props: { nodeId: 's1', nodeType: 'school' } })
    await flushPromises()
    assertNoBannedWords(notSet.text())

    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ grants: [{ id: 'g1', state: 'trial', granted_courses: ['spa_for_eng'], expires_at: null }] }),
    })))
    const trial = mount(NodeEntitlementControl, { props: { nodeId: 's1', nodeType: 'school' } })
    await flushPromises()
    assertNoBannedWords(trial.text())

    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ grants: [{ id: 'g1', state: 'paid', granted_courses: [], expires_at: null }] }),
    })))
    const paid = mount(NodeEntitlementControl, { props: { nodeId: 's1', nodeType: 'school' } })
    await flushPromises()
    assertNoBannedWords(paid.text())
    vi.unstubAllGlobals()
  })
})
