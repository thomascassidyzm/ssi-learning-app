/**
 * Tests for the server-side "school-goes-blind-at-expiry" coverage gate
 * (docs/schools/group-commercial-model.md, "Server-side enforcement of (4)").
 */
import { describe, it, expect } from 'vitest'
import { filterActiveScope, isEntityCoverageExpired } from './schoolCoverageGate'

const FUTURE = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
const PAST = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

interface DB {
  classes: Array<{ id: string; school_id: string | null }>
  schools: Array<{ id: string; platform_status: string | null; platform_expires_at: string | null }>
}

function makeChainable(table: string, db: DB) {
  let rows: any[] = [...((db as any)[table] ?? [])]
  const builder: any = {
    select: () => builder,
    eq: (col: string, val: unknown) => { rows = rows.filter((r) => r[col] === val); return builder },
    in: (col: string, vals: unknown[]) => { rows = rows.filter((r) => vals.includes(r[col])); return builder },
    then: (resolve: any) => Promise.resolve({ data: rows, error: null }).then(resolve),
  }
  return builder
}

function makeSupabase(db: DB) {
  return { from: (table: string) => makeChainable(table, db) } as any
}

describe('filterActiveScope', () => {
  it('passes an empty scope through untouched', async () => {
    const svc = makeSupabase({ classes: [], schools: [] })
    const result = await filterActiveScope(svc, { role: 'teacher', schoolIds: [], classIds: [] })
    expect(result).toEqual({ classIds: [], blocked: false })
  })

  it('never gates a govt_admin scope — group/region rollups stay intact', async () => {
    const db: DB = {
      classes: [{ id: 'c1', school_id: 's1' }],
      schools: [{ id: 's1', platform_status: 'expired', platform_expires_at: null }],
    }
    const svc = makeSupabase(db)
    const result = await filterActiveScope(svc, { role: 'govt_admin', schoolIds: ['s1'], classIds: ['c1'] })
    expect(result).toEqual({ classIds: ['c1'], blocked: false })
  })

  it('school_admin: passes through when the school is on a live trial', async () => {
    const db: DB = {
      classes: [{ id: 'c1', school_id: 's1' }],
      schools: [{ id: 's1', platform_status: 'trial', platform_expires_at: FUTURE }],
    }
    const svc = makeSupabase(db)
    const result = await filterActiveScope(svc, { role: 'school_admin', schoolIds: ['s1'], classIds: ['c1'] })
    expect(result).toEqual({ classIds: ['c1'], blocked: false })
  })

  it('school_admin: blocks (empty + blocked) once the school trial has expired', async () => {
    const db: DB = {
      classes: [{ id: 'c1', school_id: 's1' }, { id: 'c2', school_id: 's1' }],
      schools: [{ id: 's1', platform_status: 'trial', platform_expires_at: PAST }],
    }
    const svc = makeSupabase(db)
    const result = await filterActiveScope(svc, { role: 'school_admin', schoolIds: ['s1'], classIds: ['c1', 'c2'] })
    expect(result).toEqual({ classIds: [], blocked: true })
  })

  it('teacher spanning two schools loses only the expired school\'s classes, not their whole view', async () => {
    const db: DB = {
      classes: [{ id: 'c1', school_id: 's1' }, { id: 'c2', school_id: 's2' }],
      schools: [
        { id: 's1', platform_status: 'active', platform_expires_at: null },
        { id: 's2', platform_status: 'expired', platform_expires_at: null },
      ],
    }
    const svc = makeSupabase(db)
    const result = await filterActiveScope(svc, { role: 'teacher', schoolIds: [], classIds: ['c1', 'c2'] })
    expect(result).toEqual({ classIds: ['c1'], blocked: false })
  })

  it('fails open for a school row that cannot be found', async () => {
    const db: DB = { classes: [{ id: 'c1', school_id: 's1' }], schools: [] }
    const svc = makeSupabase(db)
    const result = await filterActiveScope(svc, { role: 'school_admin', schoolIds: ['s1'], classIds: ['c1'] })
    expect(result).toEqual({ classIds: ['c1'], blocked: false })
  })
})

describe('isEntityCoverageExpired', () => {
  it('is false for a null ownSchoolId (group-level entities are exempt)', async () => {
    const svc = makeSupabase({ classes: [], schools: [] })
    expect(await isEntityCoverageExpired(svc, null)).toBe(false)
  })

  it('is false when the school is on a live trial', async () => {
    const db: DB = { classes: [], schools: [{ id: 's1', platform_status: 'trial', platform_expires_at: FUTURE }] }
    expect(await isEntityCoverageExpired(makeSupabase(db), 's1')).toBe(false)
  })

  it('is true once the school trial has expired', async () => {
    const db: DB = { classes: [], schools: [{ id: 's1', platform_status: 'trial', platform_expires_at: PAST }] }
    expect(await isEntityCoverageExpired(makeSupabase(db), 's1')).toBe(true)
  })

  it('is true for an explicit expired/past_due/cancelled status', async () => {
    for (const status of ['expired', 'past_due', 'cancelled']) {
      const db: DB = { classes: [], schools: [{ id: 's1', platform_status: status, platform_expires_at: null }] }
      expect(await isEntityCoverageExpired(makeSupabase(db), 's1'), `status=${status}`).toBe(true)
    }
  })

  it('fails open for an unresolvable school row', async () => {
    const db: DB = { classes: [], schools: [] }
    expect(await isEntityCoverageExpired(makeSupabase(db), 'missing')).toBe(false)
  })
})
