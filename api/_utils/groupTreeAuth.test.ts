/**
 * resolveGroupTreeCaller — the shared node-surface authz (THE-MODEL §6).
 * The 2026-07-30 extension: a school_admin resolves to their own school's
 * NODE as scope root (the leader shape one level down), so node home /
 * rail / invites reach exactly their school subtree. Teachers must NOT
 * resolve (they carry a SCHOOL: tag too — the gate is the educational_role).
 *
 * 2026-09-09: WHICH school is now resolved by adminSchoolIdFor — genuine
 * admin authority, both spellings — rather than by the membership resolver,
 * which returns the EARLIEST tag and so handed an admin of B who once taught
 * at A the node of A as their scope root. The fake below therefore serves the
 * two LIST reads that predicate makes, not a single tag row.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

let verifyAdminResult: any
let verifyAuthTokenResult: any
vi.mock('./auth', () => ({
  verifyAdmin: vi.fn(async () => verifyAdminResult),
  verifyAuthToken: vi.fn(async () => verifyAuthTokenResult),
}))

import { resolveGroupTreeCaller } from './groupTreeAuth'

let govtAdminRow: any
let learnerRow: any
/** Active SCHOOL: tags held by user-1, live-shaped (role_in_context matters). */
let schoolTagRows: Array<{ tag_value: string; role_in_context: string }>
/** Schools whose admin_user_id pointer IS user-1. */
let foundedSchoolRows: Array<{ id: string }>
let schoolRow: any

function makeSupabase() {
  const from = (table: string) => {
    const filters: Array<(row: any) => boolean> = []
    const rows = (): any[] => {
      if (table === 'user_tags') return schoolTagRows.filter((r) => filters.every((f) => f(r)))
      if (table === 'schools') return foundedSchoolRows.filter((r) => filters.every((f) => f(r)))
      return []
    }
    const builder: any = {
      select: () => builder,
      eq: (col: string, val: unknown) => {
        // The only filters that can EXCLUDE a fixture row here are the ones
        // schoolMembershipsOf applies to narrow by role; identity filters are
        // already true of every fixture (they all belong to user-1).
        if (col === 'role_in_context') filters.push((r) => r.role_in_context === val)
        return builder
      },
      is: () => builder,
      in: (col: string, vals: unknown[]) => {
        if (col === 'role_in_context') filters.push((r) => vals.includes(r.role_in_context))
        return builder
      },
      order: () => builder,
      limit: () => builder,
      then: (resolve: any) => resolve({ data: rows(), error: null }),
      maybeSingle: () => {
        if (table === 'govt_admins') return Promise.resolve({ data: govtAdminRow, error: null })
        if (table === 'learners') return Promise.resolve({ data: learnerRow, error: null })
        // The single school row read back by id, once authority has resolved.
        if (table === 'schools') return Promise.resolve({ data: schoolRow, error: null })
        return Promise.resolve({ data: null, error: null })
      },
    }
    return builder
  }
  return { from } as any
}

function makeRes() {
  const res: any = {
    statusCode: 0,
    body: null as any,
    status(code: number) { res.statusCode = code; return res },
    json(payload: any) { res.body = payload; return res },
  }
  return res as VercelResponse & { statusCode: number; body: any }
}

const req = {} as VercelRequest

beforeEach(() => {
  verifyAdminResult = { error: 'not admin' }
  verifyAuthTokenResult = { valid: true, userId: 'user-1' }
  govtAdminRow = null
  learnerRow = null
  schoolTagRows = []
  foundedSchoolRows = []
  schoolRow = null
})

describe('resolveGroupTreeCaller', () => {
  it('a govt_admin with a group resolves to that group (unchanged)', async () => {
    govtAdminRow = { group_id: 'grp-1' }
    const res = makeRes()
    const caller = await resolveGroupTreeCaller(req, res, makeSupabase())
    expect(caller).toEqual({ userId: 'user-1', isAdmin: false, ownGroupId: 'grp-1' })
  })

  it('a school_admin resolves to their school\'s NODE as scope root', async () => {
    learnerRow = { educational_role: 'school_admin' }
    schoolTagRows = [{ tag_value: 'SCHOOL:sch-1', role_in_context: 'admin' }]
    schoolRow = { id: 'sch-1', school_name: 'Seaside', group_id: null, node_group_id: 'node-sch-1', is_demo: false, is_test: false }
    const res = makeRes()
    const caller = await resolveGroupTreeCaller(req, res, makeSupabase())
    expect(caller).toEqual({ userId: 'user-1', isAdmin: false, ownGroupId: 'node-sch-1' })
  })

  it('a TEACHER does not resolve, even with a SCHOOL: tag — 403', async () => {
    learnerRow = { educational_role: 'teacher' }
    schoolTagRows = [{ tag_value: 'SCHOOL:sch-1', role_in_context: 'teacher' }]
    schoolRow = { id: 'sch-1', school_name: 'Seaside', group_id: null, node_group_id: 'node-sch-1' }
    const res = makeRes()
    const caller = await resolveGroupTreeCaller(req, res, makeSupabase())
    expect(caller).toBeNull()
    expect(res.statusCode).toBe(403)
  })

  it('an admin of B who once TAUGHT at A resolves to B — not to the earliest tag', async () => {
    learnerRow = { educational_role: 'school_admin' }
    schoolTagRows = [
      { tag_value: 'SCHOOL:sch-A', role_in_context: 'teacher' },
      { tag_value: 'SCHOOL:sch-B', role_in_context: 'admin' },
    ]
    schoolRow = { id: 'sch-B', school_name: 'Bryn', group_id: null, node_group_id: 'node-sch-B', is_demo: false, is_test: false }
    const res = makeRes()
    const caller = await resolveGroupTreeCaller(req, res, makeSupabase())
    expect(caller).toEqual({ userId: 'user-1', isAdmin: false, ownGroupId: 'node-sch-B' })
  })

  it('a school_admin holding only a TEACHER tag resolves nothing — 403', async () => {
    learnerRow = { educational_role: 'school_admin' }
    schoolTagRows = [{ tag_value: 'SCHOOL:sch-1', role_in_context: 'teacher' }]
    const res = makeRes()
    const caller = await resolveGroupTreeCaller(req, res, makeSupabase())
    expect(caller).toBeNull()
    expect(res.statusCode).toBe(403)
  })

  it('a school_admin with no resolvable school gets 403 (legacy rows keep the flat views)', async () => {
    learnerRow = { educational_role: 'school_admin' }
    const res = makeRes()
    const caller = await resolveGroupTreeCaller(req, res, makeSupabase())
    expect(caller).toBeNull()
    expect(res.statusCode).toBe(403)
  })
})
