/**
 * Tests for ensureSchoolTrialCourse (api/_utils/schoolPlatformTrial.ts).
 *
 * The gap it closes (founder report 2026-08-07, Chepstow): an invite-born
 * school redeems with no course chosen, and nothing ever filled in
 * `schools.trial_course_code` afterwards — so the leader's home badge could
 * only ever say a bare "Trial" with no language. The fill happens at the
 * honest moment: the school's first class with a course.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ensureSchoolTrialCourse } from './schoolPlatformTrial'

type SchoolRow = {
  id: string
  platform_status: string | null
  trial_course_code: string | null
}

let SCHOOLS: SchoolRow[]
let readError: { code?: string; message?: string } | null
let writeError: { code?: string; message?: string } | null
let updates: Array<{ patch: Record<string, unknown>; matched: string[] }>

function makeSupabase() {
  return {
    from(table: string) {
      if (table !== 'schools') throw new Error(`unexpected table ${table}`)
      let rows = [...SCHOOLS]
      let mode: 'select' | 'update' = 'select'
      let patch: Record<string, unknown> = {}
      const builder: any = {
        select: () => (mode === 'update' ? Promise.resolve(applyUpdate()) : builder),
        update: (p: Record<string, unknown>) => { mode = 'update'; patch = p; return builder },
        eq: (col: string, val: unknown) => { rows = rows.filter((r) => (r as any)[col] === val); return builder },
        is: (col: string, _val: null) => { rows = rows.filter((r) => (r as any)[col] == null); return builder },
        like: (col: string, pattern: string) => {
          const prefix = pattern.replace(/%$/, '')
          rows = rows.filter((r) => String((r as any)[col] ?? '').startsWith(prefix))
          return builder
        },
        maybeSingle: async () => (readError ? { data: null, error: readError } : { data: rows[0] ?? null, error: null }),
      }
      function applyUpdate() {
        if (writeError) return { data: null, error: writeError }
        const matched = rows.map((r) => r.id)
        for (const r of rows) Object.assign(r, patch)
        updates.push({ patch, matched })
        return { data: rows.map((r) => ({ id: r.id })), error: null }
      }
      return builder
    },
  }
}

beforeEach(() => {
  SCHOOLS = [{ id: 'school-1', platform_status: 'trial', trial_course_code: null }]
  readError = null
  writeError = null
  updates = []
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

describe('ensureSchoolTrialCourse', () => {
  it('records the course on a trial school that has none', async () => {
    const wrote = await ensureSchoolTrialCourse(makeSupabase(), 'school-1', 'cym_s_for_eng')
    expect(wrote).toBe(true)
    expect(SCHOOLS[0].trial_course_code).toBe('cym_s_for_eng')
    expect(updates).toHaveLength(1)
    expect(updates[0].patch).toEqual({ trial_course_code: 'cym_s_for_eng' })
  })

  it('never overwrites a course the school already committed to', async () => {
    SCHOOLS[0].trial_course_code = 'fra_for_eng'
    const wrote = await ensureSchoolTrialCourse(makeSupabase(), 'school-1', 'cym_s_for_eng')
    expect(wrote).toBe(false)
    expect(SCHOOLS[0].trial_course_code).toBe('fra_for_eng')
    expect(updates).toHaveLength(0)
  })

  it('leaves a paying school alone', async () => {
    SCHOOLS[0].platform_status = 'active'
    const wrote = await ensureSchoolTrialCourse(makeSupabase(), 'school-1', 'cym_s_for_eng')
    expect(wrote).toBe(false)
    expect(SCHOOLS[0].trial_course_code).toBeNull()
  })

  it('matches every trial status, not just the bare "trial"', async () => {
    SCHOOLS[0].platform_status = 'trial_expired'
    const wrote = await ensureSchoolTrialCourse(makeSupabase(), 'school-1', 'cym_s_for_eng')
    expect(wrote).toBe(true)
  })

  it('no-ops for a groupless/schoolless class or a class with no course', async () => {
    expect(await ensureSchoolTrialCourse(makeSupabase(), null, 'cym_s_for_eng')).toBe(false)
    expect(await ensureSchoolTrialCourse(makeSupabase(), 'school-1', null)).toBe(false)
    expect(updates).toHaveLength(0)
  })

  it('no-ops when the school row is missing', async () => {
    const wrote = await ensureSchoolTrialCourse(makeSupabase(), 'ghost', 'cym_s_for_eng')
    expect(wrote).toBe(false)
  })

  it('fails open when the platform columns are absent (pre-migration)', async () => {
    readError = { code: '42703', message: 'column schools.trial_course_code does not exist' }
    const wrote = await ensureSchoolTrialCourse(makeSupabase(), 'school-1', 'cym_s_for_eng')
    expect(wrote).toBe(false)
    expect(console.warn).not.toHaveBeenCalled()
  })

  it('fails open, loudly, when the write errors', async () => {
    writeError = { code: '500', message: 'boom' }
    const wrote = await ensureSchoolTrialCourse(makeSupabase(), 'school-1', 'cym_s_for_eng')
    expect(wrote).toBe(false)
    expect(console.warn).toHaveBeenCalled()
  })
})
