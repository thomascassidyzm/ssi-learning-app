/**
 * Tests for directMemberPracticeSeconds — the practice term for people attached
 * DIRECTLY to a group node (user_tags tag_type='group') with no school or class
 * under them. Pins the live defect of 2026-08-06: an org with one group-tagged
 * learner and no schools reported 0 hours forever, so the explainer told its
 * leader "none of them has practised yet" while the learner's sessions sat in
 * the DB. Also pins the no-double-count rule against school-shaped orgs.
 */
import { describe, it, expect, vi } from 'vitest'
import { directMemberPracticeSeconds } from './directMemberPractice'

type Row = Record<string, unknown>

function makeSvc(tables: Record<string, Row[]>) {
  return {
    from(table: string) {
      const calls: { m: string; a: unknown[] }[] = []
      const builder: Record<string, unknown> = {}
      const chain = (m: string) => (...a: unknown[]) => { calls.push({ m, a }); return builder }
      builder.select = chain('select')
      builder.eq = chain('eq')
      builder.in = chain('in')
      builder.is = chain('is')
      builder.then = (resolve: (r: { data: Row[]; error: null }) => unknown) => {
        let rows = tables[table] || []
        for (const c of calls) {
          if (c.m === 'eq') rows = rows.filter((r) => r[c.a[0] as string] === c.a[1])
          else if (c.m === 'in') rows = rows.filter((r) => (c.a[1] as unknown[]).includes(r[c.a[0] as string]))
          else if (c.m === 'is') rows = rows.filter((r) => (r[c.a[0] as string] ?? null) === c.a[1])
        }
        return resolve({ data: rows, error: null })
      }
      return builder
    },
  } as never
}

// Deborah's live org shape: one organisation node, one person tagged straight
// onto it, no schools and no classes anywhere.
const DEB = {
  user_tags: [
    { tag_type: 'group', tag_value: 'GROUP:deb-org', role_in_context: 'student', user_id: 'test-person-uid', removed_at: null },
  ],
  learners: [{ id: 'test-person-learner', user_id: 'test-person-uid' }],
  sessions: [
    { learner_id: 'test-person-learner', duration_seconds: 182 },
    { learner_id: 'test-person-learner', duration_seconds: 61 },
  ],
}

describe('directMemberPracticeSeconds', () => {
  it('counts a group-attached learner whose org has no school at all', async () => {
    const seconds = await directMemberPracticeSeconds(makeSvc(DEB), {
      subtreeGroupIds: ['deb-org'],
      subtreeSchoolIds: [],
      subtreeClassIds: [],
    })
    expect(seconds).toBe(243)
  })

  it('returns 0 when nobody is tagged onto the subtree — the school-shaped org pays one lookup', async () => {
    const seconds = await directMemberPracticeSeconds(makeSvc({ ...DEB, user_tags: [] }), {
      subtreeGroupIds: ['programme'],
      subtreeSchoolIds: ['school-1'],
      subtreeClassIds: ['class-1'],
    })
    expect(seconds).toBe(0)
  })

  it('excludes a person the school-shaped rollup already counts (no double count)', async () => {
    const svc = makeSvc({
      ...DEB,
      user_tags: [
        ...DEB.user_tags,
        // Same person also sits in a class inside this subtree — their practice
        // already arrives via class_student_progress → school_summary.
        { tag_type: 'class', tag_value: 'CLASS:class-1', role_in_context: 'student', user_id: 'test-person-uid', removed_at: null },
      ],
    })
    const seconds = await directMemberPracticeSeconds(svc, {
      subtreeGroupIds: ['deb-org'],
      subtreeSchoolIds: ['school-1'],
      subtreeClassIds: ['class-1'],
    })
    expect(seconds).toBe(0)
  })

  it('ignores a removed group tag', async () => {
    const svc = makeSvc({
      ...DEB,
      user_tags: [{ ...DEB.user_tags[0], removed_at: '2026-08-06T09:00:00Z' }],
    })
    const seconds = await directMemberPracticeSeconds(svc, {
      subtreeGroupIds: ['deb-org'],
      subtreeSchoolIds: [],
      subtreeClassIds: [],
    })
    expect(seconds).toBe(0)
  })

  it('sums every learner account a person owns, and counts leaders too', async () => {
    const svc = makeSvc({
      user_tags: [
        { tag_type: 'group', tag_value: 'GROUP:deb-org', role_in_context: 'leader', user_id: 'leader-uid', removed_at: null },
      ],
      learners: [
        { id: 'leader-learner-a', user_id: 'leader-uid' },
        { id: 'leader-learner-b', user_id: 'leader-uid' },
      ],
      sessions: [
        { learner_id: 'leader-learner-a', duration_seconds: 600 },
        { learner_id: 'leader-learner-b', duration_seconds: 300 },
        { learner_id: 'someone-else', duration_seconds: 99999 },
      ],
    })
    const seconds = await directMemberPracticeSeconds(svc, {
      subtreeGroupIds: ['deb-org'],
      subtreeSchoolIds: [],
      subtreeClassIds: [],
    })
    expect(seconds).toBe(900)
  })

  it('walks the whole subtree, not just the node asked for', async () => {
    const svc = makeSvc({
      user_tags: [
        { tag_type: 'group', tag_value: 'GROUP:child-node', role_in_context: 'student', user_id: 'deep-uid', removed_at: null },
      ],
      learners: [{ id: 'deep-learner', user_id: 'deep-uid' }],
      sessions: [{ learner_id: 'deep-learner', duration_seconds: 1200 }],
    })
    const seconds = await directMemberPracticeSeconds(svc, {
      subtreeGroupIds: ['root-node', 'child-node'],
      subtreeSchoolIds: [],
      subtreeClassIds: [],
    })
    expect(seconds).toBe(1200)
  })

  it('returns 0 for an empty subtree without touching the DB', async () => {
    const from = vi.fn()
    const seconds = await directMemberPracticeSeconds({ from } as never, {
      subtreeGroupIds: [],
      subtreeSchoolIds: [],
      subtreeClassIds: [],
    })
    expect(seconds).toBe(0)
    expect(from).not.toHaveBeenCalled()
  })
})
