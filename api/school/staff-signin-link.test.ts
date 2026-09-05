/**
 * Tests for POST /api/school/staff-signin-link — a school admin minting a
 * short ACCESS CODE for their own staff when the OTP email never arrives (Hwb
 * mail-gateway rescue). The containment checks are the security-critical
 * part: a school admin must never mint their way into a bigger role or
 * another school.
 *
 * Since 2026-09-02 what is minted is an 8-character code (Tom's ruling: the
 * hand-over is out of band, so the artefact has to be typeable), NOT a
 * Supabase action_link. "Did we mint?" is therefore asserted on rows written
 * to staff_access_codes rather than on generateLink calls.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-key'

let authResult: any
vi.mock('../_utils/auth', () => ({
  verifyAuthToken: vi.fn(async () => authResult),
}))

// School membership is modelled per user in BOTH spellings, because that is
// the whole point of the fix: `schools.admin_user_id` (the founding-admin
// pointer) and active `user_tags` SCHOOL: rows are one question, and the caller
// and the target must be asked it the same way.
let ownedSchools: Record<string, string[]>
let schoolTags: Record<string, Array<{ tag_value: string; role_in_context: string }>>
let targetLearnerRow: any
let rateCount: number
let rateErr: any
let insertedEvents: any[]
let getUserByIdResult: any
let getUserByIdArg: string | undefined
let codeInserts: any[]
let codeInsertErr: any
let supersedeCalls: any[][]
let supersedeErr: any

function makeQueryBuilder(table: string) {
  const calls: any[] = []
  const builder: any = {}
  for (const m of ['select', 'eq', 'in', 'is', 'gte', 'gt', 'order', 'limit', 'contains', 'update']) {
    builder[m] = (...args: any[]) => {
      calls.push([m, ...args])
      return builder
    }
  }

  function eqVal(col: string) {
    const c = calls.find((c) => c[0] === 'eq' && c[1] === col)
    return c ? c[2] : undefined
  }

  builder.maybeSingle = () => {
    if (table === 'learners') {
      return Promise.resolve({ data: targetLearnerRow, error: null })
    }
    return Promise.resolve({ data: null, error: null })
  }

  // Queries awaited without a terminal .maybeSingle()/.single() resolve
  // through the thenable builder itself.
  builder.then = (resolve: any, reject: any) => {
    if (table === 'staff_access_codes') {
      // The only awaited-without-terminal query on this table is the
      // supersede UPDATE that kills any earlier live code for the target.
      supersedeCalls.push(calls)
      return Promise.resolve({ error: supersedeErr }).then(resolve, reject)
    }
    if (table === 'schools') {
      // schoolMembershipsOf spelling 1: every school this uid founded.
      const uid = eqVal('admin_user_id') as string
      const ids = ownedSchools[uid] || []
      return Promise.resolve({ data: ids.map((id) => ({ id })), error: null }).then(resolve, reject)
    }
    if (table === 'user_tags') {
      // schoolMembershipsOf spelling 2: active SCHOOL: staff tags.
      const uid = eqVal('user_id') as string
      return Promise.resolve({ data: schoolTags[uid] || [], error: null }).then(resolve, reject)
    }
    if (table === 'player_events') {
      return Promise.resolve({ count: rateCount, error: rateErr }).then(resolve, reject)
    }
    return Promise.resolve({ data: null, error: null }).then(resolve, reject)
  }

  builder.insert = (obj: any) => {
    if (table === 'staff_access_codes') {
      codeInserts.push(obj)
      return Promise.resolve({ error: codeInsertErr })
    }
    insertedEvents.push(obj)
    return Promise.resolve({ error: null })
  }

  return builder
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => makeQueryBuilder(table),
    auth: {
      admin: {
        getUserById: (id: string) => {
          getUserByIdArg = id
          return Promise.resolve(getUserByIdResult)
        },
      },
    },
  }),
}))

let handler: typeof import('./staff-signin-link').default

function makeReq(method: string, body?: any): VercelRequest {
  return {
    method,
    headers: { authorization: 'Bearer tok', host: 'staging.saysomethingin.app' },
    body,
  } as any
}

function makeRes(): VercelResponse & { statusCode?: number; body?: any } {
  const res: any = {}
  res.status = vi.fn((code: number) => { res.statusCode = code; return res })
  res.json = vi.fn((body: any) => { res.body = body; return res })
  return res
}

beforeEach(async () => {
  authResult = { valid: true, userId: 'admin-1' }
  ownedSchools = { 'admin-1': ['school-1'] }
  schoolTags = { 'target-1': [{ tag_value: 'SCHOOL:school-1', role_in_context: 'teacher' }] }
  targetLearnerRow = { id: 'learner-target-1', user_id: 'target-1', display_name: 'Target Teacher', educational_role: null, platform_role: null }
  rateCount = 0
  rateErr = null
  insertedEvents = []
  getUserByIdResult = { data: { user: { id: 'target-1', email: 'target@school.example' } }, error: null }
  getUserByIdArg = undefined
  codeInserts = []
  codeInsertErr = null
  supersedeCalls = []
  supersedeErr = null
  handler = (await import('./staff-signin-link')).default
})

describe('POST /api/school/staff-signin-link', () => {
  it('rejects a non-POST method', async () => {
    const res = makeRes()
    await handler(makeReq('GET'), res)
    expect(res.statusCode).toBe(405)
  })

  it('401s with no/invalid bearer token', async () => {
    authResult = { valid: false, error: 'Missing or invalid Authorization header' }
    const res = makeRes()
    await handler(makeReq('POST', { target_user_id: 'target-1' }), res)
    expect(res.statusCode).toBe(401)
  })

  it('401s when the token verifies but carries no userId', async () => {
    authResult = { valid: true, userId: undefined }
    const res = makeRes()
    await handler(makeReq('POST', { target_user_id: 'target-1' }), res)
    expect(res.statusCode).toBe(401)
  })

  it('400s with no target_user_id', async () => {
    const res = makeRes()
    await handler(makeReq('POST', {}), res)
    expect(res.statusCode).toBe(400)
  })

  it('403s when the caller is not a school admin (neither schools.admin_user_id nor a school-admin tag)', async () => {
    ownedSchools = {}
    const res = makeRes()
    await handler(makeReq('POST', { target_user_id: 'target-1' }), res)
    expect(res.statusCode).toBe(403)
    expect(codeInserts).toHaveLength(0)
  })

  it('resolves caller adminship via a school-admin user_tags row when schools.admin_user_id is not set', async () => {
    ownedSchools = {}
    schoolTags['admin-1'] = [{ tag_value: 'SCHOOL:school-1', role_in_context: 'admin' }]
    const res = makeRes()
    await handler(makeReq('POST', { target_user_id: 'target-1' }), res)
    expect(res.statusCode).toBe(200)
  })

  it('404s when the target holds no active teacher/admin tag at the caller\'s school', async () => {
    schoolTags['target-1'] = []
    const res = makeRes()
    await handler(makeReq('POST', { target_user_id: 'target-1' }), res)
    expect(res.statusCode).toBe(404)
    expect(codeInserts).toHaveLength(0)
  })

  it('403 CONTAINMENT: refuses a target whose educational_role is govt_admin', async () => {
    targetLearnerRow = { ...targetLearnerRow, educational_role: 'govt_admin' }
    const res = makeRes()
    await handler(makeReq('POST', { target_user_id: 'target-1' }), res)
    expect(res.statusCode).toBe(403)
    expect(codeInserts).toHaveLength(0)
  })

  it.each(['ssi_admin', 'god'])('403 CONTAINMENT: refuses a target whose platform_role is %s', async (platformRole) => {
    targetLearnerRow = { ...targetLearnerRow, platform_role: platformRole }
    const res = makeRes()
    await handler(makeReq('POST', { target_user_id: 'target-1' }), res)
    expect(res.statusCode).toBe(403)
    expect(codeInserts).toHaveLength(0)
  })

  it('403 CONTAINMENT: refuses a target who also holds an active school tag for a DIFFERENT school', async () => {
    schoolTags['target-1'] = [
      { tag_value: 'SCHOOL:school-1', role_in_context: 'teacher' },
      { tag_value: 'SCHOOL:school-2', role_in_context: 'teacher' },
    ]
    const res = makeRes()
    await handler(makeReq('POST', { target_user_id: 'target-1' }), res)
    expect(res.statusCode).toBe(403)
    expect(codeInserts).toHaveLength(0)
  })

  it('429s when the caller has already minted PER_CALLER_LIMIT links in the window', async () => {
    rateCount = 10
    const res = makeRes()
    await handler(makeReq('POST', { target_user_id: 'target-1' }), res)
    expect(res.statusCode).toBe(429)
    expect(codeInserts).toHaveLength(0)
  })

  it('503s when the rate-limit query itself errors, and fails CLOSED (does not mint)', async () => {
    rateErr = { message: 'connection reset' }
    const res = makeRes()
    await handler(makeReq('POST', { target_user_id: 'target-1' }), res)
    expect(res.statusCode).toBe(503)
    expect(codeInserts).toHaveLength(0)
  })

  it('returns 200 with a typeable access code, a /join URL and an expiry, and audits the mint', async () => {
    const res = makeRes()
    await handler(makeReq('POST', { target_user_id: 'target-1' }), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.success).toBe(true)
    // ABCD-EFGH: the whole point is that a person can read this down a phone.
    expect(res.body.access_code).toMatch(/^[2-9A-HJ-NP-TV-Z]{4}-[2-9A-HJ-NP-TV-Z]{4}$/)
    expect(res.body.join_url).toBe(`https://staging.saysomethingin.app/join/${res.body.access_code}`)
    expect(new Date(res.body.expires_at).getTime()).toBeGreaterThan(Date.now())
    expect(res.body.email).toBe('target@school.example')
    // The code itself never reaches the database — only its hash.
    expect(codeInserts).toHaveLength(1)
    expect(codeInserts[0].code_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(JSON.stringify(codeInserts[0])).not.toContain(res.body.access_code.replace('-', ''))
    expect(codeInserts[0]).toMatchObject({
      target_user_id: 'target-1',
      school_id: 'school-1',
      created_by: 'admin-1',
    })
    expect(getUserByIdArg).toBe('target-1')
    expect(insertedEvents).toHaveLength(1)
    expect(insertedEvents[0]).toMatchObject({
      event_type: 'school_signin_link_minted',
      payload: { actor_user_id: 'admin-1', target_user_id: 'target-1', school_id: 'school-1', self: false },
    })
  })

  it('kills any earlier live code for the same person before minting a new one', async () => {
    const res = makeRes()
    await handler(makeReq('POST', { target_user_id: 'target-1' }), res)
    expect(res.statusCode).toBe(200)
    // Reissue must mean the OLD one stops working, or every reissue leaves
    // another live credential loose in a shared inbox.
    expect(supersedeCalls).toHaveLength(1)
    const flat = JSON.stringify(supersedeCalls[0])
    expect(flat).toContain('target_user_id')
    expect(flat).toContain('redeemed_at')
  })

  it('503s and mints NOTHING when the supersede write fails', async () => {
    supersedeErr = { message: 'connection reset' }
    const res = makeRes()
    await handler(makeReq('POST', { target_user_id: 'target-1' }), res)
    expect(res.statusCode).toBe(503)
    expect(codeInserts).toHaveLength(0)
  })

  it('500s when the code row cannot be written — no code is handed back', async () => {
    codeInsertErr = { message: 'unique violation' }
    const res = makeRes()
    await handler(makeReq('POST', { target_user_id: 'target-1' }), res)
    expect(res.statusCode).toBe(500)
    expect(res.body.access_code).toBeUndefined()
  })

  it('two mints in a row produce different codes', async () => {
    const a = makeRes()
    await handler(makeReq('POST', { target_user_id: 'target-1' }), a)
    const b = makeRes()
    await handler(makeReq('POST', { target_user_id: 'target-1' }), b)
    expect(a.body.access_code).not.toBe(b.body.access_code)
  })

  it('self-service: target_user_id === caller id skips the staff-tag lookup and still mints', async () => {
    getUserByIdResult = { data: { user: { id: 'admin-1', email: 'admin@school.example' } }, error: null }
    const res = makeRes()
    await handler(makeReq('POST', { target_user_id: 'admin-1' }), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.email).toBe('admin@school.example')
    expect(insertedEvents[0]).toMatchObject({ payload: { self: true } })
  })

  it('404s when the target account has no sign-in address on file', async () => {
    getUserByIdResult = { data: { user: { id: 'target-1', email: null } }, error: null }
    const res = makeRes()
    await handler(makeReq('POST', { target_user_id: 'target-1' }), res)
    expect(res.statusCode).toBe(404)
  })

  // --- CROSS-SCHOOL REACH via the untagged founding admin (SEC 2026-09-05) ---
  // The same two-spellings-of-identity bug as Chepstow, 2026-08-06. The caller's
  // own school was resolved through BOTH spellings (schools.admin_user_id OR a
  // SCHOOL: tag); the target's reach beyond that school was resolved through
  // user_tags ALONE. A person who FOUNDED another school holds the pointer and,
  // if nothing ever tagged them, no tag — so they read as "belongs nowhere
  // else", and a school admin at school-1 could mint a live session as the
  // person who runs school-2.
  //
  // These two tests FAIL against the pre-fix code: with the target resolved from
  // user_tags only, both mint (200, an access code, a staff_access_codes row).
  describe('cross-school containment regression', () => {
    it('403s: the target ALSO founds another school via schools.admin_user_id and carries no tag for it', async () => {
      ownedSchools = { 'admin-1': ['school-1'], 'target-1': ['school-2'] }
      schoolTags['target-1'] = [{ tag_value: 'SCHOOL:school-1', role_in_context: 'teacher' }]
      const res = makeRes()
      await handler(makeReq('POST', { target_user_id: 'target-1' }), res)
      expect(res.statusCode).toBe(403)
      expect(codeInserts).toHaveLength(0)
      expect(res.body.access_code).toBeUndefined()
    })

    it('404s: a target who founds ONLY another school is not a member of the caller\'s school at all', async () => {
      ownedSchools = { 'admin-1': ['school-1'], 'target-1': ['school-2'] }
      schoolTags['target-1'] = []
      const res = makeRes()
      await handler(makeReq('POST', { target_user_id: 'target-1' }), res)
      expect(res.statusCode).toBe(404)
      expect(codeInserts).toHaveLength(0)
    })

    it('200: a target who FOUNDED the caller\'s own school and was never tagged is now recognised as staff', async () => {
      // The other half of the one-resolver fix — the Chepstow parity direction.
      ownedSchools = { 'admin-1': ['school-1'], 'target-1': ['school-1'] }
      schoolTags['target-1'] = []
      const res = makeRes()
      await handler(makeReq('POST', { target_user_id: 'target-1' }), res)
      expect(res.statusCode).toBe(200)
      expect(codeInserts).toHaveLength(1)
    })
  })
})
