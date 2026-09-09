/**
 * Tests for POST /api/school/named-seat — MECHANISM B of the school-belonging
 * design. The admin types a NAME and gets a code to hand over on their own
 * channel; the seat becomes a real, visible, removable person at their school
 * before anybody has arrived.
 *
 * The security-critical part is what the seat can reach: it is created HERE,
 * at the caller's own school, with the teacher role and nothing else, so a
 * school admin cannot mint their way up or sideways. That is asserted on the
 * rows actually written, not on a header comment.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-key'

let authResult: any
vi.mock('../_utils/auth', () => ({
  verifyAuthToken: vi.fn(async () => authResult),
}))

let ownedSchools: Record<string, string[]>
let schoolTags: Record<string, Array<{ tag_value: string; role_in_context: string }>>
let rateCount: number
let rateErr: any
let rateCalls: any[][]
let writes: Record<string, any[]>
let deletes: Record<string, any[]>
let insertErrs: Record<string, any>
let createUserArg: any
let createUserErr: any
let deletedUsers: string[]

function makeQueryBuilder(table: string) {
  const calls: any[] = []
  const builder: any = {}
  for (const m of ['select', 'eq', 'in', 'is', 'gte', 'gt', 'order', 'limit', 'contains', 'update']) {
    builder[m] = (...args: any[]) => { calls.push([m, ...args]); return builder }
  }
  const eqVal = (col: string) => calls.find((c) => c[0] === 'eq' && c[1] === col)?.[2]

  builder.maybeSingle = () => {
    if (table === 'learners') return Promise.resolve({ data: { id: 'seat-learner-1' }, error: null })
    return Promise.resolve({ data: null, error: null })
  }

  builder.delete = (...args: any[]) => { calls.push(['delete', ...args]); return builder }

  builder.then = (resolve: any, reject: any) => {
    const isDelete = calls.some((c) => c[0] === 'delete')
    if (isDelete) {
      deletes[table] = deletes[table] || []
      deletes[table].push(calls)
      return Promise.resolve({ error: null }).then(resolve, reject)
    }
    if (table === 'schools') {
      const ids = ownedSchools[eqVal('admin_user_id') as string] || []
      return Promise.resolve({ data: ids.map((id) => ({ id })), error: null }).then(resolve, reject)
    }
    if (table === 'user_tags') {
      const rows = schoolTags[eqVal('user_id') as string] || []
      const roleFilter = calls.find((c) => c[0] === 'in' && c[1] === 'role_in_context')
      const allowed = roleFilter ? (roleFilter[2] as string[]) : null
      return Promise.resolve({ data: allowed ? rows.filter((r) => allowed.includes(r.role_in_context)) : rows, error: null }).then(resolve, reject)
    }
    if (table === 'player_events') {
      rateCalls.push(calls)
      return Promise.resolve({ count: rateCount, error: rateErr }).then(resolve, reject)
    }
    return Promise.resolve({ data: null, error: null }).then(resolve, reject)
  }

  builder.insert = (obj: any) => {
    writes[table] = writes[table] || []
    writes[table].push(obj)
    return Promise.resolve({ error: insertErrs[table] ?? null })
  }
  return builder
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => makeQueryBuilder(table),
    auth: {
      admin: {
        createUser: (arg: any) => {
          createUserArg = arg
          return Promise.resolve(createUserErr ? { data: null, error: createUserErr } : { data: { user: { id: 'seat-uid-1' } }, error: null })
        },
        deleteUser: (id: string) => { deletedUsers.push(id); return Promise.resolve({ error: null }) },
      },
    },
  }),
}))

let handler: typeof import('./named-seat').default

const makeReq = (method: string, body?: any): VercelRequest =>
  ({ method, headers: { authorization: 'Bearer tok', host: 'staging.saysomethingin.app' }, body }) as any

function makeRes(): VercelResponse & { statusCode?: number; body?: any } {
  const res: any = {}
  res.setHeader = vi.fn()
  res.status = vi.fn((code: number) => { res.statusCode = code; return res })
  res.json = vi.fn((body: any) => { res.body = body; return res })
  return res
}

beforeEach(async () => {
  authResult = { valid: true, userId: 'admin-1' }
  ownedSchools = { 'admin-1': ['school-1'] }
  schoolTags = {}
  rateCount = 0
  rateErr = null
  rateCalls = []
  writes = {}
  deletes = {}
  insertErrs = {}
  createUserArg = undefined
  createUserErr = null
  deletedUsers = []
  handler = (await import('./named-seat')).default
})

describe('POST /api/school/named-seat', () => {
  it('rejects a non-POST method', async () => {
    const res = makeRes()
    await handler(makeReq('GET'), res)
    expect(res.statusCode).toBe(405)
  })

  it('rejects an unauthenticated caller', async () => {
    authResult = { valid: false, error: 'Unauthorized' }
    const res = makeRes()
    await handler(makeReq('POST', { name: 'Sian Jones' }), res)
    expect(res.statusCode).toBe(401)
  })

  it('refuses a caller who is not a school admin — writes nothing', async () => {
    ownedSchools = {}
    const res = makeRes()
    await handler(makeReq('POST', { name: 'Sian Jones' }), res)
    expect(res.statusCode).toBe(403)
    expect(writes.learners).toBeUndefined()
    expect(createUserArg).toBeUndefined()
  })

  it('requires a name, and never asks for an address', async () => {
    const res = makeRes()
    await handler(makeReq('POST', { name: '   ' }), res)
    expect(res.statusCode).toBe(400)
    expect(createUserArg).toBeUndefined()
  })

  it('mints a code for the named seat and hands back both the code and a short join url', async () => {
    const res = makeRes()
    await handler(makeReq('POST', { name: 'Sian Jones' }), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.name).toBe('Sian Jones')
    expect(res.body.access_code).toMatch(/^[2-9A-HJKMNP-TV-Z]{4}-[2-9A-HJKMNP-TV-Z]{4}$/)
    expect(res.body.join_url).toContain('/join/')
    // Hash only. The code itself never reaches the database.
    const codeRow = writes.staff_access_codes?.[0]
    expect(codeRow.code_hash).toMatch(/^[a-f0-9]{64}$/)
    expect(JSON.stringify(codeRow)).not.toContain(res.body.access_code.replace('-', ''))
    expect(codeRow.target_user_id).toBe('seat-uid-1')
    expect(codeRow.school_id).toBe('school-1')
    expect(codeRow.created_by).toBe('admin-1')
  })

  it('the seat is a real person at the school, carrying the typed name and the teacher role', async () => {
    const res = makeRes()
    await handler(makeReq('POST', { name: '  Sian   Jones  ' }), res)
    expect(res.statusCode).toBe(200)
    expect(writes.learners[0]).toMatchObject({
      user_id: 'seat-uid-1', display_name: 'Sian Jones', educational_role: 'teacher', needs_verification: true,
    })
    expect(writes.user_tags[0]).toMatchObject({
      user_id: 'seat-uid-1', tag_type: 'school', tag_value: 'SCHOOL:school-1',
      role_in_context: 'teacher', added_by: 'admin-1',
    })
  })

  it("CONTAINMENT: the seat gets no platform role and no second school — there is nothing for it to reach", async () => {
    const res = makeRes()
    await handler(makeReq('POST', { name: 'Sian Jones' }), res)
    expect(res.statusCode).toBe(200)
    expect(writes.learners[0].platform_role).toBeUndefined()
    expect(writes.user_tags).toHaveLength(1)
    expect(writes.user_tags[0].tag_value).toBe('SCHOOL:school-1')
    // The school is resolved from the caller's identity, never from the body.
    const spoofed = makeRes()
    await handler(makeReq('POST', { name: 'Someone Else', school_id: 'school-999' }), spoofed)
    expect(writes.user_tags[1].tag_value).toBe('SCHOOL:school-1')
  })

  it('the seat never gets a real mailbox — the placeholder address is not a school address', async () => {
    const res = makeRes()
    await handler(makeReq('POST', { name: 'Sian Jones' }), res)
    expect(createUserArg.email).toMatch(/^link-[0-9a-f-]{36}@invite\.saysomethingin\.app$/)
    expect(createUserArg.email_confirm).toBe(false)
    // Who named it is service-role-only — user_metadata is writable by the account.
    expect(createUserArg.app_metadata.named_seat).toMatchObject({ school_id: 'school-1', named_by: 'admin-1' })
    expect(createUserArg.user_metadata.display_name).toBe('Sian Jones')
    expect(createUserArg.user_metadata.named_seat).toBeUndefined()
  })

  it('FAILS CLOSED on an unreadable audit table — refuses rather than minting unbounded credentials', async () => {
    rateErr = { message: 'boom' }
    const res = makeRes()
    await handler(makeReq('POST', { name: 'Sian Jones' }), res)
    expect(res.statusCode).toBe(503)
    expect(createUserArg).toBeUndefined()
  })

  it('rate-limits per caller, counting staff sign-in codes and named seats in ONE bucket', async () => {
    rateCount = 10
    const res = makeRes()
    await handler(makeReq('POST', { name: 'Sian Jones' }), res)
    expect(res.statusCode).toBe(429)
    expect(createUserArg).toBeUndefined()
    const evFilter = rateCalls[0].find((c: any[]) => c[0] === 'in' && c[1] === 'event_type')
    expect(evFilter[2]).toEqual(expect.arrayContaining(['school_signin_link_minted', 'school_named_seat_minted']))
  })

  it('leaves NOTHING behind when the code cannot be written — no half-made seat on the roster', async () => {
    insertErrs.staff_access_codes = { message: 'insert failed' }
    const res = makeRes()
    await handler(makeReq('POST', { name: 'Sian Jones' }), res)
    expect(res.statusCode).toBe(500)
    expect(deletedUsers).toContain('seat-uid-1')
    expect(deletes.learners).toBeTruthy()
    expect(deletes.user_tags).toBeTruthy()
  })

  it('audits the mint with actor, target and school', async () => {
    const res = makeRes()
    await handler(makeReq('POST', { name: 'Sian Jones' }), res)
    const ev = writes.player_events?.[0]
    expect(ev.event_type).toBe('school_named_seat_minted')
    expect(ev.payload).toMatchObject({ actor_user_id: 'admin-1', target_user_id: 'seat-uid-1', school_id: 'school-1', name: 'Sian Jones' })
    // The code itself is never audited.
    expect(JSON.stringify(ev)).not.toContain(res.body.access_code.replace('-', ''))
  })
})
