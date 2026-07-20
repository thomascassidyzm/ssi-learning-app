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

function mountNode(node: StructureNode, api: StructureApi, extraProps: Record<string, unknown> = {}) {
  return mount(StructureTreeNode, {
    props: { node, depth: 0, ...extraProps },
    global: { provide: { structureApi: api } },
  })
}

describe('StructureTreeNode — the label word shows only where it disambiguates (founder-ruled 2026-07-20)', () => {
  it('hides the label word by default — indentation + typography carry the type', () => {
    const wrapper = mountNode(makeNode({ label: 'school' }), makeApi())
    expect(wrapper.find('.label-word').exists()).toBe(false)
    expect(wrapper.find('select.label-select').exists()).toBe(false)
  })

  it('shows it when the parent says the sibling set mixes labels', () => {
    const wrapper = mountNode(makeNode({ label: 'school' }), makeApi(), { showLabel: true })
    expect(wrapper.find('.label-word').text()).toBe('school')
  })

  it('children see the label word only when their sibling labels differ', () => {
    const mixed = makeNode({
      id: 'root-mixed',
      children: [makeNode({ id: 'c1', name: 'A Region', label: 'region' }), makeNode({ id: 'c2', name: 'B School', label: 'school' })],
    })
    const mixedWrapper = mountNode(mixed, makeApi())
    expect(mixedWrapper.findAll('.label-word')).toHaveLength(2)

    const uniform = makeNode({
      id: 'root-uniform',
      children: [makeNode({ id: 'c1', name: 'A School', label: 'school' }), makeNode({ id: 'c2', name: 'B School', label: 'school' })],
    })
    const uniformWrapper = mountNode(uniform, makeApi())
    expect(uniformWrapper.findAll('.label-word')).toHaveLength(0)
  })

  it('⋯ → Change label opens the picker even when the label word is hidden; picking relabels and closes', async () => {
    const api = makeApi()
    const wrapper = mountNode(makeNode({ label: 'organisation' }), api, { showLabel: true })
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
    const wrapper = mountNode(makeNode({ label: 'lea' }), makeApi(), { showLabel: true })
    expect(wrapper.find('.label-word').text()).toBe('LEA')
  })
})

describe('StructureTreeNode — demo marked once at the subtree root (founder-ruled 2026-07-20)', () => {
  const demoChild = makeNode({ id: 'demo-child', name: 'Demo School', is_demo: true })
  const demoRoot = makeNode({ id: 'demo-root', name: 'Demo Region', is_demo: true, children: [demoChild] })

  it('the demo subtree root carries the one Demo badge; descendants are silent', () => {
    const wrapper = mountNode(demoRoot, makeApi())
    expect(wrapper.findAll('.org-badge.is-demo')).toHaveLength(1)
  })

  it('a demo node under a real parent still gets its badge', () => {
    const wrapper = mountNode(makeNode({ is_demo: true }), makeApi(), { parentIsDemo: false })
    expect(wrapper.find('.org-badge.is-demo').exists()).toBe(true)
  })

  it('trial is normal state for a demo school — no pill; real orgs keep it', () => {
    const trialCommercial = { schoolId: 's1', platformStatus: 'trial', trialCourseCode: 'spa', trialKind: null, platformExpiresAt: null, teacherSeats: 1 }
    const demoTrial = mountNode(makeNode({ is_demo: true, commercial: trialCommercial }), makeApi())
    expect(demoTrial.find('.status-pill').exists()).toBe(false)
    const realTrial = mountNode(makeNode({ commercial: trialCommercial }), makeApi())
    expect(realTrial.find('.status-pill').text()).toContain('trial')
  })

  it('a real-org school inside a demo subtree hides trial too', () => {
    const trialCommercial = { schoolId: 's1', platformStatus: 'trial', trialCourseCode: 'spa', trialKind: null, platformExpiresAt: null, teacherSeats: 1 }
    const wrapper = mountNode(makeNode({ commercial: trialCommercial }), makeApi(), { parentIsDemo: true })
    expect(wrapper.find('.status-pill').exists()).toBe(false)
  })
})

describe('StructureTreeNode — hierarchy legible at a glance (founder-ruled 2026-07-20)', () => {
  it('depth 0 rows have no rails; nested rows draw one rail per ancestor level', () => {
    const grandchild = makeNode({ id: 'gc', name: 'Grandchild' })
    const child = makeNode({ id: 'c', name: 'Child', children: [grandchild] })
    const root = makeNode({ id: 'r', name: 'Root', children: [child] })
    const wrapper = mountNode(root, makeApi())
    const rows = wrapper.findAll('.structure-row')
    expect(rows[0].findAll('.rail')).toHaveLength(0)
    expect(rows[1].findAll('.rail')).toHaveLength(1)
    expect(rows[2].findAll('.rail')).toHaveLength(2)
  })

  it('name typography steps down by depth (roots strongest)', () => {
    const child = makeNode({ id: 'c', name: 'Child' })
    const root = makeNode({ id: 'r', name: 'Root', children: [child] })
    const wrapper = mountNode(root, makeApi())
    const names = wrapper.findAll('.structure-name')
    expect(names[0].classes()).toContain('depth-0')
    expect(names[1].classes()).toContain('depth-1')
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
