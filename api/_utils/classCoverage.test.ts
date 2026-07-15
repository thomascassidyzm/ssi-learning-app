/**
 * Tests for resolveClassCourseCoverage — the FINAL student-entitlement
 * derivation (docs/schools/group-commercial-model.md, "Student entitlement —
 * FINAL model"): a class-affiliated student gets their class's course while
 * (and only while) that class's school has live platform coverage.
 */
import { describe, it, expect } from 'vitest'
import { resolveClassCourseCoverage } from './classCoverage'

const FUTURE = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
const PAST = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

interface DB {
  user_tags: Array<{ user_id: string; tag_type: string; role_in_context: string; removed_at: string | null; tag_value: string }>
  classes: Array<{ id: string; school_id: string | null; course_code: string | null }>
  schools: Array<{ id: string; platform_status: string | null; platform_expires_at: string | null }>
}

function makeChainable(table: string, db: DB) {
  let rows: any[] = [...((db as any)[table] ?? [])]
  const builder: any = {
    select: () => builder,
    eq: (col: string, val: unknown) => { rows = rows.filter((r) => r[col] === val); return builder },
    is: (col: string, val: unknown) => {
      rows = rows.filter((r) => (val === null ? r[col] == null : r[col] === val))
      return builder
    },
    in: (col: string, vals: unknown[]) => { rows = rows.filter((r) => vals.includes(r[col])); return builder },
    then: (resolve: any) => Promise.resolve({ data: rows, error: null }).then(resolve),
  }
  return builder
}

function makeSupabase(db: DB) {
  return { from: (table: string) => makeChainable(table, db) } as any
}

function studentTag(classId: string, userId = 'stu-1'): DB['user_tags'][number] {
  return { user_id: userId, tag_type: 'class', role_in_context: 'student', removed_at: null, tag_value: `CLASS:${classId}` }
}

describe('resolveClassCourseCoverage', () => {
  it('grants the class course when the school is on a live (unexpired) trial', async () => {
    const db: DB = {
      user_tags: [studentTag('c1')],
      classes: [{ id: 'c1', school_id: 's1', course_code: 'fra_for_eng' }],
      schools: [{ id: 's1', platform_status: 'trial', platform_expires_at: FUTURE }],
    }
    const courses = await resolveClassCourseCoverage(makeSupabase(db), 'stu-1')
    expect(courses).toEqual(['fra_for_eng'])
  })

  it('grants the class course when the school is on an active paid subscription', async () => {
    const db: DB = {
      user_tags: [studentTag('c1')],
      classes: [{ id: 'c1', school_id: 's1', course_code: 'spa_for_eng' }],
      schools: [{ id: 's1', platform_status: 'active', platform_expires_at: null }],
    }
    const courses = await resolveClassCourseCoverage(makeSupabase(db), 'stu-1')
    expect(courses).toEqual(['spa_for_eng'])
  })

  it('withholds the class course once the trial has expired', async () => {
    const db: DB = {
      user_tags: [studentTag('c1')],
      classes: [{ id: 'c1', school_id: 's1', course_code: 'fra_for_eng' }],
      schools: [{ id: 's1', platform_status: 'trial', platform_expires_at: PAST }],
    }
    const courses = await resolveClassCourseCoverage(makeSupabase(db), 'stu-1')
    expect(courses).toEqual([])
  })

  it('withholds the class course for a cancelled/past_due/expired school', async () => {
    for (const status of ['cancelled', 'past_due', 'expired']) {
      const db: DB = {
        user_tags: [studentTag('c1')],
        classes: [{ id: 'c1', school_id: 's1', course_code: 'fra_for_eng' }],
        schools: [{ id: 's1', platform_status: status, platform_expires_at: null }],
      }
      const courses = await resolveClassCourseCoverage(makeSupabase(db), 'stu-1')
      expect(courses, `status=${status}`).toEqual([])
    }
  })

  it('returns no grants for a student with no class affiliation', async () => {
    const db: DB = {
      user_tags: [],
      classes: [{ id: 'c1', school_id: 's1', course_code: 'fra_for_eng' }],
      schools: [{ id: 's1', platform_status: 'trial', platform_expires_at: FUTURE }],
    }
    const courses = await resolveClassCourseCoverage(makeSupabase(db), 'stu-1')
    expect(courses).toEqual([])
  })

  it('is unaffected by a free-tier class course — still resolves it as a granted course (the free-tier fallback in checkCourseAccess makes the grant redundant, not wrong)', async () => {
    const db: DB = {
      user_tags: [studentTag('c1')],
      classes: [{ id: 'c1', school_id: 's1', course_code: 'gle_for_eng' }],
      schools: [{ id: 's1', platform_status: 'trial', platform_expires_at: FUTURE }],
    }
    const courses = await resolveClassCourseCoverage(makeSupabase(db), 'stu-1')
    expect(courses).toEqual(['gle_for_eng'])
  })

  it('only grants covered classes when the student is in several, mixed coverage', async () => {
    const db: DB = {
      user_tags: [studentTag('c1'), studentTag('c2')],
      classes: [
        { id: 'c1', school_id: 's1', course_code: 'fra_for_eng' },
        { id: 'c2', school_id: 's2', course_code: 'deu_for_eng' },
      ],
      schools: [
        { id: 's1', platform_status: 'trial', platform_expires_at: FUTURE },
        { id: 's2', platform_status: 'trial', platform_expires_at: PAST },
      ],
    }
    const courses = await resolveClassCourseCoverage(makeSupabase(db), 'stu-1')
    expect(courses).toEqual(['fra_for_eng'])
  })

  it('grants nothing when the class points at a school row that cannot be found', async () => {
    const db: DB = {
      user_tags: [studentTag('c1')],
      classes: [{ id: 'c1', school_id: 'missing-school', course_code: 'fra_for_eng' }],
      schools: [],
    }
    const courses = await resolveClassCourseCoverage(makeSupabase(db), 'stu-1')
    expect(courses).toEqual([])
  })

  it('grants nothing for a schoolless (first-class-class) class', async () => {
    const db: DB = {
      user_tags: [studentTag('c1')],
      classes: [{ id: 'c1', school_id: null, course_code: 'fra_for_eng' }],
      schools: [],
    }
    const courses = await resolveClassCourseCoverage(makeSupabase(db), 'stu-1')
    expect(courses).toEqual([])
  })
})
