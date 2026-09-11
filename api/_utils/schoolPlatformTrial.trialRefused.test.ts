/**
 * A REFUSED trial must not leave the school row saying "trial, no end date".
 *
 * Traced 2026-09-09: provision.ts inserts the school row BEFORE it asks for a
 * platform trial, so a denial (this email already burned its one free school
 * trial) returned 409 and walked away, leaving the row on the bare
 * `platform_status` DEFAULT 'trial' with a null expiry. Under the old
 * fail-open reading that was free dashboard access for as long as the row
 * existed — three production schools were in exactly that state, two of them
 * created within nine days of the measurement.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { provisionSchoolPlatformTrial } from './schoolPlatformTrial'

type SchoolRow = {
  id: string
  platform_status: string | null
  platform_expires_at: string | null
  trial_course_code: string | null
  trial_kind: string | null
}

let SCHOOLS: SchoolRow[]
let BURN_OWNER: string | null

function makeSupabase() {
  return {
    from(table: string) {
      if (table === 'trial_burns') {
        const builder: any = {
          // Always already burned by SOMEBODY ELSE — the denial path.
          insert: async () => ({ error: { code: '23505' } }),
          select: () => builder,
          eq: () => builder,
          maybeSingle: async () => ({ data: { school_id: BURN_OWNER }, error: null }),
        }
        return builder
      }
      if (table !== 'schools') throw new Error(`unexpected table ${table}`)
      let rows = [...SCHOOLS]
      let patch: Record<string, unknown> | null = null
      const builder: any = {
        select: () => builder,
        update: (p: Record<string, unknown>) => { patch = p; return builder },
        eq: (col: string, val: unknown) => {
          rows = rows.filter((r) => (r as any)[col] === val)
          return patch ? apply() : builder
        },
        is: (col: string, _v: null) => {
          rows = rows.filter((r) => (r as any)[col] == null)
          return patch ? apply() : builder
        },
        maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
      }
      // supabase-js resolves the builder itself when awaited; each filter
      // returns a thenable so the final `.is(...)` in the chain applies.
      function apply() {
        const thenable: any = { ...builder, then: undefined }
        Object.assign(thenable, builder)
        thenable.then = (resolve: any) => {
          for (const r of rows) Object.assign(r, patch)
          return Promise.resolve({ data: null, error: null }).then(resolve)
        }
        return thenable
      }
      return builder
    },
  } as any
}

beforeEach(() => {
  SCHOOLS = [{
    id: 'school-new',
    platform_status: 'trial',
    platform_expires_at: null,
    trial_course_code: null,
    trial_kind: null,
  }]
  BURN_OWNER = 'school-other'
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('provisionSchoolPlatformTrial — denied by an already-burned email', () => {
  it('still denies the trial', async () => {
    const r = await provisionSchoolPlatformTrial(makeSupabase(), 'head@example.com', 'school-new', 'cym_n_for_eng', true)
    expect(r.denied).toBe(true)
    expect(r.trial).toBeNull()
  })

  it('leaves the school row with an END DATE, never a bare open-ended trial', async () => {
    await provisionSchoolPlatformTrial(makeSupabase(), 'head@example.com', 'school-new', 'cym_n_for_eng', true)
    const row = SCHOOLS[0]
    expect(row.platform_status).toBe('expired')
    expect(row.platform_expires_at).toBeTruthy()
    // The state that used to mean forever:
    expect(row.platform_status === 'trial' && row.platform_expires_at === null).toBe(false)
  })

  it('never downgrades a school that already holds a real trial window', async () => {
    const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    SCHOOLS = [{
      id: 'school-new',
      platform_status: 'trial',
      platform_expires_at: future,
      trial_course_code: 'cym_n_for_eng',
      trial_kind: 'free_1yr',
    }]
    await provisionSchoolPlatformTrial(makeSupabase(), 'head@example.com', 'school-new', 'cym_n_for_eng', true)
    expect(SCHOOLS[0].platform_status).toBe('trial')
    expect(SCHOOLS[0].platform_expires_at).toBe(future)
  })
})
