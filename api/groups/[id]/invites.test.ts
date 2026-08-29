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

let provisionPersonaResult: any
let provisionPersonaArg: any
vi.mock('../../_utils/provisionPersona', () => ({
  provisionPersona: vi.fn(async (_svc: any, spec: any) => {
    provisionPersonaArg = spec
    return provisionPersonaResult
  }),
}))

// The invite email rides Supabase Auth's existing sender (see
// _utils/sendInviteEmail.ts) — mocked here so the tests assert WHAT we ask it
// to send, never that a mail leaves the machine.
let sendInviteEmailResult: { sent: boolean; error?: string }
let sendInviteEmailCalls: [string | null | undefined, string][] = []
vi.mock('../../_utils/sendInviteEmail', () => ({
  isMailable: (e?: string | null) => !!e && e.includes('@') && !e.endsWith('@invite.saysomethingin.app'),
  sendInviteEmail: vi.fn(async (email: string, url: string) => {
    sendInviteEmailCalls.push([email, url])
    return sendInviteEmailResult
  }),
}))

let govtAdminRow: any
// Tree fixture for isStrictDescendantGroup (parent_id walk since 2026-08-06):
// 22222222-2222-4222-8222-222222222222 is a real sub-group of 11111111-1111-4111-8111-111111111111; 33333333-3333-4333-8333-333333333333 is unrelated.
let groupPaths: Record<string, string> = { '11111111-1111-4111-8111-111111111111': '1', '22222222-2222-4222-8222-222222222222': '1.2', '33333333-3333-4333-8333-333333333333': '9' }
const GROUP_PARENTS: Record<string, string | null> = { '11111111-1111-4111-8111-111111111111': null, '22222222-2222-4222-8222-222222222222': '11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333': null }
let existingCodes: Set<string> = new Set()
let insertedRows: any[] = []
let insertError: any = null
// GET fixtures: the school-node bridge (schools.node_group_id -> id) and the
// invite_codes list the GET reads back.
let schoolsRows: { id: string; node_group_id: string; school_name?: string; group_id?: string | null }[] = []
let codeRows: any[] = []
// Ledger fixtures: subtree groups (resolveSubtree's list read), classes, and
// a record of every .update() the handler issues.
let subtreeGroupRows: { id: string; name: string }[] = []
let classesRows: { id: string; class_name: string; school_id: string }[] = []
let updatedRows: [string, any, [string, unknown][]][] = []

