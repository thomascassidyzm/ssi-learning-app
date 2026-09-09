/**
 * Tests for GET /api/govt/school-links — lists school_admin invite codes
 * bound to the CALLER'S OWN group only. Critical case: a caller with no
 * group must not see anyone else's links (403, not an empty leak).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-key'

vi.mock('../_utils/auth', () => ({
  verifyAuthToken: vi.fn(async () => ({ valid: true, userId: 'leader-1' })),
}))

let govtAdminRow: any
let codesForGroup: any[]
let schoolsForGroup: any[]
let lastEqByTable: Record<string, [string, unknown][]>

function makeChainable(table: string) {
  const calls: [string, unknown][] = []
  const builder: any = {
    select: () => builder,
    eq: (col: string, val: unknown) => { calls.push([col, val]); return builder },
    order: () => builder,
    maybeSingle: () => {
      if (table === 'govt_admins') return Promise.resolve({ data: govtAdminRow, error: null })
      return Promise.resolve({ data: null, error: null })
    },
    then: (onF: any, onR: any) => {
      lastEqByTable[table] = calls
      if (table === 'invite_codes') return Promise.resolve({ data: codesForGroup, error: null }).then(onF, onR)
      if (table === 'schools') return Promise.resolve({ data: schoolsForGroup, error: null }).then(onF, onR)
      return Promise.resolve({ data: null, error: null }).then(onF, onR)
    },
  }
  return builder
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: (table: string) => makeChainable(table) }),
}))

function makeReq(): VercelRequest {
  return { method: 'GET', headers: { authorization: 'Bearer tok' } } as any
}

function makeRes(): VercelResponse & { statusCode?: number; body?: any } {
  const res: any = {}
  res.status = vi.fn((code: number) => { res.statusCode = code; return res })
  res.json = vi.fn((body: any) => { res.body = body; return res })
  return res
}

let handler: typeof import('./school-links').default

beforeEach(async () => {
  vi.resetModules()
  lastEqByTable = {}
  govtAdminRow = { group_id: 'my-group' }
  codesForGroup = [
    { id: 'code-1', code: 'ABC-123', metadata: { school_name: 'Ysgol A' }, use_count: 0, max_uses: null, is_active: true, created_at: 't1' },
  ]
  schoolsForGroup = []
  handler = (await import('./school-links')).default
})

describe('GET /api/govt/school-links', () => {
  it('returns only links scoped to the caller\'s own group', async () => {
    const req = makeReq()
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(200)
    expect(res.body.links).toHaveLength(1)
    expect(res.body.links[0].redeemed).toBe(false)
    expect(lastEqByTable.invite_codes).toEqual(expect.arrayContaining([['grants_group_id', 'my-group']]))
  })

  it('marks a link redeemed when a school references it', async () => {
    schoolsForGroup = [{ id: 'school-1', school_name: 'Ysgol A', invite_code_id: 'code-1', admin_user_id: null, created_at: 't2' }]
    const req = makeReq()
    const res = makeRes()
    await handler(req, res)
    expect(res.body.links[0].redeemed).toBe(true)
    expect(res.body.links[0].school.claimed).toBe(false)
  })

  it('rejects a caller with no govt group (the critical case — never leak another group\'s links)', async () => {
    govtAdminRow = null
    const req = makeReq()
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(403)
    expect(res.body.links).toBeUndefined()
  })
})
