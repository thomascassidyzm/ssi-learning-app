/**
 * Tests for demoSchoolGen.ts — provisionDemoOrg, the create path behind
 * /admin/demos. Regression cover for the 2026-07-17 500 ("root leaf
 * provisioning failed: Could not resolve a course for this organisation"):
 * the leaf was provisioned BEFORE the demo_orgs row it tried to resolve the
 * course from. provisionDemoOrg must now succeed end-to-end for any playable
 * (live OR beta) course, and reject draft/not_available.
 */
import { describe, it, expect } from 'vitest'
import { provisionDemoOrg } from './demoSchoolGen'

function makeSupabase(db: any) {
  let nextId = 1
  const genId = (prefix: string) => `${prefix}-${nextId++}`
  return {
    from(table: string) {
      let rows: any[] = [...(db[table] ?? [])]
      let limitN: number | null = null
      const builder: any = {
        select: () => builder,
        eq: (col: string, val: unknown) => { rows = rows.filter((r) => r[col] === val); return builder },
        in: (col: string, vals: unknown[]) => { rows = rows.filter((r) => vals.includes(r[col])); return builder },
        limit: (n: number) => { limitN = n; return builder },
        maybeSingle: async () => {
          const scoped = limitN != null ? rows.slice(0, limitN) : rows
          return { data: scoped[0] ?? null, error: null }
        },
        insert: (row: any) => {
          const inserted = { id: genId(table), ...row }
          if (table === 'classes' && !inserted.student_join_code) {
            inserted.student_join_code = `CODE-${nextId}`
          }
          db[table] = db[table] ?? []
          db[table].push(inserted)
          return {
            select: () => ({ single: async () => ({ data: inserted, error: null }) }),
            then: (resolve: any) => Promise.resolve({ data: inserted, error: null }).then(resolve),
          }
        },
        update: (patch: any) => ({
          eq: (col: string, val: unknown) => {
            const target = (db[table] ?? []).find((r: any) => r[col] === val)
            if (target) Object.assign(target, patch)
            return Promise.resolve({ data: null, error: null })
          },
        }),
        upsert: async () => ({ data: null, error: null }),
        then: (resolve: any) => {
          const scoped = limitN != null ? rows.slice(0, limitN) : rows
          return Promise.resolve({ data: scoped, error: null }).then(resolve)
        },
      }
      return builder
    },
  } as any
}

function freshDb(courseStatus: string) {
  return {
    courses: [{ course_code: 'cym_s_for_eng', new_app_status: courseStatus }],
    groups: [],
    demo_orgs: [],
    schools: [],
    classes: [],
    invite_codes: [],
    learners: [],
    course_enrollments: [],
  } as any
}

describe('provisionDemoOrg', () => {
  it('creates the org root group + first joinable leaf end-to-end (the 500 regression)', async () => {
    const db = freshDb('live')
    const result = await provisionDemoOrg(makeSupabase(db), {
      prospectName: 'Welsh Health Department',
      courseCode: 'cym_s_for_eng',
      createdBy: 'admin-1',
    })

    expect(result.orgName).toBe('Welsh Health Department')
    expect(result.studentJoinCode).toBeTruthy()
    expect(db.groups).toHaveLength(1)
    expect(db.groups[0]).toMatchObject({ type: 'organisation', is_demo: true })
    expect(db.demo_orgs).toHaveLength(1)
    expect(db.demo_orgs[0]).toMatchObject({ group_id: result.groupId, course_code: 'cym_s_for_eng' })
    // The leaf carried the course through despite demo_orgs not existing yet.
    expect(db.classes[0]).toMatchObject({ course_code: 'cym_s_for_eng' })
  })

  it('accepts a beta course (any language pair a prospect wants)', async () => {
    const db = freshDb('beta')
    const result = await provisionDemoOrg(makeSupabase(db), {
      prospectName: 'Beta Prospect',
      courseCode: 'cym_s_for_eng',
      createdBy: 'admin-1',
    })
    expect(result.studentJoinCode).toBeTruthy()
    expect(db.classes[0]).toMatchObject({ course_code: 'cym_s_for_eng' })
  })

  it('rejects a not_available course before writing anything', async () => {
    const db = freshDb('not_available')
    await expect(provisionDemoOrg(makeSupabase(db), {
      prospectName: 'Phantom',
      courseCode: 'cym_s_for_eng',
      createdBy: 'admin-1',
    })).rejects.toThrow(/not an available course/)
    expect(db.groups).toHaveLength(0)
    expect(db.demo_orgs).toHaveLength(0)
  })
})
