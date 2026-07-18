/**
 * Tests for POST /api/groups/:id/invites — THE-MODEL.md §6 groundwork:
 * invites mint people (role × group × limits), never structure. The group
 * is fixed by the path, never a client-supplied grants_group_id.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-key'

let verifyAdminResult: any
let verifyAuthTokenResult: any
vi.mock('../../_utils/auth', () => ({
  verifyAdmin: vi.fn(async () => verifyAdminResult),
  verifyAuthToken: vi.fn(async () => verifyAuthTokenResult),
}))

let govtAdminRow: any
// Path-prefix fixture for isStrictDescendantGroup: group-2 is a real
// sub-group of group-1 (path "1.2" starts with "1"); group-3 is unrelated.
let groupPaths: Record<string, string> = { 'group-1': '1', 'group-2': '1.2', 'group-3': '9' }
let existingCodes: Set<string> = new Set()
let insertedRows: any[] = []
let insertError: any = null

function makeChainable(table: string) {
  let eqVal: unknown
  const builder: any = {
    select: () => builder,
    eq: (_col: string, val: unknown) => { eqVal = val; return builder },
    maybeSingle: () => {
      if (table === 'govt_admins') return Promise.resolve({ data: govtAdminRow, error: null })
      if (table === 'groups') {
        const path = groupPaths[eqVal as string]
        return Promise.resolve({ data: path ? { path } : null, error: null })
      }
      if (table === 'invite_codes') {
        return Promise.resolve({ data: existingCodes.has(eqVal as string) ? { id: 'dup' } : null, error: null })
      }
      return Promise.resolve({ data: null, error: null })
    },
    insert: (row: unknown) => {
      insertedRows.push(row)
      return builder
    },
    single: () => {
      if (insertError) return Promise.resolve({ data: null, error: insertError })
      const row = insertedRows[insertedRows.length - 1] as any
      return Promise.resolve({ data: { id: 'invite-1', code: row.code }, error: null })
    },
  }
  return builder
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: (table: string) => makeChainable(table) }),
}))

// Dynamic import, AFTER the process.env writes above — static imports are
// linked (and this module's top-level env reads run) before this test
// file's own top-level statements execute, so a static import would always
// see empty env vars (same pattern as api/admin/invites.test.ts).
let handler: typeof import('./invites').default

function makeReq(body: unknown, groupId = 'group-1'): VercelRequest {
  return { method: 'POST', body, query: { id: groupId }, headers: { authorization: 'Bearer tok' } } as any
}

function makeRes(): VercelResponse & { statusCode?: number; body?: any } {
  const res: any = {}
  res.status = vi.fn((code: number) => { res.statusCode = code; return res })
  res.json = vi.fn((body: any) => { res.body = body; return res })
  return res
}

beforeEach(async () => {
  insertedRows = []
  existingCodes = new Set()
  insertError = null
  govtAdminRow = null
  verifyAdminResult = { error: 'Not admin', status: 403 }
  verifyAuthTokenResult = { valid: true, userId: 'leader-1' }
  handler = (await import('./invites')).default
})

describe('POST /api/groups/:id/invites', () => {
  it('rejects an invalid role', async () => {
    verifyAdminResult = { userId: 'admin-1' }
    const res = makeRes()
    await handler(makeReq({ role: 'principal' }), res)
    expect(res.statusCode).toBe(400)
  })

  it('ssi_admin may mint a leader invite for any group, grants_group_id fixed by the path', async () => {
    verifyAdminResult = { userId: 'admin-1' }
    const res = makeRes()
    await handler(makeReq({ role: 'leader', limits: { max_uses: 5 } }, 'group-3'), res)
    expect(res.statusCode).toBe(201)
    expect(insertedRows[0]).toMatchObject({
      code_type: 'govt_admin',
      grants_group_id: 'group-3',
      max_uses: 5,
      created_by: 'admin-1',
    })
    expect(insertedRows[0].grants_school_id).toBeUndefined()
    expect(insertedRows[0].grants_class_id).toBeUndefined()
  })

  it('a govt_admin governing the exact node may mint an invite for it', async () => {
    govtAdminRow = { group_id: 'group-1' }
    const res = makeRes()
    await handler(makeReq({ role: 'teacher' }, 'group-1'), res)
    expect(res.statusCode).toBe(201)
    expect(insertedRows[0]).toMatchObject({ code_type: 'teacher', grants_group_id: 'group-1' })
  })

  it('a govt_admin governing an ANCESTOR node may mint an invite for a descendant', async () => {
    govtAdminRow = { group_id: 'group-1' }
    const res = makeRes()
    await handler(makeReq({ role: 'student' }, 'group-2'), res)
    expect(res.statusCode).toBe(201)
    expect(insertedRows[0]).toMatchObject({ code_type: 'student', grants_group_id: 'group-2' })
  })

  it('rejects a govt_admin who does not govern this node or an ancestor of it', async () => {
    govtAdminRow = { group_id: 'group-3' }
    const res = makeRes()
    await handler(makeReq({ role: 'teacher' }, 'group-1'), res)
    expect(res.statusCode).toBe(403)
    expect(insertedRows.length).toBe(0)
  })

  it('rejects an unauthenticated caller', async () => {
    verifyAuthTokenResult = { valid: false, error: 'no token' }
    const res = makeRes()
    await handler(makeReq({ role: 'teacher' }), res)
    expect(res.statusCode).toBe(401)
  })

  it('ignores a client-supplied grants_group_id — the path id always wins', async () => {
    verifyAdminResult = { userId: 'admin-1' }
    const res = makeRes()
    await handler(makeReq({ role: 'leader', grants_group_id: 'other-group' } as any, 'group-1'), res)
    expect(res.statusCode).toBe(201)
    expect(insertedRows[0].grants_group_id).toBe('group-1')
  })
})
