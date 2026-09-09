/**
 * Tests for resolveSchoolStaffCourseCoverage — the school-MEMBERSHIP layer
 * (founder ruling 2026-09-09: "all admins and all teachers should have their
 * OWN learner account with … the SAME full privileges on a course by course
 * basis to match the school").
 *
 * The three things that must never drift: a school with NO live cover confers
 * nothing at all, a covered school confers its OWN courses and no more, and
 * the window is the SCHOOL'S — 365 days or 30, whichever its own trial was
 * stamped with — never one computed for the person.
 */
import { describe, it, expect } from 'vitest'
import { resolveSchoolStaffCourseCoverage } from './schoolCoverage'

const FUTURE = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
const PAST = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

interface DB {
  user_tags: Array<{ user_id: string; tag_type: string; role_in_context: string; removed_at: string | null; tag_value: string }>
  schools: Array<{ id: string; admin_user_id?: string | null; platform_status: string | null; platform_expires_at: string | null; trial_course_code: string | null }>
  classes: Array<{ school_id: string | null; course_code: string | null }>
  courses: Array<{ course_code: string; new_app_status: string }>
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

const CATALOGUE: DB['courses'] = [
  { course_code: 'cym_s_for_eng', new_app_status: 'live' },
  { course_code: 'spa_for_eng', new_app_status: 'live' },
  { course_code: 'jpn_for_eng', new_app_status: 'beta' },
  { course_code: 'zzz_retired', new_app_status: 'archived' },
]

function staffTag(schoolId: string, role: 'teacher' | 'admin', userId = 'u-1'): DB['user_tags'][number] {
  return { user_id: userId, tag_type: 'school', role_in_context: role, removed_at: null, tag_value: `SCHOOL:${schoolId}` }
}

function db(over: Partial<DB> = {}): DB {
  return { user_tags: [], schools: [], classes: [], courses: CATALOGUE, ...over }
}

describe('resolveSchoolStaffCourseCoverage', () => {
  it('gives a TEACHER with no class of her own the school trial course', async () => {
    const { courses } = await resolveSchoolStaffCourseCoverage(makeSupabase(db({
      user_tags: [staffTag('s1', 'teacher')],
      schools: [{ id: 's1', platform_status: 'trial', platform_expires_at: FUTURE, trial_course_code: 'cym_s_for_eng' }],
    })), 'u-1')
    expect(courses).toEqual(['cym_s_for_eng'])
  })

  it('gives a school ADMIN with no class the school trial course', async () => {
    const { courses } = await resolveSchoolStaffCourseCoverage(makeSupabase(db({
      user_tags: [staffTag('s1', 'admin')],
      schools: [{ id: 's1', platform_status: 'trial', platform_expires_at: FUTURE, trial_course_code: 'jpn_for_eng' }],
    })), 'u-1')
    expect(courses).toEqual(['jpn_for_eng'])
  })

  it('recognises the FOUNDING admin through schools.admin_user_id, with no tag at all', async () => {
    const { courses } = await resolveSchoolStaffCourseCoverage(makeSupabase(db({
      user_tags: [],
      schools: [{ id: 's1', admin_user_id: 'u-1', platform_status: 'trial', platform_expires_at: FUTURE, trial_course_code: 'cym_s_for_eng' }],
    })), 'u-1')
    expect(courses).toEqual(['cym_s_for_eng'])
  })

  // THE NO-COVER CASE. A school without cover confers nothing — this is what
  // keeps the 32 staff accounts at uncovered schools exactly where they were.
  it('gives a teacher at a school with NO live cover nothing', async () => {
    for (const school of [
      { platform_status: 'trial', platform_expires_at: PAST },
      { platform_status: 'expired', platform_expires_at: null },
      { platform_status: 'past_due', platform_expires_at: null },
      { platform_status: 'cancelled', platform_expires_at: null },
    ]) {
      const { courses } = await resolveSchoolStaffCourseCoverage(makeSupabase(db({
        user_tags: [staffTag('s1', 'teacher')],
        schools: [{ id: 's1', ...school, trial_course_code: 'cym_s_for_eng' }],
      })), 'u-1')
      expect(courses, `status=${school.platform_status}`).toEqual([])
    }
  })

  it('gives an account that is staff of no school nothing', async () => {
    const { courses } = await resolveSchoolStaffCourseCoverage(makeSupabase(db({
      schools: [{ id: 's1', platform_status: 'trial', platform_expires_at: FUTURE, trial_course_code: 'cym_s_for_eng' }],
    })), 'u-1')
    expect(courses).toEqual([])
  })

  it('gives a STUDENT-tagged member of a covered school nothing — this layer is staff only', async () => {
    const { courses } = await resolveSchoolStaffCourseCoverage(makeSupabase(db({
      user_tags: [{ user_id: 'u-1', tag_type: 'school', role_in_context: 'student', removed_at: null, tag_value: 'SCHOOL:s1' }],
      schools: [{ id: 's1', platform_status: 'trial', platform_expires_at: FUTURE, trial_course_code: 'cym_s_for_eng' }],
    })), 'u-1')
    expect(courses).toEqual([])
  })

  it('gives a REMOVED member of a covered school nothing', async () => {
    const { courses } = await resolveSchoolStaffCourseCoverage(makeSupabase(db({
      user_tags: [{ ...staffTag('s1', 'teacher'), removed_at: PAST }],
      schools: [{ id: 's1', platform_status: 'trial', platform_expires_at: FUTURE, trial_course_code: 'cym_s_for_eng' }],
    })), 'u-1')
    expect(courses).toEqual([])
  })

  // COURSE FOR COURSE. One covered course is one course, not the catalogue.
  it('a covered school with ONE course does not grant a second', async () => {
    const { courses } = await resolveSchoolStaffCourseCoverage(makeSupabase(db({
      user_tags: [staffTag('s1', 'teacher')],
      schools: [{ id: 's1', platform_status: 'trial', platform_expires_at: FUTURE, trial_course_code: 'cym_s_for_eng' }],
      classes: [{ school_id: 's1', course_code: 'spa_for_eng' }],
    })), 'u-1')
    expect(courses).toEqual(['cym_s_for_eng'])
  })

  it('falls back to the school’s own CLASS courses when no trial course is recorded — never the catalogue', async () => {
    const { courses } = await resolveSchoolStaffCourseCoverage(makeSupabase(db({
      user_tags: [staffTag('s1', 'admin')],
      schools: [{ id: 's1', platform_status: 'trial', platform_expires_at: FUTURE, trial_course_code: null }],
      classes: [
        { school_id: 's1', course_code: 'spa_for_eng' },
        { school_id: 's1', course_code: 'jpn_for_eng' },
        { school_id: 's2', course_code: 'cym_s_for_eng' },
      ],
    })), 'u-1')
    expect(courses.sort()).toEqual(['jpn_for_eng', 'spa_for_eng'])
  })

  it('grants nothing for a covered school with no trial course AND no classes', async () => {
    const { courses } = await resolveSchoolStaffCourseCoverage(makeSupabase(db({
      user_tags: [staffTag('s1', 'teacher')],
      schools: [{ id: 's1', platform_status: 'trial', platform_expires_at: FUTURE, trial_course_code: null }],
    })), 'u-1')
    expect(courses).toEqual([])
  })

  it('gives a PAID school’s staff the whole live catalogue, archived courses excluded', async () => {
    const { courses } = await resolveSchoolStaffCourseCoverage(makeSupabase(db({
      user_tags: [staffTag('s1', 'teacher')],
      schools: [{ id: 's1', platform_status: 'active', platform_expires_at: null, trial_course_code: 'cym_s_for_eng' }],
    })), 'u-1')
    expect(courses.sort()).toEqual(['cym_s_for_eng', 'jpn_for_eng', 'spa_for_eng'])
  })

  it('unions the cover of every school a person is staff of, and skips the dead one', async () => {
    const { courses } = await resolveSchoolStaffCourseCoverage(makeSupabase(db({
      user_tags: [staffTag('s1', 'teacher'), staffTag('s2', 'admin'), staffTag('s3', 'teacher')],
      schools: [
        { id: 's1', platform_status: 'trial', platform_expires_at: FUTURE, trial_course_code: 'cym_s_for_eng' },
        { id: 's2', platform_status: 'trial', platform_expires_at: FUTURE, trial_course_code: 'spa_for_eng' },
        { id: 's3', platform_status: 'expired', platform_expires_at: null, trial_course_code: 'jpn_for_eng' },
      ],
    })), 'u-1')
    expect(courses.sort()).toEqual(['cym_s_for_eng', 'spa_for_eng'])
  })

  // THE WINDOW (founder ruling 2026-09-09): "This should match the trial for
  // the school. 365 days OR 30 days depending on which language they are
  // trialling." Nothing here computes a window; it reports the school's own.
  describe('the window is the school’s own', () => {
    const YEAR_OUT = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()
    const MONTH_OUT = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()

    it('hands back the 365-day school’s own date on a heritage trial', async () => {
      const cover = await resolveSchoolStaffCourseCoverage(makeSupabase(db({
        user_tags: [staffTag('s1', 'teacher')],
        schools: [{ id: 's1', platform_status: 'trial', platform_expires_at: YEAR_OUT, trial_course_code: 'cym_s_for_eng' }],
      })), 'u-1')
      expect(cover).toEqual({ courses: ['cym_s_for_eng'], expiresAt: YEAR_OUT })
    })

    it('hands back the 30-day school’s own date on a premium trial', async () => {
      const cover = await resolveSchoolStaffCourseCoverage(makeSupabase(db({
        user_tags: [staffTag('s1', 'teacher')],
        schools: [{ id: 's1', platform_status: 'trial', platform_expires_at: MONTH_OUT, trial_course_code: 'spa_for_eng' }],
      })), 'u-1')
      expect(cover).toEqual({ courses: ['spa_for_eng'], expiresAt: MONTH_OUT })
    })

    it('gives a teacher and a student of the same school the SAME date, off the same row', async () => {
      const rows = db({
        user_tags: [staffTag('s1', 'teacher', 'teacher-1'), staffTag('s1', 'admin', 'admin-1')],
        schools: [{ id: 's1', platform_status: 'trial', platform_expires_at: MONTH_OUT, trial_course_code: 'spa_for_eng' }],
      })
      const t = await resolveSchoolStaffCourseCoverage(makeSupabase(rows), 'teacher-1')
      const a = await resolveSchoolStaffCourseCoverage(makeSupabase(rows), 'admin-1')
      expect(t.expiresAt).toBe(MONTH_OUT)
      expect(a.expiresAt).toBe(t.expiresAt)
    })

    it('stops the whole staff on the school’s clock, in the same instant, with no per-person state', async () => {
      const lapsed = db({
        user_tags: [staffTag('s1', 'teacher', 'teacher-1'), staffTag('s1', 'admin', 'admin-1')],
        schools: [{ id: 's1', platform_status: 'trial', platform_expires_at: PAST, trial_course_code: 'spa_for_eng' }],
      })
      for (const who of ['teacher-1', 'admin-1']) {
        expect(await resolveSchoolStaffCourseCoverage(makeSupabase(lapsed), who), who)
          .toEqual({ courses: [], expiresAt: null })
      }
    })

    it('reports no window when the covering school records none — the fail-open trial default', async () => {
      const cover = await resolveSchoolStaffCourseCoverage(makeSupabase(db({
        user_tags: [staffTag('s1', 'admin')],
        schools: [{ id: 's1', platform_status: 'trial', platform_expires_at: null, trial_course_code: 'jpn_for_eng' }],
      })), 'u-1')
      expect(cover).toEqual({ courses: ['jpn_for_eng'], expiresAt: null })
    })

    it('reports the EARLIEST boundary when two covered schools disagree', async () => {
      const cover = await resolveSchoolStaffCourseCoverage(makeSupabase(db({
        user_tags: [staffTag('s1', 'teacher'), staffTag('s2', 'admin')],
        schools: [
          { id: 's1', platform_status: 'trial', platform_expires_at: YEAR_OUT, trial_course_code: 'cym_s_for_eng' },
          { id: 's2', platform_status: 'trial', platform_expires_at: MONTH_OUT, trial_course_code: 'spa_for_eng' },
        ],
      })), 'u-1')
      expect(cover.courses.sort()).toEqual(['cym_s_for_eng', 'spa_for_eng'])
      expect(cover.expiresAt).toBe(MONTH_OUT)
    })

    it('ignores the window of a school that contributes no course at all', async () => {
      const cover = await resolveSchoolStaffCourseCoverage(makeSupabase(db({
        user_tags: [staffTag('s1', 'teacher'), staffTag('s2', 'admin')],
        schools: [
          { id: 's1', platform_status: 'trial', platform_expires_at: YEAR_OUT, trial_course_code: 'cym_s_for_eng' },
          // covered, but no recorded course and no classes → contributes nothing
          { id: 's2', platform_status: 'trial', platform_expires_at: MONTH_OUT, trial_course_code: null },
        ],
      })), 'u-1')
      expect(cover).toEqual({ courses: ['cym_s_for_eng'], expiresAt: YEAR_OUT })
    })
  })
})
