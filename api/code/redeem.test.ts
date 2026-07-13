/**
 * Tests for POST /api/code/redeem — region-tier slice 1 wiring:
 *   - govt_admin branch: honours grants_group_id; creates the group at
 *     redemption when absent (region-tier-design.md §1c).
 *   - school_admin branch: sets schools.group_id at birth and registers BOTH
 *     join codes (teacher + admin), not just teacher (§1f).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

process.env.SUPABASE_URL = 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'

vi.mock('../_utils/auth', () => ({
  verifyAuthToken: vi.fn(async () => ({ valid: true, userId: 'auth-user-1' })),
}))

// Captures every write (insert/update/upsert) per table for assertions.
let writes: Record<string, any[]> = {}
// Per-test table responders: (calls) => { data, error } | undefined (undefined = fall through to default)
let responders: Record<string, (calls: any[][]) => any> = {}

function recordWrite(table: string, op: string, payload: unknown) {
  writes[table] = writes[table] || []
  writes[table].push({ op, payload })
}

function makeChainable(table: string) {
  const calls: any[][] = []
  const builder: any = {
    select: (cols: string) => { calls.push(['select', cols]); return builder },
    insert: (obj: unknown) => { calls.push(['insert', obj]); recordWrite(table, 'insert', obj); return builder },
    update: (obj: unknown) => { calls.push(['update', obj]); recordWrite(table, 'update', obj); return builder },
    upsert: (obj: unknown, opts: unknown) => { calls.push(['upsert', obj, opts]); recordWrite(table, 'upsert', obj); return builder },
    delete: () => { calls.push(['delete']); recordWrite(table, 'delete', undefined); return builder },
    eq: (col: string, val: unknown) => { calls.push(['eq', col, val]); return builder },
    is: (col: string, val: unknown) => { calls.push(['is', col, val]); return builder },
    resolve: () => {
      const respond = responders[table]
      if (respond) {
        const r = respond(calls)
        if (r !== undefined) return r
      }
      return { data: null, error: null }
    },
    maybeSingle() { return Promise.resolve(this.resolve()) },
    single() { return Promise.resolve(this.resolve()) },
    then(onF: any, onR: any) { return Promise.resolve(this.resolve()).then(onF, onR) },
  }
  return builder
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => makeChainable(table),
    rpc: (name: string, params: any) => {
      if (name === 'claim_invite_code_use') return Promise.resolve({ data: params.p_id, error: null })
      return Promise.resolve({ data: null, error: null })
    },
    auth: {
      admin: {
        getUserById: () => Promise.resolve({ data: { user: { email: 'leader@example.com' } } }),
      },
    },
  }),
}))

function makeRes() {
  const res: any = { _headers: {} }
  res.status = vi.fn((code: number) => { res._status = code; return res })
  res.json = vi.fn((body: unknown) => { res._json = body; return res })
  return res as VercelResponse & { _status?: number; _json?: any }
}

function makeReq(overrides: Partial<VercelRequest>): VercelRequest {
  return { method: 'POST', query: {}, headers: {}, body: {}, ...overrides } as VercelRequest
}

describe('POST /api/code/redeem (invite codes, region-tier slice 1)', () => {
  let handler: typeof import('./redeem').default

  beforeEach(async () => {
    vi.resetModules()
    writes = {}
    responders = {}
    handler = (await import('./redeem')).default
  })

  it('govt_admin branch: honours an existing grants_group_id, does not create a new group', async () => {
    responders.invite_codes = (calls) => {
      const isSelect = calls.some((c) => c[0] === 'select')
      if (isSelect) {
        return {
          data: {
            id: 'invite-1',
            code: 'ABC-123',
            code_type: 'govt_admin',
            grants_region: null,
            grants_school_id: null,
            grants_class_id: null,
            grants_group_id: 'group-existing',
            metadata: { organization_name: 'Gwynedd Education Authority' },
            max_uses: 1,
            use_count: 0,
            expires_at: null,
            is_active: true,
          },
          error: null,
        }
      }
      return { data: null, error: null }
    }
    responders.learners = (calls) => {
      const isSelect = calls.some((c) => c[0] === 'select')
      if (isSelect) return { data: { id: 'learner-1' }, error: null } // already exists
      return { data: null, error: null }
    }

    const res = makeRes()
    await handler(makeReq({ body: { code: 'ABC-123', codeKind: 'invite' } }), res)

    expect(res._status).toBe(200)
    expect(res._json.success).toBe(true)
    expect(res._json.role).toBe('govt_admin')
    // No new group created — reused the invite's grants_group_id.
    expect(writes.groups).toBeUndefined()
    expect(writes.govt_admins).toHaveLength(1)
    expect(writes.govt_admins[0].payload.group_id).toBe('group-existing')
  })

  it('govt_admin branch: creates the group at redemption when grants_group_id is absent', async () => {
    responders.invite_codes = (calls) => {
      const isSelect = calls.some((c) => c[0] === 'select')
      if (isSelect) {
        return {
          data: {
            id: 'invite-2',
            code: 'DEF-456',
            code_type: 'govt_admin',
            grants_region: null,
            grants_school_id: null,
            grants_class_id: null,
            grants_group_id: null,
            metadata: { organization_name: 'New Region HQ' },
            max_uses: 1,
            use_count: 0,
            expires_at: null,
            is_active: true,
          },
          error: null,
        }
      }
      return { data: null, error: null }
    }
    responders.learners = () => ({ data: { id: 'learner-2' }, error: null })
    responders.groups = (calls) => {
      const isInsert = calls.some((c) => c[0] === 'insert')
      if (isInsert) return { data: { id: 'group-new' }, error: null }
      return { data: null, error: null }
    }

    const res = makeRes()
    await handler(makeReq({ body: { code: 'DEF-456', codeKind: 'invite' } }), res)

    expect(res._status).toBe(200)
    expect(res._json.success).toBe(true)
    expect(writes.groups).toHaveLength(1)
    expect(writes.groups[0].payload).toMatchObject({ name: 'New Region HQ', type: 'region' })
    expect(writes.govt_admins[0].payload.group_id).toBe('group-new')
  })

  it('school_admin branch: sets group_id at birth and registers BOTH join codes', async () => {
    responders.invite_codes = (calls) => {
      const isSelect = calls.some((c) => c[0] === 'select')
      if (isSelect) {
        return {
          data: {
            id: 'invite-3',
            code: 'SCH-789',
            code_type: 'school_admin',
            grants_region: null,
            grants_school_id: null,
            grants_class_id: null,
            grants_group_id: 'group-gwynedd',
            metadata: { school_name: 'Ysgol y Garnedd' },
            max_uses: 1,
            use_count: 0,
            expires_at: null,
            is_active: true,
          },
          error: null,
        }
      }
      return { data: null, error: null }
    }
    responders.learners = () => ({ data: { id: 'learner-3' }, error: null })
    responders.schools = (calls) => {
      const isInsert = calls.some((c) => c[0] === 'insert')
      // The pre-insert existence check selects 'id' alongside the join codes;
      // ensureJoinCodesRegistered's own select does not — that's how the two
      // are told apart here. Pre-check → no existing school (this test covers
      // the fresh-insert path).
      const isPreCheckSelect = calls.some((c) => c[0] === 'select' && /\bid\b/.test(String(c[1])) && String(c[1]).includes('teacher_join_code'))
      const isSelectJoinCodes = calls.some((c) => c[0] === 'select' && String(c[1]).includes('teacher_join_code') && !/\bid\b/.test(String(c[1])))
      if (isInsert) {
        return {
          data: { id: 'school-1', teacher_join_code: 'TEACH-1', admin_join_code: 'ADMIN-1' },
          error: null,
        }
      }
      if (isPreCheckSelect) {
        return { data: null, error: null }
      }
      if (isSelectJoinCodes) {
        return { data: { teacher_join_code: 'TEACH-1', admin_join_code: 'ADMIN-1' }, error: null }
      }
      return { data: null, error: null }
    }

    const res = makeRes()
    await handler(makeReq({ body: { code: 'SCH-789', codeKind: 'invite' } }), res)

    expect(res._status).toBe(200)
    expect(res._json.success).toBe(true)
    expect(res._json.redirectTo).toBe('/schools1') // routes through onboarding/provision for trial clocks
    expect(writes.schools).toHaveLength(1)
    expect(writes.schools[0].payload.group_id).toBe('group-gwynedd')
    expect(writes.invite_codes.some((w) => w.op === 'upsert')).toBe(true)
    const upserted = writes.invite_codes.find((w) => w.op === 'upsert')!.payload
    const codeTypes = upserted.map((r: any) => r.code_type)
    expect(codeTypes).toEqual(expect.arrayContaining(['teacher', 'school_admin_join']))
  })

  it('school_admin branch: group_id is null when the invite carries none (self-serve, ungrouped)', async () => {
    responders.invite_codes = (calls) => {
      const isSelect = calls.some((c) => c[0] === 'select')
      if (isSelect) {
        return {
          data: {
            id: 'invite-4',
            code: 'SCH-000',
            code_type: 'school_admin',
            grants_region: null,
            grants_school_id: null,
            grants_class_id: null,
            grants_group_id: null,
            metadata: {},
            max_uses: 1,
            use_count: 0,
            expires_at: null,
            is_active: true,
          },
          error: null,
        }
      }
      return { data: null, error: null }
    }
    responders.learners = () => ({ data: { id: 'learner-4' }, error: null })
    responders.schools = (calls) => {
      const isInsert = calls.some((c) => c[0] === 'insert')
      const isPreCheckSelect = calls.some((c) => c[0] === 'select' && /\bid\b/.test(String(c[1])) && String(c[1]).includes('teacher_join_code'))
      if (isInsert) return { data: { id: 'school-2', teacher_join_code: 'TEACH-2', admin_join_code: 'ADMIN-2' }, error: null }
      if (isPreCheckSelect) return { data: null, error: null }
      return { data: { teacher_join_code: 'TEACH-2', admin_join_code: 'ADMIN-2' }, error: null }
    }

    const res = makeRes()
    await handler(makeReq({ body: { code: 'SCH-000', codeKind: 'invite' } }), res)

    expect(res._status).toBe(200)
    expect(writes.schools[0].payload.group_id).toBe(null)
  })

  it('school_admin branch: two concurrent redemptions for the same admin produce exactly ONE school (double-redeem race, WORKLIST 07-13)', async () => {
    responders.invite_codes = (calls) => {
      const isSelect = calls.some((c) => c[0] === 'select')
      if (isSelect) {
        return {
          data: {
            id: 'invite-race',
            code: 'SCH-RACE',
            code_type: 'school_admin',
            grants_region: null,
            grants_school_id: null,
            grants_class_id: null,
            grants_group_id: null,
            metadata: { school_name: 'Race Test School' },
            max_uses: null,
            use_count: 0,
            expires_at: null,
            is_active: true,
          },
          error: null,
        }
      }
      return { data: null, error: null }
    }
    responders.learners = () => ({ data: { id: 'learner-race' }, error: null })

    // Models the real DB: the FIRST insert to actually commit wins and sets
    // the row; any insert attempted after that hits the 20260713 unique
    // index on admin_user_id and gets 23505, regardless of call ordering.
    let committedSchool: any = null
    responders.schools = (calls) => {
      const isInsert = calls.some((c) => c[0] === 'insert')
      const isSelect = calls.some((c) => c[0] === 'select')
      if (isInsert) {
        if (committedSchool) {
          return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "schools_admin_user_id_key"' } }
        }
        committedSchool = { id: 'school-race', teacher_join_code: 'TEACH-R', admin_join_code: 'ADMIN-R' }
        return { data: committedSchool, error: null }
      }
      if (isSelect) return { data: committedSchool, error: null }
      return { data: null, error: null }
    }

    const res1 = makeRes()
    const res2 = makeRes()
    await Promise.all([
      handler(makeReq({ body: { code: 'SCH-RACE', codeKind: 'invite' } }), res1),
      handler(makeReq({ body: { code: 'SCH-RACE', codeKind: 'invite' } }), res2),
    ])

    // Both requests report success (idempotent — the loser reuses the winner's row).
    expect(res1._json.success).toBe(true)
    expect(res2._json.success).toBe(true)
    // Exactly one school row actually committed.
    expect(writes.schools.filter((w) => w.op === 'insert')).toHaveLength(2) // both attempted the insert...
    expect(committedSchool.id).toBe('school-race') // ...but only one write ever "took"
  })

  it('govt_admin branch: two concurrent redemptions for the same admin produce exactly ONE govt_admins row', async () => {
    responders.invite_codes = (calls) => {
      const isSelect = calls.some((c) => c[0] === 'select')
      if (isSelect) {
        return {
          data: {
            id: 'invite-govt-race',
            code: 'GOVT-RACE',
            code_type: 'govt_admin',
            grants_region: null,
            grants_school_id: null,
            grants_class_id: null,
            grants_group_id: null,
            metadata: { organization_name: 'Race Region' },
            max_uses: null,
            use_count: 0,
            expires_at: null,
            is_active: true,
          },
          error: null,
        }
      }
      return { data: null, error: null }
    }
    responders.learners = () => ({ data: { id: 'learner-govt-race' }, error: null })
    // Neither request sees the other's group ahead of time (no grants_group_id
    // to share, and no committed govt_admins row yet) — each mints its own,
    // exactly as two truly concurrent requests would.
    let groupInsertCount = 0
    responders.groups = (calls) => {
      const isInsert = calls.some((c) => c[0] === 'insert')
      if (isInsert) {
        groupInsertCount++
        return { data: { id: `group-${groupInsertCount}` }, error: null }
      }
      return { data: null, error: null }
    }

    let committedGovtAdmin: any = null
    responders.govt_admins = (calls) => {
      const isInsert = calls.some((c) => c[0] === 'insert')
      const isSelect = calls.some((c) => c[0] === 'select')
      if (isInsert) {
        if (committedGovtAdmin) {
          return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "govt_admins_user_id_key"' } }
        }
        const payload = calls.find((c) => c[0] === 'insert')![1]
        committedGovtAdmin = { group_id: payload.group_id }
        return { data: committedGovtAdmin, error: null }
      }
      if (isSelect) return { data: committedGovtAdmin, error: null }
      return { data: null, error: null }
    }

    const res1 = makeRes()
    const res2 = makeRes()
    await Promise.all([
      handler(makeReq({ body: { code: 'GOVT-RACE', codeKind: 'invite' } }), res1),
      handler(makeReq({ body: { code: 'GOVT-RACE', codeKind: 'invite' } }), res2),
    ])

    expect(res1._json.success).toBe(true)
    expect(res2._json.success).toBe(true)
    // Exactly one govt_admins row survives.
    expect(committedGovtAdmin).not.toBeNull()
    // Both requests minted their own group (no shared group_id to race on),
    // but the loser's orphan group gets cleaned up — one delete, one survivor.
    expect(writes.groups.filter((w) => w.op === 'insert')).toHaveLength(2)
    expect(writes.groups.filter((w) => w.op === 'delete')).toHaveLength(1)
  })
})