function makeChainable(table: string) {
  let eqVal: unknown
  const eqFilters: [string, unknown][] = []
  let orExpr: string | null = null
  let updatePatch: any = null
  const builder: any = {
    select: () => builder,
    eq: (col: string, val: unknown) => { eqVal = val; eqFilters.push([col, val]); return builder },
    in: () => builder,
    is: () => builder,
    order: () => builder,
    limit: () => builder,
    or: (expr: string) => { orExpr = expr; return builder },
    update: (patch: any) => { updatePatch = patch; return builder },
    maybeSingle: () => {
      if (table === 'govt_admins') return Promise.resolve({ data: govtAdminRow, error: null })
      if (table === 'groups') {
        const path = groupPaths[eqVal as string]
        return Promise.resolve({ data: path ? { id: eqVal, path } : null, error: null })
      }
      if (table === 'schools') {
        // ownSchoolIdForNode: schools.select('id').eq('node_group_id', nodeId)
        const nodeId = eqFilters.find((f) => f[0] === 'node_group_id')?.[1]
        const s = schoolsRows.find((r) => r.node_group_id === nodeId)
        return Promise.resolve({ data: s ? { id: s.id } : null, error: null })
      }
      if (table === 'invite_codes') {
        const byCode = eqFilters.find((f) => f[0] === 'code')?.[1]
        const full = codeRows.find((r) => r.code === byCode)
        if (full) return Promise.resolve({ data: full, error: null })
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
    // Thenable — list reads and update() are awaited directly off the builder.
    then: (resolve: (r: { data: any; error: any }) => void) => {
      if (updatePatch !== null) {
        updatedRows.push([table, updatePatch, eqFilters.slice()])
        return resolve({ data: null, error: null })
      }
      if (table === 'groups') {
        // The unfiltered forest read behind descendantIds, unioned with
        // whatever the GET-lens fixture wants listed.
        const byId = new Map<string, any>(
          Object.entries(GROUP_PARENTS).map(([id, parent_id]) => [id, { id, parent_id }]),
        )
        for (const r of subtreeGroupRows) byId.set(r.id, { ...(byId.get(r.id) || {}), ...r })
        return resolve({ data: [...byId.values()], error: null })
      }
      if (table === 'schools') return resolve({ data: schoolsRows, error: null })
      if (table === 'classes') return resolve({ data: classesRows, error: null })
      if (table === 'learners') return resolve({ data: [], error: null })
      if (table !== 'invite_codes') return resolve({ data: [], error: null })
      let rows = codeRows.slice()
      for (const [col, val] of eqFilters) rows = rows.filter((r) => r[col] === val)
      if (orExpr) {
        // Split on top-level commas only — `col.in.(a,b)` carries commas
        // inside its parens.
        const parts: string[] = []
        let depth = 0, cur = ''
        for (const ch of orExpr) {
          if (ch === '(') depth++
          if (ch === ')') depth--
          if (ch === ',' && depth === 0) { parts.push(cur); cur = '' } else { cur += ch }
        }
        if (cur) parts.push(cur)
        const clauses = parts.map((c) => {
          const p = c.split('.')
          // supports col.eq.val and col.in.(a,b,c)
          if (p[1] === 'in') {
            const vals = c.slice(c.indexOf('(') + 1, c.lastIndexOf(')')).split(',')
            return [p[0], vals] as [string, string[]]
          }
          return [p[0], p[2]] as [string, string]
        })
        rows = rows.filter((r) => clauses.some(([col, val]) =>
          Array.isArray(val) ? val.includes(String(r[col])) : String(r[col]) === val
        ))
      }
      return resolve({ data: rows, error: null })
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

function makeReq(body: unknown, groupId = '11111111-1111-4111-8111-111111111111'): VercelRequest {
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
  schoolsRows = []
  codeRows = []
  subtreeGroupRows = []
  classesRows = []
  updatedRows = []
  provisionPersonaArg = undefined
  sendInviteEmailCalls = []
  sendInviteEmailResult = { sent: true }
  provisionPersonaResult = { authUserId: 'persona-9', email: 'persona-9@invite.saysomethingin.app', learnerId: 'learner-9' }
  verifyAdminResult = { error: 'Not admin', status: 403 }
  verifyAuthTokenResult = { valid: true, userId: 'leader-1' }
  handler = (await import('./invites')).default
})

function makeGetReq(groupId = '11111111-1111-4111-8111-111111111111'): VercelRequest {
  return { method: 'GET', query: { id: groupId }, headers: { authorization: 'Bearer tok' } } as any
}

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
    await handler(makeReq({ role: 'leader', limits: { max_uses: 5 } }, '33333333-3333-4333-8333-333333333333'), res)
    expect(res.statusCode).toBe(201)
    expect(insertedRows[0]).toMatchObject({
      code_type: 'govt_admin',
      grants_group_id: '33333333-3333-4333-8333-333333333333',
      max_uses: 5,
      created_by: 'admin-1',
    })
    expect(insertedRows[0].grants_school_id).toBeUndefined()
    expect(insertedRows[0].grants_class_id).toBeUndefined()
  })

  it('a govt_admin governing the exact node may mint an invite for it', async () => {
    govtAdminRow = { group_id: '11111111-1111-4111-8111-111111111111' }
    const res = makeRes()
    await handler(makeReq({ role: 'teacher' }, '11111111-1111-4111-8111-111111111111'), res)
    expect(res.statusCode).toBe(201)
    expect(insertedRows[0]).toMatchObject({ code_type: 'teacher', grants_group_id: '11111111-1111-4111-8111-111111111111' })
  })

  it('a govt_admin governing an ANCESTOR node may mint an invite for a descendant', async () => {
    govtAdminRow = { group_id: '11111111-1111-4111-8111-111111111111' }
    const res = makeRes()
    await handler(makeReq({ role: 'student' }, '22222222-2222-4222-8222-222222222222'), res)
    expect(res.statusCode).toBe(201)
    expect(insertedRows[0]).toMatchObject({ code_type: 'student', grants_group_id: '22222222-2222-4222-8222-222222222222' })
  })

  it('rejects a govt_admin who does not govern this node or an ancestor of it', async () => {
    govtAdminRow = { group_id: '33333333-3333-4333-8333-333333333333' }
    const res = makeRes()
    await handler(makeReq({ role: 'teacher' }, '11111111-1111-4111-8111-111111111111'), res)
    expect(res.statusCode).toBe(403)
    expect(insertedRows.length).toBe(0)
  })

  // COORD-03 (fixed 2026-08-25): :id reaches PostgREST `.or()` filter strings,
  // so a non-uuid is a malformed request, not a lookup.
  it('400s a :id that is not a uuid, before any lookup', async () => {
    verifyAdminResult = { userId: 'admin-1' }
    const res = makeRes()
    await handler(makeReq({ role: 'teacher' }, 'not-a-uuid,grants_group_id.neq.x'), res)
    expect(res.statusCode).toBe(400)
    expect(insertedRows.length).toBe(0)
  })

  // TENANCY-07 (fixed 2026-08-25): staff seats mint as bounded bearer tokens.
  it('bounds a leader mint that asks for no expiry and unlimited uses', async () => {
    verifyAdminResult = { userId: 'admin-1' }
    const res = makeRes()
    await handler(makeReq({ role: 'leader' }), res)
    expect(res.statusCode).toBe(201)
    expect(typeof insertedRows[0].expires_at).toBe('string')
    expect(new Date(insertedRows[0].expires_at as string).getTime()).toBeGreaterThan(Date.now())
    expect(insertedRows[0].max_uses).toBe(1)
  })

  it('caps an over-broad school_leader mint instead of honouring it', async () => {
    verifyAdminResult = { userId: 'admin-1' }
    schoolsRows = [{ id: 'school-1', node_group_id: '11111111-1111-4111-8111-111111111111' }]
    const res = makeRes()
    await handler(makeReq({ role: 'school_leader', limits: { max_uses: 100000, expires_at: '2099-01-01T00:00:00.000Z' } }), res)
    expect(res.statusCode).toBe(201)
    expect(insertedRows[0].max_uses).toBe(50)
    expect(new Date(insertedRows[0].expires_at as string).getTime())
      .toBeLessThan(Date.now() + 91 * 86400 * 1000)
  })

  it('leaves a teacher mint’s limits exactly as asked — onboarding links are not bearer tokens', async () => {
    verifyAdminResult = { userId: 'admin-1' }
    const res = makeRes()
    await handler(makeReq({ role: 'teacher' }), res)
    expect(res.statusCode).toBe(201)
    expect(insertedRows[0].expires_at).toBeUndefined()
    expect(insertedRows[0].max_uses).toBeUndefined()
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
    await handler(makeReq({ role: 'leader', grants_group_id: 'other-group' } as any, '11111111-1111-4111-8111-111111111111'), res)
    expect(res.statusCode).toBe(201)
    expect(insertedRows[0].grants_group_id).toBe('11111111-1111-4111-8111-111111111111')
  })

  it('school_leader at a school node mints a school_admin_join code keyed by grants_school_id', async () => {
    verifyAdminResult = { userId: 'admin-1' }
    schoolsRows = [{ id: 'school-9', node_group_id: '11111111-1111-4111-8111-111111111111' }]
    const res = makeRes()
    await handler(makeReq({ role: 'school_leader' }, '11111111-1111-4111-8111-111111111111'), res)
    expect(res.statusCode).toBe(201)
    expect(insertedRows[0]).toMatchObject({ code_type: 'school_admin_join', grants_school_id: 'school-9' })
    expect(insertedRows[0].grants_group_id).toBeUndefined()
  })

  it('rejects school_leader at a plain group node (no attached school)', async () => {
    verifyAdminResult = { userId: 'admin-1' }
    const res = makeRes()
    await handler(makeReq({ role: 'school_leader' }, '11111111-1111-4111-8111-111111111111'), res)
    expect(res.statusCode).toBe(400)
    expect(insertedRows.length).toBe(0)
  })

  // --- Personal links (species 1, founder-ruled 2026-07-20) ---
  it('personal mint provisions the account first and binds it into the code metadata — never client-supplied', async () => {
    verifyAdminResult = { userId: 'admin-1' }
    const res = makeRes()
    await handler(makeReq({ role: 'leader', personal: { name: 'IME Programme Leader', personal_auth_user_id: 'attacker' } as any }, '11111111-1111-4111-8111-111111111111'), res)
    expect(res.statusCode).toBe(201)
    expect(provisionPersonaArg).toMatchObject({ role: 'leader', name: 'IME Programme Leader', groupId: '11111111-1111-4111-8111-111111111111', createdBy: 'admin-1' })
    expect(insertedRows[0].metadata).toEqual({ personal_auth_user_id: 'persona-9', personal_name: 'IME Programme Leader' })
    expect(res.body.account).toMatchObject({ auth_user_id: 'persona-9', name: 'IME Programme Leader' })
  })

  it('a personal mint with a real email SENDS the invite to it, and reports that it went', async () => {
    verifyAdminResult = { userId: 'admin-1' }
    provisionPersonaResult = { authUserId: 'persona-9', email: 'aran@example.com', learnerId: 'learner-9' }
    const res = makeRes()
    await handler(makeReq({ role: 'teacher', personal: { name: 'Aran', email: 'aran@example.com' } }, '11111111-1111-4111-8111-111111111111'), res)
    expect(res.statusCode).toBe(201)
    expect(sendInviteEmailCalls).toEqual([['aran@example.com', res.body.url]])
    expect(res.body.emailed).toMatchObject({ sent: true, to: 'aran@example.com' })
    // Stored so the ledger can offer "Email again" without an auth lookup.
    expect(insertedRows[0].metadata.personal_email).toBe('aran@example.com')
  })

  it('a failed send never fails the mint — the link still comes back to share by hand', async () => {
    verifyAdminResult = { userId: 'admin-1' }
    sendInviteEmailResult = { sent: false, error: 'smtp down' }
    provisionPersonaResult = { authUserId: 'persona-9', email: 'aran@example.com', learnerId: 'learner-9' }
    const res = makeRes()
    await handler(makeReq({ role: 'teacher', personal: { name: 'Aran', email: 'aran@example.com' } }, '11111111-1111-4111-8111-111111111111'), res)
    expect(res.statusCode).toBe(201)
    expect(res.body.url).toContain('/redeem/')
    expect(res.body.emailed).toMatchObject({ sent: false, error: 'smtp down' })
  })

  it('a personal mint with NO email sends nothing — the placeholder address is never mailed', async () => {
    verifyAdminResult = { userId: 'admin-1' }
    const res = makeRes()
    await handler(makeReq({ role: 'teacher', personal: { name: 'No Email' } }, '11111111-1111-4111-8111-111111111111'), res)
    expect(res.statusCode).toBe(201)
    expect(sendInviteEmailCalls.length).toBe(0)
    expect(res.body.emailed).toBeUndefined()
    expect(insertedRows[0].metadata.personal_email).toBeUndefined()
  })

  it('personal mint requires a name', async () => {
    verifyAdminResult = { userId: 'admin-1' }
    const res = makeRes()
    await handler(makeReq({ role: 'teacher', personal: {} }, '11111111-1111-4111-8111-111111111111'), res)
    expect(res.statusCode).toBe(400)
    expect(insertedRows.length).toBe(0)
  })

  it('a personal TEACHER link carrying a class_id is refused at the door — the guard that stops a code_type=teacher row with grants_class_id and no school (A-74 scout finding, verified NOT reachable)', async () => {
    // The scout's inferred `SCHOOL:null` bug went via this mint. It cannot:
    // personal.class_id is 400'd for every role but student, so a teacher code
    // minted here always carries grants_group_id. Class-scoped teacher codes
    // come from api/invite/create.ts instead, which derives the school from
    // the class. This test pins the guard so the path stays closed.
    verifyAdminResult = { userId: 'admin-1' }
    const res = makeRes()
    await handler(makeReq({ role: 'teacher', personal: { name: 'Supply Teacher', class_id: 'class-7' } as any }, '11111111-1111-4111-8111-111111111111'), res)
    expect(res.statusCode).toBe(400)
    expect(insertedRows.length).toBe(0)
  })

  it('personal mint mints NO code when provisioning fails', async () => {
    verifyAdminResult = { userId: 'admin-1' }
    provisionPersonaResult = { authUserId: '', email: '', learnerId: null, error: 'already been registered' }
    const res = makeRes()
    await handler(makeReq({ role: 'teacher', personal: { name: 'X', email: 'x@y.example' } }, '11111111-1111-4111-8111-111111111111'), res)
    expect(res.statusCode).toBe(409)
    expect(insertedRows.length).toBe(0)
  })
})

