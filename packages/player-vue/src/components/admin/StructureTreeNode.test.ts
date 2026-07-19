/**
 * Tests for StructureTreeNode.vue — the decluttered row (founder pass C,
 * 2026-07-19: "a bit of a mess"): name is the anchor, the label is quiet
 * plain text (Change label lives in the ⋯ menu), the ⋯ carries only
 * maintenance verbs, and one muted learner figure carries the size.
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
    requestDelete: vi.fn(),
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

describe('StructureTreeNode — label is quiet text; Change label lives in the ⋯ menu', () => {
  it('shows the label as plain text by default, no <select> in the DOM', () => {
    const wrapper = mountNode(makeNode({ label: 'school' }), makeApi())
    expect(wrapper.find('.label-word').exists()).toBe(true)
    expect(wrapper.find('.label-word').text()).toBe('school')
    expect(wrapper.find('select.label-select').exists()).toBe(false)
  })

  it('⋯ → Change label opens the picker; picking a value relabels and closes it again', async () => {
    const api = makeApi()
    const wrapper = mountNode(makeNode({ label: 'organisation' }), api)
    await wrapper.find('.overflow-toggle').trigger('click')
    await wrapper.findAll('.overflow-item').find((b) => b.text() === 'Change label')!.trigger('click')
    expect(wrapper.find('select.label-select').exists()).toBe(true)
    expect(wrapper.find('.label-word').exists()).toBe(false)
    await wrapper.find('select.label-select').setValue('school')
    expect(api.updateLabel).toHaveBeenCalledWith(expect.objectContaining({ id: 'group-a' }), 'school')
    expect(wrapper.find('select.label-select').exists()).toBe(false)
    expect(wrapper.find('.label-word').exists()).toBe(true)
  })

  it('LEA reads as an acronym', async () => {
    const wrapper = mountNode(makeNode({ label: 'lea' }), makeApi())
    expect(wrapper.find('.label-word').text()).toBe('LEA')
  })
})

describe('StructureTreeNode — decluttered row (founder pass C)', () => {
  it('shows one muted size figure (learners) with the full breakdown as tooltip', () => {
    const wrapper = mountNode(
      makeNode({ rollup: { childGroupCount: 0, teacherCount: 3, classCount: 4, learnerCount: 80 } }),
      makeApi(),
    )
    expect(wrapper.find('.structure-meta').text()).toBe('80 learners')
    expect(wrapper.find('.structure-meta').attributes('title')).toContain('3 teachers · 4 classes · 80 learners')
  })

  it('paid/active schools carry no status pill — only attention states show', () => {
    const active = mountNode(
      makeNode({ commercial: { schoolId: 's1', platformStatus: 'active', trialCourseCode: null, trialKind: null, platformExpiresAt: null, teacherSeats: 1 } }),
      makeApi(),
    )
    expect(active.find('.status-pill').exists()).toBe(false)
    const trial = mountNode(
      makeNode({ commercial: { schoolId: 's1', platformStatus: 'trial', trialCourseCode: 'spa', trialKind: null, platformExpiresAt: null, teacherSeats: 1 } }),
      makeApi(),
    )
    expect(trial.find('.status-pill').text()).toContain('trial')
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
    expect(items).toEqual(['Rename', 'Change label', 'Delete'])
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
