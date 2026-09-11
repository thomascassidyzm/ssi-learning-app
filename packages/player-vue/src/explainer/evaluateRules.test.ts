// Pins for the self-explaining dashboard's rule evaluator AND for the four
// shipped noticing rules from the compiled pack — fixtures shaped like real
// /api/groups/:id/home payloads (archive/docs-retired-2026-08-24/self-explaining-dashboard.md §5).
import { describe, it, expect } from 'vitest'
import { evaluateRules, nodeKindOf, type NoticingRule } from './evaluateRules'
import pack from './pack.json'

const RULES = pack.rules as NoticingRule[]

const groupHome = (over: Record<string, unknown> = {}) => ({
  kind: 'node',
  node: { id: 'g1', name: 'IME Demo Programme', label: 'programme', commercial: null, hasSchool: false },
  children: [],
  classPractice: { inAppMinutes7d: 720, phrases7d: 300, activeClasses7d: 2, classCount: 5 },
  ...over,
})

const classHome = (over: Record<string, unknown> = {}) => ({
  kind: 'class',
  node: { id: 'c1', name: 'Grade 6A', label: 'class', commercial: null },
  students: [],
  classPractice: { phrases7d: 120, inAppMinutes7d: 95, lastPractisedAt: '2026-07-25', phrases: [] },
  ...over,
})

describe('nodeKindOf', () => {
  it('maps payloads to group / school / class', () => {
    expect(nodeKindOf(groupHome())).toBe('group')
    expect(nodeKindOf(groupHome({ node: { id: 's', name: 'S', commercial: { schoolId: 'x' } } }))).toBe('school')
    expect(nodeKindOf(classHome())).toBe('class')
  })

  // Tom's ruling 2026-09-08 (job #409): the kind is derived from structure,
  // never from a label anyone picks. This pin FAILED on the label-first code.
  it('reads structure, never the label', () => {
    // Label says school, structure says groups-only → group.
    expect(nodeKindOf(groupHome({
      node: { id: 's', name: 'S', label: 'school', commercial: null, hasSchool: false, rollup: { childGroupCount: 2, teacherCount: 0, classCount: 0, learnerCount: 8 } },
    }))).toBe('group')
    // Label says organisation, but it has grown its own classes → school.
    expect(nodeKindOf(groupHome({
      node: { id: 'o', name: 'O', label: 'organisation', commercial: null, hasSchool: false, rollup: { childGroupCount: 0, teacherCount: 1, classCount: 3, learnerCount: 30 } },
    }))).toBe('school')
    // A council OVER schools is a group in education dressing, not a school.
    expect(nodeKindOf(groupHome({
      node: { id: 'c', name: 'Council', label: 'programme', commercial: null, hasSchool: false, rollup: { childGroupCount: 3, teacherCount: 12, classCount: 40, learnerCount: 900 } },
    }))).toBe('group')
  })
})

describe('shipped rules', () => {
  it('silent-class fires only for a class that practised before but not this week', () => {
    const quiet = classHome({ classPractice: { phrases7d: 0, inAppMinutes7d: 0, lastPractisedAt: '2026-06-01', phrases: [] } })
    const invs = evaluateRules(RULES, quiet, 'admin', false)
    expect(invs.map((i) => i.ruleId)).toContain('silent-class')
    expect(invs.find((i) => i.ruleId === 'silent-class')!.to).toBe('/admin/classes/c1/insights')

    // active class → no invitation; never-practised class → no invitation
    expect(evaluateRules(RULES, classHome(), 'admin', false).map((i) => i.ruleId)).not.toContain('silent-class')
    const never = classHome({ classPractice: { phrases7d: 0, inAppMinutes7d: 0, lastPractisedAt: null, phrases: [] } })
    expect(evaluateRules(RULES, never, 'admin', false).map((i) => i.ruleId)).not.toContain('silent-class')
  })

  it('quiet-subtree fires when classes exist below but none practised this week', () => {
    const quiet = groupHome({ classPractice: { inAppMinutes7d: 0, phrases7d: 0, activeClasses7d: 0, classCount: 5 } })
    const invs = evaluateRules(RULES, quiet, 'leader', true)
    const inv = invs.find((i) => i.ruleId === 'quiet-subtree')
    expect(inv).toBeTruthy()
    expect(inv!.text).toContain('5 classes')
    expect(inv!.to).toBe('/org/g1?lens=classes')
    // no classes at all → silence, not a nag
    const empty = groupHome({ classPractice: { inAppMinutes7d: 0, phrases7d: 0, activeClasses7d: 0, classCount: 0 } })
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
      classPractice: { phrases7d: 0, inAppMinutes7d: 0, lastPractisedAt: null, phrases: [] },
      students: [student('a', 0, 4)],
    })
    expect(evaluateRules(RULES, dormant, 'admin', false).map((i) => i.ruleId)).not.toContain('students-quiet-week')
  })
})

