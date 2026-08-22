/**
 * Tests for GET / POST /api/teacher/classes.
 *
 * A-74 (co-teaching) adds two behaviours here:
 *   - GET unions the CO-TAUGHT classes (the class_teachers relationship in
 *     user_tags) into the personal list. classes.teacher_user_id is only the
 *     demoted lead pointer, so without the union a co-teacher's own dashboard
 *     is silently empty.
 *   - POST DUAL-WRITES the CLASS:<id>/teacher tag alongside the lead pointer.
 *     Pointer-only creation is how 47 of 62 live classes ended up needing a
 *     backfill; a tag-write failure must surface, never be swallowed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-key'

let authResult: { valid: boolean; userId?: string; error?: string }
vi.mock('../_utils/auth', () => ({
  verifyAuthToken: vi.fn(async () => authResult),
}))

vi.mock('../_utils/classLearnerEntity', () => ({
  ensureClassLearnerEntity: vi.fn(async () => ({ learnerId: 'class-learner-1' })),
}))

let DB: Record<string, any[]>
/** Per-table write failure injection, keyed 'table:op'. */
let failWrites: Record<string, string>
let nextId = 0
/** Per-table insert-id counters, so ids don't shift when other tables are written. */
let tableIds: Record<string, number> = {}

function makeChainable(table: string) {
  const filters: Array<(r: any) => boolean> = []
  let op: 'select' | 'update' | 'insert' = 'select'
  let payload: any = null
  let wantCount = false
  let headOnly = false
  let returning: any[] | null = null

  const rows = () => (DB[table] ?? []).filter((r: any) => filters.every((f) => f(r)))

  const runWrite = () => {
    const fail = failWrites[`${table}:${op}`]
    if (fail) return { data: null, error: { message: fail } }
    if (op === 'insert') {
      const list = Array.isArray(payload) ? payload : [payload]
      const made = list.map((r) => ({
        // PER-TABLE counter: a shared one made generated ids depend on how
        // many OTHER tables the handler wrote first (the mint-attempt audit
        // row shifted every class id by one).
        id: `${table}-${(tableIds[table] = (tableIds[table] ?? 0) + 1)}`,
        removed_at: null,
        created_at: new Date().toISOString(), // mirrors the DB default
        ...r,
      }))
      DB[table] = [...(DB[table] ?? []), ...made]
      returning = made
      return { data: made, error: null }
    }
    const hit = rows()
    for (const r of hit) Object.assign(r, payload)
    returning = hit
    return { data: hit, error: null }
  }

  const builder: any = {
    select: (_cols?: string, opts?: any) => {
      if (opts?.count) wantCount = true
      if (opts?.head) headOnly = true
      return builder
    },
    insert: (v: any) => { op = 'insert'; payload = v; return builder },
    update: (v: any) => { op = 'update'; payload = v; return builder },
    eq: (col: string, val: unknown) => { filters.push((r) => r[col] === val); return builder },
    neq: (col: string, val: unknown) => { filters.push((r) => r[col] !== val); return builder },
    gte: (col: string, val: unknown) => { filters.push((r) => String(r[col] ?? '') >= String(val)); return builder },
    in: (col: string, vals: unknown[]) => { filters.push((r) => vals.includes(r[col])); return builder },
    is: (col: string) => { filters.push((r) => r[col] == null); return builder },
    order: () => builder,
    limit: () => builder,
    single: async () => {
      if (op !== 'select') {
        const w = runWrite()
        if (w.error) return { data: null, error: w.error }
        return { data: returning![0] ?? null, error: null }
      }
      const r = rows()[0]
      return r ? { data: r, error: null } : { data: null, error: { message: 'not found' } }
    },
    maybeSingle: async () => {
      if (op !== 'select') return runWrite()
      return { data: rows()[0] ?? null, error: null }
    },
    then: (resolve: any) => {
      let result: any
      if (op !== 'select') {
        result = runWrite()
      } else {
        const readFail = failWrites[`${table}:read`]
        if (readFail) result = { data: null, count: null, error: { message: readFail } }
        else if (wantCount) result = { data: headOnly ? null : rows(), count: rows().length, error: null }
        else result = { data: rows(), error: null }
      }
      return Promise.resolve(result).then(resolve)
    },
  }
  return builder
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: (table: string) => makeChainable(table) }),
}))