describe('GET /api/groups/:id/invites — school-node bridge (THE MODEL I2)', () => {
  it('surfaces a school node\'s codes that reference it by grants_school_id, not the node id', async () => {
    // The founder-reported bug: a school node (11111111-1111-4111-8111-111111111111) whose only demo codes
    // were minted against the SCHOOL row (school-1) before the node existed.
    verifyAdminResult = { userId: 'admin-1' }
    schoolsRows = [{ id: 'school-1', node_group_id: '11111111-1111-4111-8111-111111111111' }]
    codeRows = [
      { code: 'DEMO-T', code_type: 'teacher', grants_school_id: 'school-1', grants_group_id: null, is_active: true, max_uses: null, use_count: 0, expires_at: null, created_at: 't' },
      { code: 'ELSEWHERE', code_type: 'teacher', grants_school_id: 'other-school', grants_group_id: null, is_active: true, max_uses: null, use_count: 0, expires_at: null, created_at: 't' },
    ]
    const res = makeRes()
    await handler(makeGetReq('11111111-1111-4111-8111-111111111111'), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.links.map((l: any) => l.code)).toEqual(['DEMO-T'])
    expect(res.body.links[0]).toMatchObject({ role: 'teacher' })
  })

  it('a plain group node (no attached school) matches only grants_group_id', async () => {
    verifyAdminResult = { userId: 'admin-1' }
    schoolsRows = [] // 11111111-1111-4111-8111-111111111111 has no school row -> ownSchoolId null
    codeRows = [
      { code: 'LEADER', code_type: 'govt_admin', grants_group_id: '11111111-1111-4111-8111-111111111111', grants_school_id: null, is_active: true, max_uses: null, use_count: 0, expires_at: null, created_at: 't' },
      { code: 'STRAY', code_type: 'teacher', grants_school_id: 'some-school', grants_group_id: null, is_active: true, max_uses: null, use_count: 0, expires_at: null, created_at: 't' },
    ]
    const res = makeRes()
    await handler(makeGetReq('11111111-1111-4111-8111-111111111111'), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.links.map((l: any) => l.code)).toEqual(['LEADER'])
    expect(res.body.links[0]).toMatchObject({ role: 'leader' })
  })
})

