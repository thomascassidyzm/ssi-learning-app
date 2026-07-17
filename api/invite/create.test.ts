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

let authResult: any
vi.mock('../_utils/auth', () => ({
  verifyAuthToken: vi.fn(async () => authResult),
}))

let govtAdminRow: any
let learnerRow: any
let schoolRow: any
let classRow: any
let insertedRows: any[] = []

// Tracks the .eq() filters chained onto the CURRENT query so maybeSingle/single
// can scope their canned response — matters for tables (schools, classes) that
// get filtered on both id AND the caller's own user_id (the 403 ownership check).
function makeChainable(table: string) {
  const filters: Record<string, unknown> = {}
  const builder: any = {
    select: () => builder,
    insert: (obj: unknown) => { insertedRows.push({ table, obj }); return builder },
    eq: (col: string, val: unknown) => { filters[col] = val; return builder },
    maybeSingle: () => {
      if (table === 'govt_admins') return Promise.resolve({ data: govtAdminRow, error: null })
      if (table === 'schools') {
        const match = schoolRow && schoolRow.id === filters.id && schoolRow.admin_user_id === filters.admin_user_id
        return Promise.resolve({ data: match ? schoolRow : null, error: null })
      }
      if (table === 'classes') {
        const match = classRow && classRow.id === filters.id && classRow.teacher_user_id === filters.teacher_user_id
        return Promise.resolve({ data: match ? classRow : null, error: null })
      }
      // Code-uniqueness probe during generation: pretend it's always free.
      return Promise.resolve({ data: null, error: null })
    },
    single: () => {
      if (table === 'learners') return Promise.resolve({ data: learnerRow, error: null })
      return Promise.resolve({
        data: { id: 'code-1', code: insertedRows[insertedRows.length - 1]?.obj?.code || 'ABC-123' },
        error: null,
      })
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

let handler: typeof import('./create').default

beforeEach(async () => {
  vi.resetModules()
  insertedRows = []
  authResult = { valid: true, userId: 'leader-1' }
  govtAdminRow = { id: 'govt-row-1', group_id: 'my-group' }
  learnerRow = null
  schoolRow = null
  classRow = null
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

describe('POST /api/invite/create — permission gates per code_type', () => {
  it('ssi_admin creates a govt_admin code with the client-supplied grants_group_id honoured', async () => {
    learnerRow = { platform_role: 'ssi_admin' }
    const req = makeReq({ code_type: 'govt_admin', grants_group_id: 'group-pre-built', metadata: { organization_name: 'Gwynedd' } })
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(201)
    const insert = insertedRows.find(r => r.table === 'invite_codes')
    expect(insert.obj.grants_group_id).toBe('group-pre-built')
    expect(insert.obj.code_type).toBe('govt_admin')
  })

  it('rejects a non-ssi_admin trying to create a govt_admin code', async () => {
    learnerRow = { platform_role: 'school_admin' }
    const req = makeReq({ code_type: 'govt_admin', metadata: { organization_name: 'Sneaky Region' } })
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(403)
    expect(insertedRows.find(r => r.table === 'invite_codes')).toBeUndefined()
  })

  it('school admin creates a teacher code for their own school', async () => {
    schoolRow = { id: 'school-1', admin_user_id: 'leader-1' }
    const req = makeReq({ code_type: 'teacher', grants_school_id: 'school-1' })
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(201)
    const insert = insertedRows.find(r => r.table === 'invite_codes')
    expect(insert.obj.code_type).toBe('teacher')
    expect(insert.obj.grants_school_id).toBe('school-1')
  })

  it('rejects a school admin creating a teacher code for a school they do not own', async () => {
    schoolRow = { id: 'school-1', admin_user_id: 'someone-else' }
    const req = makeReq({ code_type: 'teacher', grants_school_id: 'school-1' })
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(403)
    expect(insertedRows.find(r => r.table === 'invite_codes')).toBeUndefined()
  })

  it('rejects a teacher code with no grants_school_id', async () => {
    const req = makeReq({ code_type: 'teacher' })
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(400)
  })

  it('teacher creates a student code for their own class', async () => {
    classRow = { id: 'class-1', teacher_user_id: 'leader-1' }
    const req = makeReq({ code_type: 'student', grants_class_id: 'class-1' })
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(201)
    const insert = insertedRows.find(r => r.table === 'invite_codes')
    expect(insert.obj.code_type).toBe('student')
    expect(insert.obj.grants_class_id).toBe('class-1')
  })

  it('rejects a teacher creating a student code for a class they do not teach', async () => {
    classRow = { id: 'class-1', teacher_user_id: 'someone-else' }
    const req = makeReq({ code_type: 'student', grants_class_id: 'class-1' })
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(403)
    expect(insertedRows.find(r => r.table === 'invite_codes')).toBeUndefined()
  })

  it('rejects a student code with no grants_class_id', async () => {
    const req = makeReq({ code_type: 'student' })
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(400)
  })

  it('rejects an invalid code_type', async () => {
    const req = makeReq({ code_type: 'super_hacker' })
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(400)
  })

  it('rejects an unauthenticated caller', async () => {
    authResult = { valid: false, error: 'Missing or invalid Authorization header' }
    const req = makeReq({ code_type: 'teacher', grants_school_id: 'school-1' })
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(401)
    expect(insertedRows.find(r => r.table === 'invite_codes')).toBeUndefined()
  })
})

describe('POST /api/invite/create — privileged codes (ssi_admin/god/tester) are bounded', () => {
  it('bounds a tester code created with no expiry/max_uses to the default 7-day/1-use limits', async () => {
    learnerRow = { platform_role: 'ssi_admin' }
    const req = makeReq({ code_type: 'tester' })
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(201)
    const insert = insertedRows.find(r => r.table === 'invite_codes')
    expect(insert.obj.max_uses).toBe(1)
    expect(insert.obj.expires_at).toBeTruthy()
    const days = (new Date(insert.obj.expires_at).getTime() - Date.now()) / 86400000
    expect(days).toBeGreaterThan(6)
    expect(days).toBeLessThanOrEqual(7.01)
  })

  it('caps an over-broad tester max_uses/expires_at request at the privileged ceiling (50 uses / 90 days)', async () => {
    learnerRow = { platform_role: 'ssi_admin' }
    const req = makeReq({
      code_type: 'tester',
      max_uses: 999,
      expires_at: new Date(Date.now() + 365 * 86400000).toISOString(),
    })
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(201)
    const insert = insertedRows.find(r => r.table === 'invite_codes')
    expect(insert.obj.max_uses).toBe(50)
    const days = (new Date(insert.obj.expires_at).getTime() - Date.now()) / 86400000
    expect(days).toBeLessThanOrEqual(90.01)
  })

  it('bounds an ssi_admin code the same way, regardless of caller-supplied unlimited values', async () => {
    learnerRow = { platform_role: 'ssi_admin' }
    const req = makeReq({ code_type: 'ssi_admin', max_uses: -1, expires_at: 'not-a-date' })
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(201)
    const insert = insertedRows.find(r => r.table === 'invite_codes')
    expect(insert.obj.max_uses).toBe(1)
    expect(insert.obj.expires_at).toBeTruthy()
  })

  it('does NOT bound a non-privileged onboarding code (teacher) — caller values pass through as-is', async () => {
    schoolRow = { id: 'school-1', admin_user_id: 'leader-1' }
    const req = makeReq({ code_type: 'teacher', grants_school_id: 'school-1', max_uses: 500, expires_at: null })
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(201)
    const insert = insertedRows.find(r => r.table === 'invite_codes')
    expect(insert.obj.max_uses).toBe(500)
    expect(insert.obj.expires_at).toBeNull()
  })
})
