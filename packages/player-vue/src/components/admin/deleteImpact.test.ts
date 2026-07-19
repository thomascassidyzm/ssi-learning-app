// Honest-delete warning copy (founder pass C, 2026-07-19): the dialog names
// the actual consequence — sub-groups deleted, school-nodes deleted, legacy
// schools bubbling to top level, accounts kept.
import { describe, it, expect } from 'vitest'
import { formatDeleteImpactLines } from './deleteImpact'

describe('formatDeleteImpactLines', () => {
  it('names deleted sub-groups and schools, and orphaned legacy schools', () => {
    const lines = formatDeleteImpactLines({
      descendantGroupCount: 2,
      descendantGroupNames: ['Pilot Districts Region', 'Ysgol y Bont'],
      schoolCount: 1,
      schoolNames: ['Ysgol y Bont'],
      orphanedSchoolCount: 1,
      orphanedSchoolNames: ['Legacy High'],
      classCount: 3,
      sessionCount: 12,
      learnerCount: 40,
      teacherCount: 4,
      hasRealActivity: true,
    })
    expect(lines[0]).toContain('2 sub-groups')
    expect(lines[0]).toContain('Pilot Districts Region')
    expect(lines[1]).toContain('1 school')
    expect(lines[1]).toContain('Ysgol y Bont')
    expect(lines[2]).toContain('top level')
    expect(lines[2]).toContain('Legacy High')
    expect(lines[3]).toContain('3 classes')
    expect(lines[3]).toContain('12 recorded sessions')
    expect(lines[4]).toContain('accounts are kept')
  })

  it('truncates long name lists with a count of the rest', () => {
    const names = ['A', 'B', 'C', 'D', 'E', 'F', 'G']
    const lines = formatDeleteImpactLines({
      descendantGroupCount: 7,
      descendantGroupNames: names,
      sessionCount: 0,
      learnerCount: 0,
      teacherCount: 0,
      hasRealActivity: false,
    })
    expect(lines[0]).toContain('A, B, C, D, E and 2 more')
  })

  it('empty node says only this is deleted', () => {
    const lines = formatDeleteImpactLines({
      sessionCount: 0,
      learnerCount: 0,
      teacherCount: 0,
      hasRealActivity: false,
    })
    expect(lines).toEqual(['Nothing else is inside it — only this is deleted.'])
  })

  it('school impact (no group fields) reports classes/sessions and roster', () => {
    const lines = formatDeleteImpactLines({
      classCount: 2,
      sessionCount: 5,
      learnerCount: 10,
      teacherCount: 1,
      hasRealActivity: true,
    })
    expect(lines[0]).toContain('2 classes')
    expect(lines[1]).toContain('10 learners and 1 teacher')
  })

  it('null impact yields no lines (still loading)', () => {
    expect(formatDeleteImpactLines(null)).toEqual([])
  })
})
