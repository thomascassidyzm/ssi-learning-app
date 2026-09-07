/**
 * BELOW THIS is DRAWN, not filtered (founder ruling 2026-09-07).
 *
 * The bug this pins: NPTC Group's panel said "Nothing below this yet" while
 * the very same page's chips knew about two classes and a teacher — because
 * the default slice was direct child NODES only, and a school's classes hang
 * off the school, not off a child group. The tree has to put the classes
 * where they actually live, at every depth, in one pass.
 */
import { describe, it, expect } from 'vitest'
import { buildBelowTree, isEmptyNode, flattenNodes } from './belowTree'

const NPTC = {
  node: { id: 'n-nptc', name: 'NPTC Group', label: 'school', hasSchool: true, rollup: { learnerCount: 0 } },
  children: [],
  tree: {
    nodes: [],
    classes: [
      { id: 'c1', name: 'All Learners', nodeId: 'n-nptc', teachers: ['karen.jones'], studentCount: 0 },
      { id: 'c2', name: 'AS Tutorial 1', nodeId: 'n-nptc', teachers: ['karen.jones'], studentCount: 0 },
    ],
    staff: [{ user_id: 'u-karen', name: 'karen.jones', nodeId: 'n-nptc' }],
  },
}

describe('buildBelowTree — the shape, not a slice', () => {
  it('draws a school with no child groups as its classes and staff (the NPTC "nothing below this" defect)', () => {
    const tree = buildBelowTree(NPTC)!
    expect(tree.name).toBe('NPTC Group')
    expect(tree.children).toEqual([])
    expect(tree.classes.map((c) => c.name)).toEqual(['All Learners', 'AS Tutorial 1'])
    expect(tree.staff.map((p) => p.name)).toEqual(['karen.jones'])
    expect(isEmptyNode(tree)).toBe(false)
  })

  it('nests nodes by parent, and hangs each class off the node that holds it', () => {
    const tree = buildBelowTree({
      node: { id: 'root', name: 'Region', label: 'region', rollup: { learnerCount: 40, childGroupCount: 2 } },
      tree: {
        nodes: [
          { id: 'sB', name: 'Beta School', label: 'school', parentId: 'root', hasSchool: true, rollup: { learnerCount: 10, childGroupCount: 0 } },
          { id: 'sA', name: 'Alpha School', label: 'school', parentId: 'root', hasSchool: true, rollup: { learnerCount: 30, childGroupCount: 1 } },
          { id: 'sA1', name: 'Alpha Annexe', label: 'group', parentId: 'sA', rollup: { learnerCount: 5, childGroupCount: 0 } },
        ],
        classes: [
          { id: 'c1', name: 'Year 7', nodeId: 'sA', teachers: [], studentCount: 12 },
          { id: 'c2', name: 'Year 8', nodeId: 'sA1', teachers: ['t'], studentCount: 5 },
        ],
        staff: [],
      },
    })!
    expect(tree.children.map((c) => c.name)).toEqual(['Alpha School', 'Beta School'])
    const alpha = tree.children[0]
    expect(alpha.children.map((c) => c.name)).toEqual(['Alpha Annexe'])
    expect(alpha.classes.map((c) => c.name)).toEqual(['Year 7'])
    expect(alpha.children[0].classes.map((c) => c.name)).toEqual(['Year 8'])
    expect(flattenNodes(tree)).toHaveLength(4)
  })

  it('an empty group LOOKS empty — nothing under it, and nothing written there', () => {
    const tree = buildBelowTree({
      node: { id: 'root', name: 'Killay Country Council', label: 'organisation', rollup: { learnerCount: 0 } },
      tree: {
        nodes: [{ id: 'g1', name: 'Team One', label: 'group', parentId: 'root', rollup: { learnerCount: 0, childGroupCount: 0 } }],
        classes: [],
        staff: [],
      },
    })!
    const team = tree.children[0]
    expect(isEmptyNode(team)).toBe(true)
    expect(team.classes).toEqual([])
    expect(team.learners).toBe(0)
  })

  it('counts child groups the payload did not carry rather than dropping them', () => {
    const tree = buildBelowTree({
      node: { id: 'root', name: 'Nation', label: 'nation', rollup: { learnerCount: 0 } },
      tree: {
        nodes: [{ id: 'g1', name: 'Region', label: 'region', parentId: 'root', rollup: { learnerCount: 3, childGroupCount: 4 } }],
        classes: [],
        staff: [],
      },
    })!
    expect(tree.children[0].hiddenGroups).toBe(4)
    expect(tree.hiddenGroups).toBe(0)
  })

  it('falls back to children + classes when the payload has no tree (a mission world, or an older server)', () => {
    const tree = buildBelowTree({
      node: { id: 'root', name: 'Demo School', label: 'school' },
      children: [{ id: 'g1', name: 'Sixth Form', label: 'group', rollup: { learnerCount: 9 } }],
      classes: [{ id: 'c1', name: 'Year 5', teachers: ['Mr Ellis'], studentCount: 28 }],
    })!
    expect(tree.children.map((c) => c.name)).toEqual(['Sixth Form'])
    expect(tree.classes.map((c) => c.name)).toEqual(['Year 5'])
  })

  it('is null without a node, and never loses a row whose parent is missing', () => {
    expect(buildBelowTree(null)).toBeNull()
    const tree = buildBelowTree({
      node: { id: 'root', name: 'Org' },
      tree: {
        nodes: [{ id: 'x', name: 'Orphan', label: 'group', parentId: 'gone', rollup: { learnerCount: 1 } }],
        classes: [{ id: 'c', name: 'Stray', nodeId: 'gone', teachers: [], studentCount: 0 }],
        staff: [{ user_id: 'u', name: 'Nobody', nodeId: 'gone' }],
      },
    })!
    expect(tree.children.map((c) => c.name)).toEqual(['Orphan'])
    expect(tree.classes.map((c) => c.name)).toEqual(['Stray'])
    expect(tree.staff.map((p) => p.name)).toEqual(['Nobody'])
  })
})
