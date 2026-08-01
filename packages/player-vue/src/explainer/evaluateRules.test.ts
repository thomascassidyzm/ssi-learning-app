// Pins for the self-explaining dashboard's rule evaluator AND for the four
// shipped noticing rules from the compiled pack — fixtures shaped like real
// /api/groups/:id/home payloads (docs/self-explaining-dashboard.md §5).
import { describe, it, expect } from 'vitest'
import { evaluateRules, nodeKindOf, type NoticingRule } from './evaluateRules'
import pack from './pack.json'

const RULES = pack.rules as NoticingRule[]

const groupHome = (over: Record<string, unknown> = {}) => ({
  kind: 'node',
  node: { id: 'g1', name: 'IME Demo Programme', label: 'programme', commercial: null, hasSchool: false },
  children: [],
  classPractice: { hours: 12, sessions7d: 3, activeClasses7d: 2, classCount: 5 },
  ...over,
})

const classHome = (over: Record<string, unknown> = {}) => ({
  kind: 'class',
  node: { id: 'c1', name: 'Grade 6A', label: 'class', commercial: null },
  students: [],
  classPractice: { weekSessions: 2, sessions28d: 6, totalSessions: 40, lastSessionAt: '2026-07-25', hours: 18 },
  ...over,
})

describe('nodeKindOf', () => {
  it('maps payloads to group / school / class', () => {
    expect(nodeKindOf(groupHome())).toBe('group')
    expect(nodeKindOf(groupHome({ node: { id: 's', name: 'S', commercial: { schoolId: 'x' } } }))).toBe('school')
    expect(nodeKindOf(classHome())).toBe('class')
  })
})

describe('shipped rules', () => {
  it('silent-class fires only for a class that practised before but not this week', () => {
    const quiet = classHome({ classPractice: { weekSessions: 0, totalSessions: 40, hours: 18 } })
    const invs = evaluateRules(RULES, quiet, 'admin', false)
    expect(invs.map((i) => i.ruleId)).toContain('silent-class')
    expect(invs.find((i) => i.ruleId === 'silent-class')!.to).toBe('/admin/classes/c1/insights')

    // active class → no invitation; never-practised class → no invitation
    expect(evaluateRules(RULES, classHome(), 'admin', false).map((i) => i.ruleId)).not.toContain('silent-class')
    const never = classHome({ classPractice: { weekSessions: 0, totalSessions: 0, hours: 0 } })
    expect(evaluateRules(RULES, never, 'admin', false).map((i) => i.ruleId)).not.toContain('silent-class')
  })

  it('quiet-subtree fires when classes exist below but none practised this week', () => {
    const quiet = groupHome({ classPractice: { hours: 0, sessions7d: 0, activeClasses7d: 0, classCount: 5 } })
    const invs = evaluateRules(RULES, quiet, 'leader', true)
    const inv = invs.find((i) => i.ruleId === 'quiet-subtree')
    expect(inv).toBeTruthy()
    expect(inv!.text).toContain('5 classes')
    expect(inv!.to).toBe('/org/g1?lens=classes')
    // no classes at all → silence, not a nag
    const empty = groupHome({ classPractice: { hours: 0, sessions7d: 0, activeClasses7d: 0, classCount: 0 } })
    expect(evaluateRules(RULES, empty, 'leader', true).map((i) => i.ruleId)).not.toContain('quiet-subtree')
  })

  it('school-no-teachers fires per teacherless school child, capped at 3', () => {
    const mk = (n: number) => ({
      id: `s${n}`, name: `School ${n}`, hasSchool: true,
      rollup: { teacherCount: 0, classCount: 0, learnerCount: 10, childGroupCount: 0 },
    })
    const home = groupHome({ children: [mk(1), mk(2), mk(3), mk(4), { id: 'ok', name: 'Staffed', hasSchool: true, rollup: { teacherCount: 3 } }] })
    const invs = evaluateRules(RULES, home, 'admin', false).filter((i) => i.ruleId === 'school-no-teachers')
    expect(invs).toHaveLength(3) // capped
    expect(invs[0].text).toBe('School 1 has no teachers yet — its teacher link gets them started.')
    expect(invs[0].to).toBe('/admin/groups/s1') // the school child's NODE home, admin mount
  })

  it('students-quiet-week counts previously-active students with a silent week, only in an active class', () => {
    const student = (name: string, weekMin: number, hours: number) => ({
      learner_id: name, name, week_minutes: weekMin, practice_hours: hours,
    })
    const home = classHome({ students: [student('a', 0, 4), student('b', 0, 2), student('c', 30, 5), student('d', 0, 0)] })
    const inv = evaluateRules(RULES, home, 'admin', false).find((i) => i.ruleId === 'students-quiet-week')
    expect(inv).toBeTruthy()
    expect(inv!.text).toContain('2 of the students') // d never practised — not counted
    expect(inv!.to).toBe('') // students target = this page, no navigation
    // a class that never practises together doesn't nag about home practice
    const dormant = classHome({
      classPractice: { weekSessions: 0, totalSessions: 0, hours: 0 },
      students: [student('a', 0, 4)],
    })
    expect(evaluateRules(RULES, dormant, 'admin', false).map((i) => i.ruleId)).not.toContain('students-quiet-week')
  })
})

describe('scoping', () => {
  it('filters by persona and node kind', () => {
    const quietClass = classHome({ classPractice: { weekSessions: 0, totalSessions: 40, hours: 18 } })
    // teacher persona is authored but not wired — rules list admin/leader only
    expect(evaluateRules(RULES, quietClass, 'teacher', false)).toHaveLength(0)
    // class-kind rules never fire on a group payload
    const invs = evaluateRules(RULES, groupHome(), 'admin', false)
    expect(invs.map((i) => i.ruleId)).not.toContain('silent-class')
  })

  it('member flag drives member-scoped links', () => {
    const quiet = classHome({ classPractice: { weekSessions: 0, totalSessions: 40, hours: 18 } })
    const inv = evaluateRules(RULES, quiet, 'leader', true).find((i) => i.ruleId === 'silent-class')
    expect(inv!.to).toBe('/org/c1/insights')
  })
})

describe('pack integrity', () => {
  it('every pack rule resolves against a representative payload without throwing', () => {
    for (const home of [groupHome(), classHome()]) {
      expect(() => evaluateRules(RULES, home, 'admin', false)).not.toThrow()
    }
  })
  it('pack carries the four personas and a version', () => {
    expect(Object.keys(pack.explanations)).toEqual(expect.arrayContaining(['admin', 'leader', 'school_admin', 'teacher']))
    expect(pack.version).toMatch(/^[0-9a-f]{12}$/)
    expect(pack.explanations.admin.group).toContain('Invite a person')
  })
})
