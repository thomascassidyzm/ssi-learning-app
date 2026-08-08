/**
 * Regression: a school admin who holds the admin TAG rather than the founding
 * `schools.admin_user_id` pointer may manage who teaches her school's classes.
 *
 * The bug (Tom, staging, 2026-08-08, as "Harbour Leader" at "Harbour View
 * School, Visakhapatnam"): the assign-to-classes modal rendered, loaded, and
 * then failed all three saves with "Only the class teacher or a leader above
 * the class can manage its teachers". Live DB at the time:
 *
 *   schools.admin_user_id = bd7c1b4e… (Suresh Rao, the FOUNDING admin)
 *   Harbour Leader        = a3ae3be4… — holds user_tags SCHOOL:8e4f7fdc…,
 *                           role_in_context 'admin', removed_at NULL
 *   govt_admins rows for her: NONE
 *
 * So isLeaderAboveClass compared her against the pointer, missed, fell through
 * to a govt_admins lookup with no row, and returned false. The hierarchy was
 * fine — the school node had a proper parented path and the classes carried
 * its group_id. The CHECK was wrong, not the data.
 *
 * This is the same gap migration 20260807c closed inside the database for
 * is_school_admin_of() on 2026-08-07. The DB learned the tag spelling; the
 * API's copy of the same question did not — so reads worked and writes did
 * not, which is the worst split available: the UI offers a verb the server
 * then refuses.
 */
import { describe, it, expect } from 'vitest'
import {
  canManageClassTeachers,
  canTeachClass,
  isSchoolAdminOfClass,
  type ClassAuthRow,
} from './classTeacherAuth'

interface World {
  /** schools.admin_user_id, by school id */
  pointerAdmin?: Record<string, string | null>
  /** active SCHOOL: admin tags — user ids, by school id */
  tagAdmins?: Record<string, string[]>
  /** REVOKED SCHOOL: admin tags (removed_at set) — user ids, by school id */
  revokedTagAdmins?: Record<string, string[]>
  /** active CLASS: teacher tags — user ids, by class id */
  classTeachers?: Record<string, string[]>
  govtAdmins?: Record<string, string>
  platformAdmins?: string[]
}

/**
 * A stand-in for the service client covering only the tables these predicates
 * touch. Deliberately literal about `removed_at`: a revoked tag must be
 * invisible, and a mock that ignored the filter would let a revoked admin pass.
 */
function fakeSvc(w: World) {
  return {
    from(table: string) {
      const f: Record<string, unknown> = {}
      const q: any = {
        select: () => q,
        eq: (col: string, val: unknown) => { f[col] = val; return q },
        in: () => q,
        is: (col: string, val: unknown) => { f[col] = val; return q },
        maybeSingle: () => Promise.resolve({ data: resolve(table, f), error: null }),
      }
      return q
    },
  } as any

  function resolve(table: string, f: Record<string, any>) {
    if (table === 'schools') {
      const id = f.id as string
      return {
        admin_user_id: w.pointerAdmin?.[id] ?? null,
        group_id: null,
        node_group_id: null,
      }
    }
    if (table === 'learners') {
      return w.platformAdmins?.includes(f.user_id)
        ? { platform_role: 'ssi_admin', educational_role: null }
        : { platform_role: null, educational_role: 'school_admin' }
    }
    if (table === 'govt_admins') {
      const g = w.govtAdmins?.[f.user_id as string]
      return g ? { group_id: g } : null
    }
    if (table === 'user_tags') {
      const value = String(f.tag_value ?? '')
      const user = f.user_id as string
      // Only ACTIVE rows are visible: the caller filters removed_at IS NULL.
      const wantsActive = f.removed_at === null
      if (f.tag_type === 'school' && f.role_in_context === 'admin') {
        const schoolId = value.replace('SCHOOL:', '')
        const active = w.tagAdmins?.[schoolId] ?? []
        const revoked = w.revokedTagAdmins?.[schoolId] ?? []
        if (active.includes(user)) return { id: 'tag-active' }
        if (!wantsActive && revoked.includes(user)) return { id: 'tag-revoked' }
        return null
      }
      if (f.tag_type === 'class' && f.role_in_context === 'teacher') {
        const classId = value.replace('CLASS:', '')
        return (w.classTeachers?.[classId] ?? []).includes(user) ? { id: 'class-tag' } : null
      }
    }
    return null
  }
}

