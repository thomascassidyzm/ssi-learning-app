/**
 * Tests for POST /api/govt/create-school — region-tier slice 2, revised §5c:
 * a leader creates a school GROUP-OWNED FROM BIRTH with a VACANT admin seat.
 * group_id is SERVER-DERIVED from the caller's own govt_admins row; the
 * critical case is rejecting a caller with no group to create into.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-key'

vi.mock('../_utils/auth', () => ({
  verifyAuthToken: vi.fn(async () => ({ valid: true, userId: 'leader-1' })),
}))

const ensureJoinCodesRegistered = vi.fn(async () => {})
vi.mock('../_utils/schoolJoinCodes', () => ({ ensureJoinCodesRegistered }))

let govtAdminRow: any
let insertedSchool: any

function makeChainable(table: string) {
  const builder: any = {
    select: () => builder,
    insert: (obj: unknown) => { if (table === 'schools') insertedSchool = obj; return builder },
    eq: () => builder,
    maybeSingle: () => {
      if (table === 'govt_admins') return Promise.resolve({ data: govtAdminRow, error: null })
      return Promise.resolve({ data: null, error: null })
    },
    single: () => {
      if (table === 'schools') {
        return Promise.resolve({
          data: { id: 'school-1', school_name: insertedSchool?.school_name, ...insertedSchool },
          error: null,
        })
      }
      return Promise.resolve({ data: null, error: null })
    },
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

let handler: typeof import('./create-school').default

beforeEach(async () => {
  vi.resetModules()
  ensureJoinCodesRegistered.mockClear()
  insertedSchool = null
  govtAdminRow = { group_id: 'my-group' }
  handler = (await import('./create-school')).default
})

describe('POST /api/govt/create-school', () => {
  it('creates a group-owned school with a VACANT admin seat (admin_user_id null)', async () => {
    const req = makeReq({ school_name: 'Ysgol y Garnedd' })
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(200)
    expect(insertedSchool).toMatchObject({
      school_name: 'Ysgol y Garnedd',
      group_id: 'my-group',
      admin_user_id: null,
    })
    expect(insertedSchool.platform_expires_at).toBeTruthy()
    expect(ensureJoinCodesRegistered).toHaveBeenCalledWith(expect.anything(), 'school-1', 'leader-1')
  })

  it('rejects a caller with no govt_admins group (nothing to create into — the critical case)', async () => {
    govtAdminRow = null
    const req = makeReq({ school_name: 'Sneaky School' })
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(403)
    expect(insertedSchool).toBeNull()
  })

  it('ignores a client-supplied group_id and uses the caller\'s own group (cross-group escalation attempt)', async () => {
    govtAdminRow = { group_id: 'leaders-own-group' }
    const req = makeReq({ school_name: 'Sneaky School', group_id: 'someone-elses-group' })
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(200)
    expect(insertedSchool).toMatchObject({ group_id: 'leaders-own-group' })
  })

  it('rejects a govt_admin with no group_id yet (group not named/joined)', async () => {
    govtAdminRow = { group_id: null }
    const req = makeReq({ school_name: 'X' })
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(403)
    expect(insertedSchool).toBeNull()
  })

  it('REJECTS an ssi_admin browsing another org\'s read-view (no govt_admins row of their own) — the "+Add school" cross-tenant write hole named in the 2026-07-17 admin/group write-gate audit; server-side already refuses to write on their behalf, independent of any UI gating', async () => {
    govtAdminRow = null
    const req = makeReq({ school_name: 'Written while impersonating' })
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(403)
    expect(insertedSchool).toBeNull()
  })

  it('400s a missing school_name', async () => {
    const req = makeReq({})
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(400)
    expect(insertedSchool).toBeNull()
  })
})
