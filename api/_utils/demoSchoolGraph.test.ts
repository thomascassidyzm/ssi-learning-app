/**
 * Tests for discoverDemoOrgGraph — the dynamic graph walk that finds every
 * row belonging to a demo org RIGHT NOW (including schools/classes a real
 * member created themselves after seeding/adoption), reused by both
 * purgeDemoOrg and expire/extend's staff ban/unban sweep.
 */
import { describe, it, expect } from 'vitest'
import { discoverDemoOrgGraph } from './demoSchoolGraph'

interface DB {
  schools: any[]
  classes: any[]
  govt_admins: any[]
  user_tags: any[]
  groups?: any[]
}

function makeSupabase(db: DB) {
  return {
    from(table: string) {
      let rows: any[] = [...((db as any)[table] ?? [])]
      const builder: any = {
        select: () => builder,
        eq: (col: string, val: unknown) => { rows = rows.filter((r) => r[col] === val); return builder },
        in: (col: string, vals: unknown[]) => { rows = rows.filter((r) => vals.includes(r[col])); return builder },
        then: (resolve: any) => Promise.resolve({ data: rows, error: null }).then(resolve),
      }
      return builder
    },
  } as any
}

describe('discoverDemoOrgGraph', () => {
  it('finds a school a member created themselves under the org group, and its teacher/students', async () => {
    // The seed-time school (school-seed) plus one the govt_admin leader
    // created later via /api/govt/create-school (school-member) — both
    // share group_id, so both are in scope, exactly like purgeDemoOrg's
    // pre-existing behaviour for schools/classes.
    const db: DB = {
      groups: [{ id: 'group-1', path: 'group-1' }],
      schools: [
        { id: 'school-seed', group_id: 'group-1', admin_user_id: 'admin-seed' },
        { id: 'school-member', group_id: 'group-1', admin_user_id: null },
      ],
      classes: [
        { id: 'class-member', school_id: 'school-member', teacher_user_id: 'teacher-member', class_learner_id: 'cl-1' },
      ],
      govt_admins: [{ user_id: 'leader-1', group_id: 'group-1' }],
      user_tags: [
        { tag_value: 'CLASS:class-member', user_id: 'student-1', role_in_context: 'student' },
      ],
    }
    const graph = await discoverDemoOrgGraph(makeSupabase(db), { group_id: 'group-1', school_id: null })

    expect(graph.schoolIds.sort()).toEqual(['school-member', 'school-seed'])
    expect(graph.classIds).toEqual(['class-member'])
    expect(graph.classLearnerIds).toEqual(['cl-1'])
    expect(graph.staffAuthUids.sort()).toEqual(['admin-seed', 'leader-1', 'teacher-member'])
    expect(graph.studentUserIds).toEqual(['student-1'])
  })

  it('a school outside the group is never included', async () => {
    const db: DB = {
      groups: [{ id: 'group-1', path: 'group-1' }, { id: 'group-2', path: 'group-2' }],
      schools: [
        { id: 'school-in', group_id: 'group-1', admin_user_id: 'admin-in' },
        { id: 'school-other', group_id: 'group-2', admin_user_id: 'admin-other' },
      ],
      classes: [],
      govt_admins: [],
      user_tags: [],
    }
    const graph = await discoverDemoOrgGraph(makeSupabase(db), { group_id: 'group-1', school_id: null })
    expect(graph.schoolIds).toEqual(['school-in'])
    expect(graph.staffAuthUids).toEqual(['admin-in'])
  })

  it('a single-school org (no group_id) is scoped by demo_orgs.school_id alone', async () => {
    const db: DB = {
      schools: [{ id: 'school-solo', group_id: null, admin_user_id: 'admin-solo' }],
      classes: [],
      govt_admins: [],
      user_tags: [],
    }
    const graph = await discoverDemoOrgGraph(makeSupabase(db), { group_id: null, school_id: 'school-solo' })
    expect(graph.schoolIds).toEqual(['school-solo'])
    expect(graph.staffAuthUids).toEqual(['admin-solo'])
  })

  it('returns empty arrays for an org with no group_id and no school_id', async () => {
    const db: DB = { schools: [], classes: [], govt_admins: [], user_tags: [] }
    const graph = await discoverDemoOrgGraph(makeSupabase(db), { group_id: null, school_id: null })
    expect(graph).toEqual({ groupIds: [], schoolIds: [], classIds: [], classLearnerIds: [], staffAuthUids: [], studentUserIds: [] })
  })

  it('dedupes staff auth uids (e.g. the same person is both a school admin and a class teacher)', async () => {
    const db: DB = {
      groups: [{ id: 'group-1', path: 'group-1' }],
      schools: [{ id: 'school-1', group_id: 'group-1', admin_user_id: 'person-1' }],
      classes: [{ id: 'class-1', school_id: 'school-1', teacher_user_id: 'person-1', class_learner_id: null }],
      govt_admins: [],
      user_tags: [],
    }
    const graph = await discoverDemoOrgGraph(makeSupabase(db), { group_id: 'group-1', school_id: null })
    expect(graph.staffAuthUids).toEqual(['person-1'])
    expect(graph.classLearnerIds).toEqual([])
  })

  it('reaches a school several levels below the org root — the founder org model (arbitrary-depth groups tree)', async () => {
    const db: DB = {
      groups: [
        { id: 'org-root', path: 'org-root', parent_id: null },
        { id: 'region', path: 'org-root/region', parent_id: 'org-root' },
        { id: 'district', path: 'org-root/region/district', parent_id: 'region' },
        // a same-prefix sibling group must NOT be swept in
        { id: 'org-root-2', path: 'org-root-2', parent_id: null },
      ],
      schools: [
        { id: 'school-deep', group_id: 'district', admin_user_id: 'admin-deep' },
        { id: 'school-sibling-org', group_id: 'org-root-2', admin_user_id: 'admin-sibling' },
      ],
      classes: [],
      govt_admins: [{ user_id: 'leader-district', group_id: 'district' }],
      user_tags: [],
    }
    const graph = await discoverDemoOrgGraph(makeSupabase(db), { group_id: 'org-root', school_id: null })
    expect(graph.groupIds.sort()).toEqual(['district', 'org-root', 'region'])
    expect(graph.schoolIds).toEqual(['school-deep'])
    expect(graph.staffAuthUids).toEqual(['admin-deep', 'leader-district'])
  })
})