describe('scoping', () => {
  it('filters by persona and node kind', () => {
    const quietClass = classHome({ classPractice: { phrases7d: 0, inAppMinutes7d: 0, lastPractisedAt: '2026-06-01', phrases: [] } })
    // teacher persona is authored but not wired — rules list admin/leader only
    expect(evaluateRules(RULES, quietClass, 'teacher', false)).toHaveLength(0)
    // class-kind rules never fire on a group payload
    const invs = evaluateRules(RULES, groupHome(), 'admin', false)
    expect(invs.map((i) => i.ruleId)).not.toContain('silent-class')
  })

  it('member flag drives member-scoped links', () => {
    const quiet = classHome({ classPractice: { phrases7d: 0, inAppMinutes7d: 0, lastPractisedAt: '2026-06-01', phrases: [] } })
    const inv = evaluateRules(RULES, quiet, 'leader', true).find((i) => i.ruleId === 'silent-class')
    expect(inv!.to).toBe('/org/c1/insights')
  })
})

// The neutral dressing (founder ruling 2026-08-02): an org node is
// structurally a group, so the surface passes kind 'org' and the rules are
// scoped by the VOCABULARY the viewer sees — never by the bones.
describe('dressing-aware scoping (org)', () => {
  const orgHome = (over: Record<string, unknown> = {}) => groupHome({
    node: {
      id: 'g1', name: 'Cardiff Council', label: 'group', commercial: null, hasSchool: false,
      rollup: { childGroupCount: 0, teacherCount: 0, classCount: 0, learnerCount: 0 },
    },
    classPractice: { inAppMinutes7d: 0, phrases7d: 0, activeClasses7d: 0, classCount: 0 },
    practiceHours: 0,
    ...over,
  })

  it('never hands an org the class/teacher-worded invitations', () => {
    // Same payload, education dressing: the class-worded rule fires.
    const withClasses = orgHome({ classPractice: { inAppMinutes7d: 0, phrases7d: 0, activeClasses7d: 0, classCount: 5 } })
    expect(evaluateRules(RULES, withClasses, 'leader', true).map((i) => i.ruleId)).toContain('quiet-subtree')
    // Neutral dressing: it does not.
    const neutral = evaluateRules(RULES, withClasses, 'leader', true, 'org').map((i) => i.ruleId)
    expect(neutral).not.toContain('quiet-subtree')
    expect(neutral).not.toContain('school-no-teachers')
  })

  it('org-needs-first-person offers the neutral walk on an empty org', () => {
    const inv = evaluateRules(RULES, orgHome(), 'leader', true, 'org').find((i) => i.ruleId === 'org-needs-first-person')
    expect(inv!.walk).toBe('invite-first-person')
    expect(inv!.text).not.toMatch(/teacher|class|school/i)
  })

  it('org-not-started fires once people are in but nobody has practised', () => {
    const home = orgHome({
      node: {
        id: 'g1', name: 'Cardiff Council', label: 'group', commercial: null, hasSchool: false,
        rollup: { childGroupCount: 1, teacherCount: 0, classCount: 0, learnerCount: 12 },
      },
    })
    const ids = evaluateRules(RULES, home, 'leader', true, 'org').map((i) => i.ruleId)
    expect(ids).toContain('org-not-started')
    expect(ids).not.toContain('org-needs-first-person')
    const inv = evaluateRules(RULES, home, 'leader', true, 'org').find((i) => i.ruleId === 'org-not-started')
    expect(inv!.text).toContain('12 people')
    expect(inv!.to).toBe('/org/g1/insights')
    // practice recorded → the invitation goes away
    expect(evaluateRules(RULES, { ...home, practiceHours: 4 }, 'leader', true, 'org').map((i) => i.ruleId))
      .not.toContain('org-not-started')
  })

  it('group-nobody-in-it points at the empty child group', () => {
    const home = orgHome({
      children: [
        { id: 'c-empty', name: 'North Team', label: 'group', hasSchool: false, rollup: { childGroupCount: 0, teacherCount: 0, classCount: 0, learnerCount: 0 } },
        { id: 'c-full', name: 'South Team', label: 'group', hasSchool: false, rollup: { childGroupCount: 0, teacherCount: 0, classCount: 0, learnerCount: 9 } },
      ],
    })
    const inv = evaluateRules(RULES, home, 'leader', true, 'org').find((i) => i.ruleId.startsWith('group-nobody-in-it'))
    expect(inv!.text).toContain('North Team')
    expect(inv!.ctaLabel).toBe('Open North Team')
    expect(inv!.to).toBe('/org/c-empty')
  })

  it('the org explanations and invitations stay free of school vocabulary', () => {
    const orgRules = (RULES as NoticingRule[]).filter((r) => r.kinds.includes('org'))
    expect(orgRules.length).toBeGreaterThanOrEqual(3)
    for (const r of orgRules) expect(r.invitation).not.toMatch(/\b(teacher|class|classes|school|pupil)\b/i)
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