function makeReq(method: 'GET' | 'POST', body: any = {}): VercelRequest {
  return { method, body, headers: { authorization: 'Bearer tok' }, query: {} } as any
}

function makeRes(): VercelResponse & { statusCode?: number; body?: any } {
  const res: any = {}
  res.status = vi.fn((code: number) => { res.statusCode = code; return res })
  res.json = vi.fn((body: any) => { res.body = body; return res })
  return res
}

function cls(over: Partial<Record<string, any>> = {}) {
  return {
    id: `class-${++nextId}`,
    class_name: 'A class',
    course_code: 'cym_for_eng',
    student_join_code: 'ABC-123',
    current_seed: 1,
    class_learner_id: null,
    teacher_user_id: 'teacher-1',
    school_id: null,
    is_active: true,
    created_at: '2026-01-01T00:00:00.000Z',
    ...over,
  }
}

function classTag(userId: string, classId: string, removedAt: string | null = null) {
  return {
    id: `tag-${++nextId}`,
    user_id: userId,
    tag_type: 'class',
    tag_value: `CLASS:${classId}`,
    role_in_context: 'teacher',
    removed_at: removedAt,
  }
}

let handler: typeof import('./classes').default

beforeEach(async () => {
  vi.resetModules()
  nextId = 0
  tableIds = {}
  failWrites = {}
  handler = (await import('./classes')).default
  authResult = { valid: true, userId: 'teacher-1' }
  DB = {
    learners: [{ id: 'learner-1', user_id: 'teacher-1' }],
    teachers: [{ id: 'teacher-row-1', learner_id: 'learner-1', platform_status: null, platform_expires_at: null }],
    classes: [],
    user_tags: [],
    subscriptions: [],
    possession_mint_attempts: [],
  }
})

/** A windowed mint-attempt row for this teacher, as the throttle counts them. */
function mintAttempt(over: Partial<Record<string, any>> = {}) {
  return {
    id: `pma-${++nextId}`,
    invite_code_id: null,
    ip_hash: 'deadbeefdeadbeef',
    auth_user_id: 'teacher-1',
    outcome: 'class_mint_attempt',
    created_at: new Date().toISOString(),
    ...over,
  }
}

describe('GET /api/teacher/classes', () => {
  it('lists the classes the teacher LEADS', async () => {
    DB.classes = [cls({ id: 'mine-1' })]
    const res = makeRes()
    await handler(makeReq('GET'), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.classes.map((c: any) => c.id)).toEqual(['mine-1'])
  })

  it('UNIONS the co-taught classes (A-74) — the whole point of the fix', async () => {
    DB.classes = [
      cls({ id: 'mine-1' }),
      cls({ id: 'theirs-1', teacher_user_id: 'someone-else' }),
    ]
    DB.user_tags = [classTag('teacher-1', 'theirs-1')]
    const res = makeRes()
    await handler(makeReq('GET'), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.classes.map((c: any) => c.id).sort()).toEqual(['mine-1', 'theirs-1'])
  })

  it('returns the co-taught class even when the teacher leads nothing', async () => {
    DB.classes = [cls({ id: 'theirs-1', teacher_user_id: 'someone-else' })]
    DB.user_tags = [classTag('teacher-1', 'theirs-1')]
    const res = makeRes()
    await handler(makeReq('GET'), res)
    expect(res.body.classes.map((c: any) => c.id)).toEqual(['theirs-1'])
  })

  it('does not duplicate a class the teacher both leads and is tagged on', async () => {
    DB.classes = [cls({ id: 'mine-1' })]
    DB.user_tags = [classTag('teacher-1', 'mine-1')]
    const res = makeRes()
    await handler(makeReq('GET'), res)
    expect(res.body.classes.map((c: any) => c.id)).toEqual(['mine-1'])
  })

  it('ignores a soft-REMOVED co-teacher tag', async () => {
    DB.classes = [cls({ id: 'theirs-1', teacher_user_id: 'someone-else' })]
    DB.user_tags = [classTag('teacher-1', 'theirs-1', '2026-02-01T00:00:00.000Z')]
    const res = makeRes()
    await handler(makeReq('GET'), res)
    expect(res.body.classes).toEqual([])
  })

  it('keeps SCHOOL classes out of the personal surface even when co-taught', async () => {
    DB.classes = [cls({ id: 'school-class', teacher_user_id: 'someone-else', school_id: 'school-1' })]
    DB.user_tags = [classTag('teacher-1', 'school-class')]
    const res = makeRes()
    await handler(makeReq('GET'), res)
    expect(res.body.classes).toEqual([])
  })

  it('excludes an inactive co-taught class', async () => {
    DB.classes = [cls({ id: 'theirs-1', teacher_user_id: 'someone-else', is_active: false })]
    DB.user_tags = [classTag('teacher-1', 'theirs-1')]
    const res = makeRes()
    await handler(makeReq('GET'), res)
    expect(res.body.classes).toEqual([])
  })

  it('500s rather than silently dropping co-taught classes when the tag read fails', async () => {
    failWrites['user_tags:read'] = 'boom'
    DB.classes = [cls({ id: 'mine-1' })]
    const res = makeRes()
    await handler(makeReq('GET'), res)
    expect(res.statusCode).toBe(500)
  })

  it('404s for a non-teacher', async () => {
    DB.teachers = []
    const res = makeRes()
    await handler(makeReq('GET'), res)
    expect(res.statusCode).toBe(404)
  })

  it('401s without a valid token', async () => {
    authResult = { valid: false, error: 'no token' }
    const res = makeRes()
    await handler(makeReq('GET'), res)
    expect(res.statusCode).toBe(401)
  })
})

