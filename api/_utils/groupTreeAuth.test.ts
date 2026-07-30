/**
 * resolveGroupTreeCaller — the shared node-surface authz (THE-MODEL §6).
 * The 2026-07-30 extension: a school_admin resolves to their own school's
 * NODE as scope root (the leader shape one level down), so node home /
 * rail / invites reach exactly their school subtree. Teachers must NOT
 * resolve (they carry a SCHOOL: tag too — the gate is the educational_role).
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
let schoolTagRow: any
let adminSchoolRow: any
let schoolRow: any

function makeSupabase() {
  const from = (table: string) => {
    const eqFilters: [string, unknown][] = []
    const builder: any = {
      select: () => builder,
      eq: (col: string, val: unknown) => { eqFilters.push([col, val]); return builder },
      is: () => builder,
      order: () => builder,
      limit: () => builder,
      maybeSingle: () => {
        if (table === 'govt_admins') return Promise.resolve({ data: govtAdminRow, error: null })
        if (table === 'learners') return Promise.resolve({ data: learnerRow, error: null })
        if (table === 'user_tags') return Promise.resolve({ data: schoolTagRow, error: null })
        if (table === 'schools') {
          if (eqFilters.some(([c]) => c === 'admin_user_id')) return Promise.resolve({ data: adminSchoolRow, error: null })
          return Promise.resolve({ data: schoolRow, error: null })
        }
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
  schoolTagRow = null
  adminSchoolRow = null
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
    schoolTagRow = { tag_value: 'SCHOOL:sch-1' }
    schoolRow = { id: 'sch-1', school_name: 'Seaside', group_id: null, node_group_id: 'node-sch-1', is_demo: false, is_test: false }
    const res = makeRes()
    const caller = await resolveGroupTreeCaller(req, res, makeSupabase())
    expect(caller).toEqual({ userId: 'user-1', isAdmin: false, ownGroupId: 'node-sch-1' })
  })

  it('a TEACHER does not resolve, even with a SCHOOL: tag — 403', async () => {
    learnerRow = { educational_role: 'teacher' }
    schoolTagRow = { tag_value: 'SCHOOL:sch-1' }
    schoolRow = { id: 'sch-1', school_name: 'Seaside', group_id: null, node_group_id: 'node-sch-1' }
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
