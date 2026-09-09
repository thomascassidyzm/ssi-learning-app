/**
 * Tests for POST /api/invite/create — region-tier slice 2: for school_admin
 * codes, grants_group_id is SERVER-DERIVED from the caller's own
 * govt_admins.group_id, never from the client payload
 * (region-tier-design.md §1e). The critical case is a client trying to mint
 * a link for a group they don't govern.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-key'

vi.mock('../_utils/auth', () => ({
  verifyAuthToken: vi.fn(async () => ({ valid: true, userId: 'leader-1' })),
}))

let govtAdminRow: any
let insertedRows: any[] = []

function makeChainable(table: string) {
  const builder: any = {
    select: () => builder,
    insert: (obj: unknown) => { insertedRows.push({ table, obj }); return builder },
    eq: () => builder,
    maybeSingle: () => {
      if (table === 'govt_admins') return Promise.resolve({ data: govtAdminRow, error: null })
      // Code-uniqueness probe during generation: pretend it's always free.
      return Promise.resolve({ data: null, error: null })
    },
    single: () => Promise.resolve({
      data: { id: 'code-1', code: insertedRows[insertedRows.length - 1]?.obj?.code || 'ABC-123' },
      error: null,
    }),
  }
  return builder
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: (table: string) => makeChainable(table) }),
}))

function makeReq(body: unknown): VercelRequest {
  return { method: 'POST', body, headers: { authorization: 'Bearer tok' } } as any
}

function makeRes(): VercelResponse & { statusCode?: number; body?: any } {
  const res: any = {}
  res.status = vi.fn((code: number) => { res.statusCode = code; return res })
  res.json = vi.fn((body: any) => { res.body = body; return res })
  return res
}

let handler: typeof import('./create').default

beforeEach(async () => {
  vi.resetModules()
  insertedRows = []
  govtAdminRow = { id: 'govt-row-1', group_id: 'my-group' }
  handler = (await import('./create')).default
})

describe('POST /api/invite/create — school_admin group stamping', () => {
  it('stamps grants_group_id from the caller\'s own govt_admins row', async () => {
    const req = makeReq({ code_type: 'school_admin', metadata: { school_name: 'Ysgol y Garnedd' } })
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(201)
    const insert = insertedRows.find(r => r.table === 'invite_codes')
    expect(insert.obj.grants_group_id).toBe('my-group')
  })

  it('IGNORES a client-supplied grants_group_id — cross-region minting must be impossible', async () => {
    const req = makeReq({
      code_type: 'school_admin',
      grants_group_id: 'someone-elses-group',
      metadata: { school_name: 'Sneaky School' },
    })
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(201)
    const insert = insertedRows.find(r => r.table === 'invite_codes')
    expect(insert.obj.grants_group_id).toBe('my-group')
    expect(insert.obj.grants_group_id).not.toBe('someone-elses-group')
  })

  it('rejects a caller with no govt_admins row', async () => {
    govtAdminRow = null
    const req = makeReq({ code_type: 'school_admin', metadata: { school_name: 'X' } })
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(403)
    expect(insertedRows.find(r => r.table === 'invite_codes')).toBeUndefined()
  })

  it('a govt_admin with no group_id yet (self-serve region naming pending) stamps null, not the client value', async () => {
    govtAdminRow = { id: 'govt-row-1', group_id: null }
    const req = makeReq({
      code_type: 'school_admin',
      grants_group_id: 'someone-elses-group',
      metadata: { school_name: 'X' },
    })
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(201)
    const insert = insertedRows.find(r => r.table === 'invite_codes')
    expect(insert.obj.grants_group_id).toBeNull()
  })
})
