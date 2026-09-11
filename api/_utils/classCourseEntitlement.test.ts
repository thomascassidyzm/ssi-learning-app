/**
 * Tests for classCourseEntitlement.ts — the gate that stops a class being
 * opened on a premium course the node has not paid for.
 *
 * The case that produced it (2026-09-10): a leader creates a school through
 * api/govt/create-school.ts with no course named, so it is stamped the
 * 365-day heritage platform trial and its trial_course_code stays null. A
 * class on spa_for_eng would then hand every student in it a Big-10 course
 * free for a year, because classCoverage.ts grants the class's course_code
 * unconditionally while the school's clock runs.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { checkClassCourseEntitlement } from './classCourseEntitlement'

const FUTURE = new Date(Date.now() + 90 * 86400_000).toISOString()
const PAST = new Date(Date.now() - 1 * 86400_000).toISOString()

let DB: {
  schools: any[]
  groups: any[]
  entitlement_grants: any[]
}
let errorFor: Record<string, { code?: string; message?: string }> = {}

function makeChainable(table: string) {
  const filters: Array<[string, unknown]> = []
  const matched = () =>
    ((DB as any)[table] as any[]).filter((r) => filters.every(([c, v]) => r[c] === v))
  const err = () => errorFor[table] ?? null
  const builder: any = {
    select: () => builder,
    eq(col: string, val: unknown) {
      filters.push([col, val])
      return builder
    },
    maybeSingle: async () => (err() ? { data: null, error: err() } : { data: matched()[0] ?? null, error: null }),
    // `await svc.from(t).select(...).eq(...)` — the list form.
    then: (resolve: any) => resolve(err() ? { data: null, error: err() } : { data: matched(), error: null }),
  }
  return builder
}

const svc: any = { from: (table: string) => makeChainable(table) }

beforeEach(() => {
  errorFor = {}
  DB = {
    schools: [
      { id: 'paid', platform_status: 'active', trial_course_code: null },
      { id: 'trial-welsh', platform_status: 'trial', trial_course_code: 'cym_s_for_eng' },
      { id: 'trial-spanish', platform_status: 'trial', trial_course_code: 'spa_for_eng' },
      // The leader-created school: 365-day heritage trial, no course named.
      { id: 'no-course', platform_status: 'trial', trial_course_code: null },
      { id: 'granted', platform_status: 'trial', trial_course_code: null },
    ],
    groups: [
      { id: 'live-org', parent_id: null, platform_status: 'trial', platform_expires_at: FUTURE, created_at: PAST },
      { id: 'sub-of-live', parent_id: 'live-org', platform_status: null },
      { id: 'lapsed-org', parent_id: null, platform_status: 'trial', platform_expires_at: PAST, created_at: PAST },
      { id: 'sub-of-lapsed', parent_id: 'lapsed-org', platform_status: null },
      { id: 'orphan', parent_id: null, platform_status: null },
      { id: 'granted-group', parent_id: null, platform_status: null },
    ],
    entitlement_grants: [
      { school_id: 'granted', group_id: null, granted_courses: ['spa_for_eng'], expires_at: FUTURE },
      { school_id: null, group_id: 'granted-group', granted_courses: ['spa_for_eng'], expires_at: null },
    ],
  }
})

describe('checkClassCourseEntitlement — schools', () => {
  it('REFUSES a premium course on a school with no course of its own — the 365-day free-premium hole', async () => {
    const v = await checkClassCourseEntitlement(svc, { schoolId: 'no-course', groupId: 'g', courseCode: 'spa_for_eng' })
    expect(v.allowed).toBe(false)
    expect(v.status).toBe(403)
    expect(v.requiresCheckout).toBe(true)
  })

  it('REFUSES a premium course that is not the one the school is trialling', async () => {
    const v = await checkClassCourseEntitlement(svc, { schoolId: 'trial-welsh', groupId: 'g', courseCode: 'spa_for_eng' })
    expect(v.allowed).toBe(false)
  })

  it('allows a HERITAGE course on any school — nothing that was free becomes refused', async () => {
    for (const schoolId of ['no-course', 'trial-welsh', 'trial-spanish']) {
      const v = await checkClassCourseEntitlement(svc, { schoolId, groupId: 'g', courseCode: 'cym_s_for_eng' })
      expect(v.allowed).toBe(true)
    }
  })

  it('allows any course on a PAID school — a subscribed school is not language-locked', async () => {
    const v = await checkClassCourseEntitlement(svc, { schoolId: 'paid', groupId: 'g', courseCode: 'spa_for_eng' })
    expect(v.allowed).toBe(true)
  })

  it('allows the premium course the school is genuinely trialling', async () => {
    const v = await checkClassCourseEntitlement(svc, { schoolId: 'trial-spanish', groupId: 'g', courseCode: 'spa_for_eng' })
    expect(v.allowed).toBe(true)
  })

  it('allows a premium course a live entitlement_grants row names', async () => {
    const v = await checkClassCourseEntitlement(svc, { schoolId: 'granted', groupId: 'g', courseCode: 'spa_for_eng' })
    expect(v.allowed).toBe(true)
  })

  it('an EXPIRED grant confers nothing', async () => {
    DB.entitlement_grants[0].expires_at = PAST
    const v = await checkClassCourseEntitlement(svc, { schoolId: 'granted', groupId: 'g', courseCode: 'spa_for_eng' })
    expect(v.allowed).toBe(false)
  })

  it('a school node does NOT borrow its ancestor org cover — that is the same hole one level up', async () => {
    const v = await checkClassCourseEntitlement(svc, { schoolId: 'no-course', groupId: 'sub-of-live', courseCode: 'spa_for_eng' })
    expect(v.allowed).toBe(false)
  })

  it('fails CLOSED and unverifiable on a read error, not silently open', async () => {
    errorFor.schools = { code: 'XX000', message: 'connection reset' }
    const v = await checkClassCourseEntitlement(svc, { schoolId: 'paid', groupId: 'g', courseCode: 'spa_for_eng' })
    expect(v.allowed).toBe(false)
    expect(v.status).toBe(500)
  })

  it('fails OPEN when the platform columns are absent — an un-migrated DB keeps working', async () => {
    errorFor.schools = { code: '42703', message: 'column "platform_status" does not exist' }
    const v = await checkClassCourseEntitlement(svc, { schoolId: 'paid', groupId: 'g', courseCode: 'spa_for_eng' })
    expect(v.allowed).toBe(true)
  })
})

describe('checkClassCourseEntitlement — group / org nodes', () => {
  it('allows any course under a LIVE org — the org trial is all-languages by ruling', async () => {
    const v = await checkClassCourseEntitlement(svc, { schoolId: null, groupId: 'sub-of-live', courseCode: 'spa_for_eng' })
    expect(v.allowed).toBe(true)
  })

  it('REFUSES a premium course under a lapsed org', async () => {
    const v = await checkClassCourseEntitlement(svc, { schoolId: null, groupId: 'sub-of-lapsed', courseCode: 'spa_for_eng' })
    expect(v.allowed).toBe(false)
  })

  it('REFUSES a premium course on a group no billed node covers', async () => {
    const v = await checkClassCourseEntitlement(svc, { schoolId: null, groupId: 'orphan', courseCode: 'spa_for_eng' })
    expect(v.allowed).toBe(false)
  })

  it('allows a premium course a group-level grant names', async () => {
    const v = await checkClassCourseEntitlement(svc, { schoolId: null, groupId: 'granted-group', courseCode: 'spa_for_eng' })
    expect(v.allowed).toBe(true)
  })

  it('allows heritage on any group, covered or not', async () => {
    const v = await checkClassCourseEntitlement(svc, { schoolId: null, groupId: 'orphan', courseCode: 'cym_s_for_eng' })
    expect(v.allowed).toBe(true)
  })

  it('refuses when there is neither a school nor a group to answer for', async () => {
    const v = await checkClassCourseEntitlement(svc, { schoolId: null, groupId: null, courseCode: 'spa_for_eng' })
    expect(v.allowed).toBe(false)
  })
})