describe('GET ?scope=subtree — the link ledger (founder scope-add 2026-07-20)', () => {
  function ledgerReq(groupId = '11111111-1111-4111-8111-111111111111'): VercelRequest {
    return { method: 'GET', query: { id: groupId, scope: 'subtree' }, headers: { authorization: 'Bearer tok' } } as any
  }

  beforeEach(() => {
    verifyAdminResult = { userId: 'admin-1' }
    subtreeGroupRows = [
      { id: '11111111-1111-4111-8111-111111111111', name: 'Root Programme' },
      { id: '22222222-2222-4222-8222-222222222222', name: 'Region A' },
    ]
    schoolsRows = [{ id: 'school-1', node_group_id: '22222222-2222-4222-8222-222222222222', school_name: 'School One', group_id: '22222222-2222-4222-8222-222222222222' }]
    classesRows = [{ id: 'class-1', class_name: 'Grade 6A', school_id: 'school-1' }]
  })

  it('lists links from the WHOLE subtree — node, descendant group, school, class — with status incl. revoked', async () => {
    codeRows = [
      { code: 'ROOT-L', code_type: 'govt_admin', grants_group_id: '11111111-1111-4111-8111-111111111111', is_active: true, max_uses: null, use_count: 2, expires_at: null, created_at: 't', created_by: 'u1', metadata: null },
      { code: 'SUB-T', code_type: 'teacher', grants_group_id: '22222222-2222-4222-8222-222222222222', is_active: true, max_uses: null, use_count: 0, expires_at: null, created_at: 't', created_by: 'u1', metadata: { personal_auth_user_id: 'p1', personal_name: 'IME Teacher' } },
      { code: 'SCH-A', code_type: 'school_admin_join', grants_school_id: 'school-1', is_active: false, max_uses: null, use_count: 1, expires_at: null, created_at: 't', created_by: 'u1', metadata: null },
      { code: 'CLS-S', code_type: 'student', grants_class_id: 'class-1', is_active: true, max_uses: 5, use_count: 5, expires_at: null, created_at: 't', created_by: 'u1', metadata: null },
    ]
    const res = makeRes()
    await handler(ledgerReq(), res)
    expect(res.statusCode).toBe(200)
    const byCode = Object.fromEntries(res.body.links.map((l: any) => [l.code, l]))
    expect(byCode['ROOT-L']).toMatchObject({ role: 'leader', species: 'shareable', status: 'active', where: { name: 'Root Programme', kind: 'group' } })
    expect(byCode['SUB-T']).toMatchObject({ role: 'teacher', species: 'personal', personalName: 'IME Teacher', where: { name: 'Region A' } })
    expect(byCode['SCH-A']).toMatchObject({ role: 'school_leader', status: 'revoked', where: { name: 'School One', kind: 'school' } })
    expect(byCode['CLS-S']).toMatchObject({ role: 'student', status: 'exhausted', uses: { count: 5, max: 5 }, where: { kind: 'class' } })
    expect(byCode['CLS-S'].where.name).toContain('Grade 6A')
  })

  // TENANCY-01 (fixed 2026-08-25): subtree membership is the parent_id
  // relation. A stranger's ROOT org — reachable in the old resolver because
  // `compute_group_path()` slugifies the NAME and nothing makes a slug unique,
  // so two same-named roots got EQUAL paths — is not in this ledger, and its
  // personal sign-in links never cross.
  it('never lists a same-named UNRELATED root org’s links (slug-path collision)', async () => {
    subtreeGroupRows = [{ id: '11111111-1111-4111-8111-111111111111', name: 'Deborah Testing' }]
    // A second root org (parent_id null, same slug) minted by someone else.
    codeRows = [
      { code: 'MINE', code_type: 'teacher', grants_group_id: '11111111-1111-4111-8111-111111111111', is_active: true, max_uses: null, use_count: 0, expires_at: null, created_at: 't', created_by: 'u1', metadata: null },
      { code: 'THEIRS', code_type: 'govt_admin', grants_group_id: '99999999-9999-4999-8999-999999999999', is_active: true, max_uses: null, use_count: 0, expires_at: null, created_at: 't', created_by: 'u2', metadata: { personal_auth_user_id: 'victim-1', personal_name: 'Deborah', personal_email: 'deborah@example.com' } },
    ]
    const res = makeRes()
    await handler(ledgerReq(), res)
    expect(res.statusCode).toBe(200)
    const codes = res.body.links.map((l: any) => l.code)
    expect(codes).toContain('MINE')
    expect(codes).not.toContain('THEIRS')
  })
})