describe('POST /api/teacher/classes', () => {
  const body = { class_name: 'New class', course_code: 'cym_for_eng' }

  it('creates the class AND dual-writes the teacher tag (A-74)', async () => {
    const res = makeRes()
    await handler(makeReq('POST', body), res)
    expect(res.statusCode).toBe(201)
    const created = res.body.class
    expect(created.teacher_user_id).toBe('teacher-1')
    expect(DB.user_tags).toHaveLength(1)
    expect(DB.user_tags[0]).toMatchObject({
      user_id: 'teacher-1',
      tag_type: 'class',
      tag_value: `CLASS:${created.id}`,
      role_in_context: 'teacher',
      removed_at: null,
    })
  })

  it('500s (no false success) when the teacher-tag write fails', async () => {
    failWrites['user_tags:insert'] = 'boom'
    const res = makeRes()
    await handler(makeReq('POST', body), res)
    expect(res.statusCode).toBe(500)
    expect(String(res.body.error)).toMatch(/teacher record failed/i)
  })

  it('reactivates a soft-removed tag rather than inserting a duplicate', async () => {
    // The class id is deterministic in this mock: classes-1 for the first insert.
    DB.user_tags = [
      {
        id: 'old-tag',
        user_id: 'teacher-1',
        tag_type: 'class',
        tag_value: 'CLASS:classes-1',
        role_in_context: 'teacher',
        removed_at: '2026-02-01T00:00:00.000Z',
      },
    ]
    const res = makeRes()
    await handler(makeReq('POST', body), res)
    expect(res.statusCode).toBe(201)
    expect(res.body.class.id).toBe('classes-1')
    expect(DB.user_tags).toHaveLength(1)
    expect(DB.user_tags[0].removed_at).toBeNull()
  })

  it('400s without class_name', async () => {
    const res = makeRes()
    await handler(makeReq('POST', { course_code: 'cym_for_eng' }), res)
    expect(res.statusCode).toBe(400)
  })

  it('400s without course_code', async () => {
    const res = makeRes()
    await handler(makeReq('POST', { class_name: 'x' }), res)
    expect(res.statusCode).toBe(400)
  })

  it('409s at the 10-class cap', async () => {
    DB.classes = Array.from({ length: 10 }, (_, i) => cls({ id: `mine-${i}` }))
    const res = makeRes()
    await handler(makeReq('POST', body), res)
    expect(res.statusCode).toBe(409)
  })

  it('CO-TAUGHT classes do not inflate the cap (S5) — only the ones you lead', async () => {
    DB.classes = [
      ...Array.from({ length: 9 }, (_, i) => cls({ id: `mine-${i}` })),
      ...Array.from({ length: 5 }, (_, i) => cls({ id: `theirs-${i}`, teacher_user_id: 'someone-else' })),
    ]
    DB.user_tags = Array.from({ length: 5 }, (_, i) => classTag('teacher-1', `theirs-${i}`))
    const res = makeRes()
    await handler(makeReq('POST', body), res)
    expect(res.statusCode).toBe(201)
  })

  it('403s when the tutor platform trial has expired', async () => {
    DB.teachers = [{ id: 'teacher-row-1', learner_id: 'learner-1', platform_status: 'expired', platform_expires_at: null }]
    const res = makeRes()
    await handler(makeReq('POST', body), res)
    expect(res.statusCode).toBe(403)
    expect(DB.user_tags).toHaveLength(0)
  })

  // ── Join-code mint throttle (SEC22-01) ───────────────────────────────────
  // Every classes insert fires tr_classes_join_code → generate_join_code().
  // The 10-class CAP bounds live classes, not minting: archive-and-recreate
  // in a loop mints without bound, which is what this throttle closes.

  it('creates normally under the mint limit, and audits the attempt', async () => {
    DB.possession_mint_attempts = Array.from({ length: 5 }, () => mintAttempt())
    const res = makeRes()
    await handler(makeReq('POST', body), res)

    expect(res.statusCode).toBe(201)
    expect(DB.classes).toHaveLength(1)
    const logged = DB.possession_mint_attempts.filter((r) => r.outcome === 'class_mint_attempt')
    expect(logged).toHaveLength(6) // the 5 seeded + this request's own row
  })

  it('429s once the per-user mint window is full — and mints NO class', async () => {
    const { MINT_PER_USER_LIMIT } = await import('../_utils/mintRateLimit')
    DB.possession_mint_attempts = Array.from({ length: MINT_PER_USER_LIMIT }, () => mintAttempt())
    const res = makeRes()
    await handler(makeReq('POST', body), res)

    expect(res.statusCode).toBe(429)
    expect(DB.classes).toHaveLength(0)
    expect(DB.user_tags).toHaveLength(0)
    expect(
      DB.possession_mint_attempts.some((r) => r.outcome === 'rate_limited_mint_user'),
    ).toBe(true)
  })

  // A limiter counts ACTIONS, not its own REFUSALS: counting the 429 rows
  // would make a block self-perpetuating (a retrying client keeps its own
  // window permanently full and it never drains).
  it('a window full of REFUSAL rows does not block a real create', async () => {
    const { MINT_PER_USER_LIMIT } = await import('../_utils/mintRateLimit')
    DB.possession_mint_attempts = Array.from({ length: MINT_PER_USER_LIMIT * 2 }, () =>
      mintAttempt({ outcome: 'rate_limited_mint_user' }),
    )
    const res = makeRes()
    await handler(makeReq('POST', body), res)

    expect(res.statusCode).toBe(201)
    expect(DB.classes).toHaveLength(1)
  })

  // Another teacher's mints must not spend this teacher's per-user budget.
  it('another user\'s mints do not count against this teacher', async () => {
    const { MINT_PER_USER_LIMIT } = await import('../_utils/mintRateLimit')
    DB.possession_mint_attempts = Array.from({ length: MINT_PER_USER_LIMIT }, () =>
      mintAttempt({ auth_user_id: 'someone-else', ip_hash: 'otherhashotherha' }),
    )
    const res = makeRes()
    await handler(makeReq('POST', body), res)
    expect(res.statusCode).toBe(201)
  })

  // Redemption rows (api/code/validate.ts, api/auth/possession-redeem.ts)
  // share this table. They carry an invite_code_id, a different outcome
  // vocabulary and an un-namespaced ip_hash — none of which this counter
  // keys on, so redemptions can never throttle minting.
  it('redemption attempts do not throttle minting', async () => {
    DB.possession_mint_attempts = Array.from({ length: 200 }, (_, i) => mintAttempt({
      invite_code_id: `invite-${i}`,
      auth_user_id: null,
      ip_hash: 'plainiphashplain',
      outcome: 'validate_attempt',
    }))
    const res = makeRes()
    await handler(makeReq('POST', body), res)
    expect(res.statusCode).toBe(201)
  })

  it('a refusal BEFORE the throttle is never counted as a mint', async () => {
    // Cap reached → 409. The limiter runs last, so nothing is logged and the
    // teacher's window is untouched.
    DB.classes = Array.from({ length: 10 }, (_, i) => cls({ id: `mine-${i}` }))
    const res = makeRes()
    await handler(makeReq('POST', body), res)
    expect(res.statusCode).toBe(409)
    expect(DB.possession_mint_attempts).toHaveLength(0)
  })

  it('405s on an unsupported method', async () => {
    const res = makeRes()
    await handler({ method: 'DELETE', body: {}, headers: {} } as any, res)
    expect(res.statusCode).toBe(405)
  })
})
