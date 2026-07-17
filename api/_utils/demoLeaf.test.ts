/**
 * Tests for demoLeaf.ts — the invisible school+class the Demos tool provisions
 * behind a group node so learners have something to join, without ever
 * surfacing a school/class/teacher concept in the UI.
 */
import { describe, it, expect } from 'vitest'
import { resolveDemoOrgCourseCode, ensureDemoLeafClass } from './demoLeaf'

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
          // Simulates the real DB's trigger-generated student_join_code
          // (classes.student_join_code is NOT NULL with a set-if-blank trigger).
          if (table === 'classes' && !inserted.student_join_code) {
            inserted.student_join_code = `CODE-${nextId}`
          }
          db[table] = db[table] ?? []
          db[table].push(inserted)
          return {
            select: () => ({
              single: async () => ({ data: inserted, error: null }),
            }),
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

describe('resolveDemoOrgCourseCode', () => {
  it('walks a nested group up to its root and reads the owning demo_orgs row', async () => {
    const db = {
      groups: [
        { id: 'root', parent_id: null },
        { id: 'child', parent_id: 'root' },
        { id: 'grandchild', parent_id: 'child' },
      ],
      demo_orgs: [{ id: 'org-1', group_id: 'root', course_code: 'fra_for_eng' }],
    }
    const code = await resolveDemoOrgCourseCode(makeSupabase(db), 'grandchild')
    expect(code).toBe('fra_for_eng')
  })

  it('returns null when no demo_orgs row owns the resolved root', async () => {
    const db = { groups: [{ id: 'root', parent_id: null }], demo_orgs: [] }
    const code = await resolveDemoOrgCourseCode(makeSupabase(db), 'root')
    expect(code).toBeNull()
  })
})

describe('ensureDemoLeafClass', () => {
  it('provisions a hidden school + class + invite code for a fresh group', async () => {
    const db: any = {
      groups: [{ id: 'root', name: 'Riverside Trust', parent_id: null }],
      demo_orgs: [{ id: 'org-1', group_id: 'root', course_code: 'fra_for_eng' }],
      schools: [],
      classes: [],
      invite_codes: [],
      learners: [],
      course_enrollments: [],
    }
    const supabase = makeSupabase(db)
    const result = await ensureDemoLeafClass(supabase, 'root', 'admin-1')

    expect('error' in result).toBe(false)
    if ('error' in result) throw new Error('unexpected error result')
    expect(result.created).toBe(true)
    expect(result.studentJoinCode).toBeTruthy()

    expect(db.schools).toHaveLength(1)
    expect(db.schools[0]).toMatchObject({ group_id: 'root', admin_user_id: null, is_demo: true })
    expect(db.classes).toHaveLength(1)
    expect(db.classes[0]).toMatchObject({ teacher_user_id: null, course_code: 'fra_for_eng' })
    expect(db.invite_codes).toHaveLength(1)
    expect(db.invite_codes[0]).toMatchObject({ code_type: 'student', grants_class_id: result.classId })
  })

  it('is idempotent — re-calling for the same group returns the existing leaf, no duplicate rows', async () => {
    const db: any = {
      groups: [{ id: 'root', name: 'Riverside Trust', parent_id: null }],
      demo_orgs: [{ id: 'org-1', group_id: 'root', course_code: 'fra_for_eng' }],
      schools: [],
      classes: [],
      invite_codes: [],
      learners: [],
      course_enrollments: [],
    }
    const supabase = makeSupabase(db)
    const first = await ensureDemoLeafClass(supabase, 'root', 'admin-1')
    const second = await ensureDemoLeafClass(supabase, 'root', 'admin-1')

    if ('error' in first || 'error' in second) throw new Error('unexpected error result')
    expect(second.created).toBe(false)
    expect(second.classId).toBe(first.classId)
    expect(second.studentJoinCode).toBe(first.studentJoinCode)
    expect(db.schools).toHaveLength(1)
    expect(db.classes).toHaveLength(1)
  })

  it('errors when no ancestor demo_orgs row can resolve a course', async () => {
    const db: any = {
      groups: [{ id: 'orphan', name: 'No Org', parent_id: null }],
      demo_orgs: [],
      schools: [],
      classes: [],
      invite_codes: [],
      learners: [],
      course_enrollments: [],
    }
    const result = await ensureDemoLeafClass(makeSupabase(db), 'orphan', 'admin-1')
    expect('error' in result).toBe(true)
  })
})