describe('PATCH /api/groups/:id/invites — ledger verbs', () => {
  function patchReq(body: unknown, groupId = '11111111-1111-4111-8111-111111111111'): VercelRequest {
    return { method: 'PATCH', body, query: { id: groupId }, headers: { authorization: 'Bearer tok' } } as any
  }

  beforeEach(() => {
    verifyAdminResult = { userId: 'admin-1' }
    subtreeGroupRows = [{ id: '11111111-1111-4111-8111-111111111111', name: 'Root' }, { id: '22222222-2222-4222-8222-222222222222', name: 'Region A' }]
    schoolsRows = []
    classesRows = []
  })

  it('revoke flips is_active off for a subtree code', async () => {
    codeRows = [{ id: 'ic-1', code: 'SUB-T', code_type: 'teacher', grants_group_id: '22222222-2222-4222-8222-222222222222', is_active: true, metadata: null, max_uses: null, expires_at: null }]
    const res = makeRes()
    await handler(patchReq({ code: 'SUB-T', action: 'revoke' }), res)
    expect(res.statusCode).toBe(200)
    expect(updatedRows.some(([t, patch]) => t === 'invite_codes' && patch.is_active === false)).toBe(true)
  })

  it('refuses to touch a code whose grant target is OUTSIDE the subtree', async () => {
    codeRows = [{ id: 'ic-2', code: 'AWAY', code_type: 'teacher', grants_group_id: '99999999-9999-4999-8999-999999999999', is_active: true, metadata: null, max_uses: null, expires_at: null }]
    const res = makeRes()
    await handler(patchReq({ code: 'AWAY', action: 'revoke' }), res)
    expect(res.statusCode).toBe(404)
    expect(updatedRows.length).toBe(0)
  })

  it('rotate mints a NEW code with the SAME personal binding and revokes the old one', async () => {
    codeRows = [{ id: 'ic-3', code: 'PERS-1', code_type: 'teacher', grants_group_id: '22222222-2222-4222-8222-222222222222', grants_school_id: null, grants_class_id: null, is_active: true, max_uses: null, expires_at: null, metadata: { personal_auth_user_id: 'p9', personal_name: 'IME Teacher' } }]
    const res = makeRes()
    await handler(patchReq({ code: 'PERS-1', action: 'rotate' }), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.url).toContain('/redeem/')
    expect(insertedRows[0]).toMatchObject({
      code_type: 'teacher',
      grants_group_id: '22222222-2222-4222-8222-222222222222',
      metadata: { personal_auth_user_id: 'p9', personal_name: 'IME Teacher' },
    })
    expect(updatedRows.some(([t, patch]) => t === 'invite_codes' && patch.is_active === false)).toBe(true)
  })

  it('rotate re-sends the replacement link to the person on file', async () => {
    codeRows = [{ id: 'ic-3', code: 'PERS-1', code_type: 'teacher', grants_group_id: '22222222-2222-4222-8222-222222222222', grants_school_id: null, grants_class_id: null, is_active: true, max_uses: null, expires_at: null, metadata: { personal_auth_user_id: 'p9', personal_name: 'IME Teacher', personal_email: 'aran@example.com' } }]
    const res = makeRes()
    await handler(patchReq({ code: 'PERS-1', action: 'rotate' }), res)
    expect(res.statusCode).toBe(200)
    expect(sendInviteEmailCalls[0][0]).toBe('aran@example.com')
    expect(sendInviteEmailCalls[0][1]).toBe(res.body.url)
    expect(res.body.emailed).toMatchObject({ sent: true, to: 'aran@example.com' })
  })

  it('resend mails the SAME link again without minting a new code', async () => {
    codeRows = [{ id: 'ic-5', code: 'PERS-2', code_type: 'teacher', grants_group_id: '22222222-2222-4222-8222-222222222222', grants_school_id: null, grants_class_id: null, is_active: true, max_uses: null, expires_at: null, metadata: { personal_auth_user_id: 'p9', personal_name: 'IME Teacher', personal_email: 'aran@example.com' } }]
    const res = makeRes()
    await handler(patchReq({ code: 'PERS-2', action: 'resend' }), res)
    expect(res.statusCode).toBe(200)
    expect(insertedRows.length).toBe(0)
    expect(updatedRows.length).toBe(0)
    expect(sendInviteEmailCalls).toEqual([['aran@example.com', res.body.url]])
    expect(res.body.url).toContain('/redeem/PERS-2')
  })

  it('resend refuses a person with no address on file', async () => {
    codeRows = [{ id: 'ic-6', code: 'PERS-3', code_type: 'teacher', grants_group_id: '22222222-2222-4222-8222-222222222222', grants_school_id: null, grants_class_id: null, is_active: true, max_uses: null, expires_at: null, metadata: { personal_auth_user_id: 'p9', personal_name: 'No Email' } }]
    const res = makeRes()
    await handler(patchReq({ code: 'PERS-3', action: 'resend' }), res)
    expect(res.statusCode).toBe(400)
    expect(sendInviteEmailCalls.length).toBe(0)
  })

  it('a failed resend reports 502 and still hands back the link to share by hand', async () => {
    sendInviteEmailResult = { sent: false, error: 'rate limited' }
    codeRows = [{ id: 'ic-7', code: 'PERS-4', code_type: 'teacher', grants_group_id: '22222222-2222-4222-8222-222222222222', grants_school_id: null, grants_class_id: null, is_active: true, max_uses: null, expires_at: null, metadata: { personal_auth_user_id: 'p9', personal_name: 'IME Teacher', personal_email: 'aran@example.com' } }]
    const res = makeRes()
    await handler(patchReq({ code: 'PERS-4', action: 'resend' }), res)
    expect(res.statusCode).toBe(502)
    expect(res.body.url).toContain('/redeem/PERS-4')
  })

  it('rotate refuses a shareable (non-personal) link', async () => {
    codeRows = [{ id: 'ic-4', code: 'OPEN-1', code_type: 'teacher', grants_group_id: '22222222-2222-4222-8222-222222222222', is_active: true, metadata: null, max_uses: null, expires_at: null }]
    const res = makeRes()
    await handler(patchReq({ code: 'OPEN-1', action: 'rotate' }), res)
    expect(res.statusCode).toBe(400)
    expect(insertedRows.length).toBe(0)
  })
})