const HARBOUR: ClassAuthRow = {
  id: 'class-6b',
  teacher_user_id: 'some-other-teacher',
  school_id: 'harbour',
  group_id: null,
}

describe('classTeacherAuth — the school admin, under either spelling', () => {
  it('lets the FOUNDING pointer admin manage the class (unchanged)', async () => {
    const svc = fakeSvc({ pointerAdmin: { harbour: 'suresh' } })
    expect(await canManageClassTeachers(svc, 'suresh', HARBOUR)).toBe(true)
  })

  // The founder's live repro, as a test.
  it('lets a TAG admin manage the class even though she is not the pointer', async () => {
    const svc = fakeSvc({
      pointerAdmin: { harbour: 'suresh' },
      tagAdmins: { harbour: ['harbour-leader'] },
    })
    expect(await canManageClassTeachers(svc, 'harbour-leader', HARBOUR)).toBe(true)
  })

  it('does not need a govt_admins row to do it', async () => {
    // She has none — the old code fell through to this lookup and returned
    // false, which is precisely why the save failed.
    const svc = fakeSvc({
      pointerAdmin: { harbour: 'suresh' },
      tagAdmins: { harbour: ['harbour-leader'] },
      govtAdmins: {},
    })
    expect(await canManageClassTeachers(svc, 'harbour-leader', HARBOUR)).toBe(true)
  })

  it('still refuses a stranger with neither pointer, tag, nor class', async () => {
    const svc = fakeSvc({
      pointerAdmin: { harbour: 'suresh' },
      tagAdmins: { harbour: ['harbour-leader'] },
    })
    expect(await canManageClassTeachers(svc, 'nobody', HARBOUR)).toBe(false)
  })

  it("refuses another school's tag admin — sideways is not above", async () => {
    const svc = fakeSvc({
      pointerAdmin: { harbour: 'suresh', rival: null },
      tagAdmins: { rival: ['rival-leader'] },
    })
    expect(await canManageClassTeachers(svc, 'rival-leader', HARBOUR)).toBe(false)
  })

  it('refuses an admin whose tag has been REVOKED', async () => {
    const svc = fakeSvc({
      pointerAdmin: { harbour: 'suresh' },
      revokedTagAdmins: { harbour: ['ex-leader'] },
    })
    expect(await canManageClassTeachers(svc, 'ex-leader', HARBOUR)).toBe(false)
  })

  it('keeps the ruling narrow: a plain co-teacher still cannot manage', async () => {
    // Founder ruling 2026-08-06 — a co-teacher teaches but does not recruit.
    const svc = fakeSvc({
      pointerAdmin: { harbour: 'suresh' },
      classTeachers: { 'class-6b': ['co-teacher'] },
    })
    expect(await canManageClassTeachers(svc, 'co-teacher', HARBOUR)).toBe(false)
  })

  it('gives the tag admin the day-to-day TEACHING verbs too', async () => {
    // canTeachClass went through the same pointer-only check, so join codes
    // and learner entities were refused for her own school's classes as well.
    const svc = fakeSvc({
      pointerAdmin: { harbour: 'suresh' },
      tagAdmins: { harbour: ['harbour-leader'] },
    })
    expect(await canTeachClass(svc, 'harbour-leader', HARBOUR)).toBe(true)
    expect(await isSchoolAdminOfClass(svc, 'harbour-leader', HARBOUR)).toBe(true)
  })

  it('is false for a class with no school at all', async () => {
    const svc = fakeSvc({ tagAdmins: { harbour: ['harbour-leader'] } })
    expect(
      await isSchoolAdminOfClass(svc, 'harbour-leader', { ...HARBOUR, school_id: null }),
    ).toBe(false)
  })
})
