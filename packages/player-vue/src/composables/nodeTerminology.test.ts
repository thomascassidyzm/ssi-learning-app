// THE RULE (Tom, 2026-09-08, job #409): the kind of an institution is derived
// from its structure — teachers or classes established means school, groups
// with neither means org — and NEVER from a label anyone picks. These pins
// are what stops the label leg growing back.
import { describe, it, expect } from 'vitest'
import { deriveInstitutionKind, derivePreset, hasSchoolStructure, isSchoolNode } from './nodeTerminology'

const rollup = (over: Partial<{ childGroupCount: number; teacherCount: number; classCount: number; learnerCount: number }> = {}) =>
  ({ childGroupCount: 0, teacherCount: 0, classCount: 0, learnerCount: 0, ...over })

const home = (node: Record<string, unknown>, over: Record<string, unknown> = {}) => ({
  kind: 'node',
  node: { id: 'n', name: 'N', hasSchool: false, commercial: null, rollup: rollup(), ...node },
  ancestors: [],
  children: [],
  ...over,
})

describe('deriveInstitutionKind — structure, never label', () => {
  it('teachers established → school', () => {
    expect(deriveInstitutionKind(home({ label: 'organisation', rollup: rollup({ teacherCount: 1 }) }))).toBe('school')
  })

  it('classes established → school', () => {
    expect(deriveInstitutionKind(home({ label: 'council', rollup: rollup({ classCount: 2 }) }))).toBe('school')
  })

  it('groups and neither teachers nor classes → org', () => {
    expect(deriveInstitutionKind(home({ label: 'organisation', rollup: rollup({ childGroupCount: 3, learnerCount: 40 }) }))).toBe('org')
  })

  it('a node whose LABEL says "school" but whose structure says otherwise does NOT derive school', () => {
    // This is the assertion that fails on the pre-ruling code, where
    // schoolish() short-circuited on label === 'school'.
    expect(deriveInstitutionKind(home({ label: 'school', rollup: rollup({ childGroupCount: 2, learnerCount: 12 }) }))).toBe('org')
    expect(derivePreset(home({ label: 'school' }))).toBe('neutral')
  })

  it('a class home is school by definition — a class is a group that has a teacher', () => {
    expect(deriveInstitutionKind({ kind: 'class', node: { id: 'c', name: 'Grade 6A', label: 'class' } })).toBe('school')
  })

  it('a schools row attached (the schools door on day one, no teachers yet) → school', () => {
    expect(deriveInstitutionKind(home({ label: 'organisation', hasSchool: true }))).toBe('school')
    expect(deriveInstitutionKind(home({ commercial: { schoolId: 's1', platformStatus: 'trial' } }))).toBe('school')
  })

  it('mixed subtrees: a school above or below makes the node educational; a sibling org branch stays neutral', () => {
    expect(deriveInstitutionKind(home({}, { ancestors: [{ id: 'a', name: 'A School', hasSchool: true }] }))).toBe('school')
    expect(deriveInstitutionKind(home({}, { children: [{ id: 'c', name: 'C', hasSchool: false, rollup: rollup({ teacherCount: 2 }) }] }))).toBe('school')
    expect(deriveInstitutionKind(home({ label: 'department' }, {
      ancestors: [{ id: 'council', name: 'Cardiff Council', label: 'organisation', hasSchool: false }],
      children: [{ id: 'team', name: 'North Team', label: 'group', hasSchool: false, rollup: rollup({ learnerCount: 5 }) }],
    }))).toBe('org')
  })

  it('college and university get no third vocabulary — they are whatever their structure says', () => {
    expect(deriveInstitutionKind(home({ label: 'university', rollup: rollup({ classCount: 9 }) }))).toBe('school')
    expect(deriveInstitutionKind(home({ label: 'college', rollup: rollup({ childGroupCount: 4, learnerCount: 300 }) }))).toBe('org')
  })

  it('no node → org (nothing to derive from is not a school)', () => {
    expect(deriveInstitutionKind(null)).toBe('org')
    expect(derivePreset(undefined)).toBe('neutral')
  })
})

describe('hasSchoolStructure / isSchoolNode', () => {
  it('a container over schools has school structure but is not itself a school', () => {
    const council = { hasSchool: false, commercial: null, rollup: rollup({ childGroupCount: 3, teacherCount: 12, classCount: 40 }) }
    expect(hasSchoolStructure(council)).toBe(true)
    expect(isSchoolNode(council)).toBe(false)
  })

  it('a leaf with its own teachers or classes is a school; a leaf with only learners is not', () => {
    expect(isSchoolNode({ rollup: rollup({ teacherCount: 1 }) })).toBe(true)
    expect(isSchoolNode({ rollup: rollup({ learnerCount: 30 }) })).toBe(false)
  })

  it('reads nothing but structure', () => {
    expect(hasSchoolStructure({ label: 'school', type: 'school', name: 'The School' })).toBe(false)
    expect(isSchoolNode({ label: 'school' })).toBe(false)
  })
})
