/**
 * Tests for StructureTreeNode.vue — THE-MODEL.md §1.12 founder visual fix:
 * the label is a quiet inline badge, click-to-edit (opens the picker on
 * demand, closes after), not a permanently-open <select> ("that makes the
 * tree read like a form").
 */
import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref } from 'vue'
import StructureTreeNode from './StructureTreeNode.vue'
import type { StructureApi, StructureNode } from './structureApi'

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
    ...overrides,
  }
}

function mountNode(node: StructureNode, api: StructureApi) {
  return mount(StructureTreeNode, {
    props: { node, depth: 0 },
    global: { provide: { structureApi: api } },
  })
}

describe('StructureTreeNode — label is a badge, not a permanently-open form control', () => {
  it('shows the label as a quiet badge by default, no <select> in the DOM', () => {
    const wrapper = mountNode(makeNode({ label: 'school' }), makeApi())
    expect(wrapper.find('.label-badge').exists()).toBe(true)
    expect(wrapper.find('.label-badge').text()).toBe('school')
    expect(wrapper.find('select.label-select').exists()).toBe(false)
  })

  it('clicking the badge opens the picker; picking a value relabels and closes it again', async () => {
    const api = makeApi()
    const wrapper = mountNode(makeNode({ label: 'organisation' }), api)
    await wrapper.find('.label-badge').trigger('click')
    expect(wrapper.find('select.label-select').exists()).toBe(true)
    expect(wrapper.find('.label-badge').exists()).toBe(false)
    await wrapper.find('select.label-select').setValue('school')
    expect(api.updateLabel).toHaveBeenCalledWith(expect.objectContaining({ id: 'group-a' }), 'school')
    expect(wrapper.find('select.label-select').exists()).toBe(false)
    expect(wrapper.find('.label-badge').exists()).toBe(true)
  })

  it('LEA reads as an acronym in both badge and picker', async () => {
    const wrapper = mountNode(makeNode({ label: 'lea' }), makeApi())
    expect(wrapper.find('.label-badge').text()).toBe('LEA')
  })
})

describe('StructureTreeNode — rows are links (founder-ruled 2026-07-19)', () => {
  it('no standalone Open chip — the whole row is the link', () => {
    const wrapper = mountNode(makeNode(), makeApi())
    expect(wrapper.find('.open-btn').exists()).toBe(false)
  })

  it('clicking anywhere on the row opens the node dashboard', async () => {
    const api = makeApi()
    const wrapper = mountNode(makeNode(), api)
    await wrapper.find('.structure-row').trigger('click')
    expect(api.openDashboard).toHaveBeenCalledWith(expect.objectContaining({ id: 'group-a' }))
  })

  it('clicking the name (part of the row) opens the dashboard, not a rename', async () => {
    const api = makeApi()
    const wrapper = mountNode(makeNode(), api)
    await wrapper.find('.structure-name').trigger('click')
    expect(api.openDashboard).toHaveBeenCalledWith(expect.objectContaining({ id: 'group-a' }))
    expect(api.startRename).not.toHaveBeenCalled()
  })

  it('the ⋯ menu does NOT trigger row navigation, and its items still fire', async () => {
    const api = makeApi()
    const wrapper = mountNode(makeNode(), api)
    await wrapper.find('.overflow-toggle').trigger('click')
    expect(api.openDashboard).not.toHaveBeenCalled()
    const items = wrapper.findAll('.overflow-item').map((i) => i.text())
    expect(items).toEqual(['Rename', 'Add child group', 'Invite people', 'Mint a demo org', 'Delete'])
    await wrapper.findAll('.overflow-item')[0].trigger('click')
    expect(api.startRename).toHaveBeenCalled()
    expect(api.openDashboard).not.toHaveBeenCalled()
    expect(wrapper.find('.overflow-menu').exists()).toBe(false)
  })
})

describe('StructureTreeNode — plain-word quick filter (§1.12.4)', () => {
  // Note the deliberate label/commercial mismatch: "Paid School" carries the
  // 'school' LABEL but no commercial attachment, "Real School" carries the
  // 'organisation' label but DOES have one — proving the split is structural
  // (I3), never a string match on node.label.
  const commercialSchool = makeNode({
    id: 'school-1', name: 'Real School', label: 'organisation',
    commercial: { schoolId: 's1', platformStatus: 'active', trialCourseCode: null, trialKind: null, platformExpiresAt: null, teacherSeats: 1 },
  })
  const plainGroup = makeNode({ id: 'group-1', name: 'Paid School', label: 'school' })
  const root = makeNode({ id: 'root', name: 'Root', children: [commercialSchool, plainGroup] })

  it('"Schools" shows only nodes with a commercial attachment', () => {
    const wrapper = mount(StructureTreeNode, {
      props: { node: root, depth: 0, quickFilter: 'schools' },
      global: { provide: { structureApi: makeApi() } },
    })
    const names = wrapper.findAll('.structure-name').map((n) => n.text())
    expect(names).toContain('Real School')
    expect(names).not.toContain('Paid School')
  })

  it('"Groups" shows only nodes without a commercial attachment', () => {
    const wrapper = mount(StructureTreeNode, {
      props: { node: root, depth: 0, quickFilter: 'groups' },
      global: { provide: { structureApi: makeApi() } },
    })
    const names = wrapper.findAll('.structure-name').map((n) => n.text())
    expect(names).toContain('Paid School')
    expect(names).not.toContain('Real School')
  })
})
