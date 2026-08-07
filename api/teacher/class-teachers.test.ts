/**
 * Tests for POST /api/teacher/class-teachers — the service-role write path the
 * whole co-teaching story rests on (A-74). It had no test file at all.
 *
 * Covers:
 *   - the authorization matrix under the founder ruling of 2026-08-06 ("any
 *     group leader or the current teacher of the class can add the
 *     co-teacher"): the lead pointer, any leader above the class
 *     (school_admin, govt_admin of an ancestor group), ssi_admin/god, and
 *     refusal for a plain co-teacher and for a non-member;
 *   - `add` idempotency and reactivation of a soft-removed tag (the
 *     `unique_active_tag UNIQUE (user_id, tag_type, tag_value)` constraint is
 *     TOTAL, not partial, so a removed row must be reactivated, never
 *     re-inserted);
 *   - `remove` soft-delete plus lead-pointer handover (to another active
 *     teacher, or null when there is none);
 *   - the view-as guard and the input validation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-key'

let authResult: { valid: boolean; userId?: string; error?: string }
vi.mock('../_utils/auth', () => ({
  verifyAuthToken: vi.fn(async () => authResult),
}))

interface TagRow {
  id: string
  user_id: string
  tag_type: string
  tag_value: string
  role_in_context: string
  removed_at: string | null
  added_at?: string | null
  added_by?: string | null
}

let DB: {
  classes: Array<{ id: string; teacher_user_id: string | null; school_id: string | null; group_id?: string | null }>
  learners: Array<{ user_id: string; platform_role: string | null; educational_role: string | null }>
  schools: Array<{ id: string; admin_user_id: string | null; group_id?: string | null; node_group_id?: string | null }>
  govt_admins: Array<{ user_id: string; group_id: string | null }>
  groups: Array<{ id: string; parent_id: string | null }>
  user_tags: TagRow[]
}

/** Per-table write failure injection, keyed 'table:op'. */
let failWrites: Record<string, string>
let nextTagId = 0

/**
 * Minimal in-memory PostgREST. Filters accumulate; the builder is thenable so
 * both `await builder` (list / write) and `.single()` / `.maybeSingle()` work.
 */
function makeChainable(table: string) {
  const filters: Array<(r: any) => boolean> = []
  let limitN: number | null = null
  let op: 'select' | 'update' | 'insert' = 'select'
  let payload: any = null

  const rows = () => {
    let out = (DB as any)[table].filter((r: any) => filters.every((f) => f(r)))
    if (limitN != null) out = out.slice(0, limitN)
    return out
  }

  const runWrite = () => {
    const fail = failWrites[`${table}:${op}`]
    if (fail) return { data: null, error: { message: fail } }
    if (op === 'insert') {
      const list = Array.isArray(payload) ? payload : [payload]
      for (const r of list) {
        ;(DB as any)[table].push({ id: `gen-${++nextTagId}`, removed_at: null, ...r })
      }
      return { data: null, error: null }
    }
    const hit = rows()
    for (const r of hit) Object.assign(r, payload)
    return { data: hit, error: null }
  }

  const builder: any = {
    select: () => builder,
    insert: (v: any) => { op = 'insert'; payload = v; return builder },
    update: (v: any) => { op = 'update'; payload = v; return builder },
    eq: (col: string, val: unknown) => { filters.push((r) => r[col] === val); return builder },
    neq: (col: string, val: unknown) => { filters.push((r) => r[col] !== val); return builder },
    is: (col: string) => { filters.push((r) => r[col] == null); return builder },
    limit: (n: number) => { limitN = n; return builder },
    single: async () => {
      if (op !== 'select') return runWrite()
      const r = rows()[0]
      return r ? { data: r, error: null } : { data: null, error: { message: 'not found' } }
    },
    maybeSingle: async () => {
      if (op !== 'select') return runWrite()
      return { data: rows()[0] ?? null, error: null }
    },
    then: (resolve: any) => {
      const result = op === 'select' ? { data: rows(), error: null } : runWrite()
      return Promise.resolve(result).then(resolve)
    },
  }
  return builder
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: (table: string) => makeChainable(table) }),
}))

function makeReq(body: any, extraHeaders?: Record<string, string>): VercelRequest {
  return { method: 'POST', body, headers: { authorization: 'Bearer tok', ...extraHeaders } } as any
}

function makeRes(): VercelResponse & { statusCode?: number; body?: any } {
  const res: any = {}
  res.status = vi.fn((code: number) => { res.statusCode = code; return res })
  res.json = vi.fn((body: any) => { res.body = body; return res })
  return res
}

const CLASS_TAG = 'CLASS:class-1'

function tag(over: Partial<TagRow> = {}): TagRow {
  return {
    id: `tag-${++nextTagId}`,
    user_id: 'co-1',
    tag_type: 'class',
    tag_value: CLASS_TAG,
    role_in_context: 'teacher',
    removed_at: null,
    added_at: '2026-01-01T00:00:00.000Z',
    added_by: 'lead-1',
    ...over,
  }
}

function activeTags() {
  return DB.user_tags.filter(
    (t) => t.tag_value === CLASS_TAG && t.role_in_context === 'teacher' && t.removed_at == null,
  )
}

let handler: typeof import('./class-teachers').default

beforeEach(async () => {
  vi.resetModules()
  nextTagId = 0
  failWrites = {}
  handler = (await import('./class-teachers')).default
  authResult = { valid: true, userId: 'lead-1' }
  DB = {
    classes: [{ id: 'class-1', teacher_user_id: 'lead-1', school_id: null, group_id: null }],
    learners: [],
    schools: [],
    govt_admins: [],
    groups: [],
    user_tags: [],
  }
})

describe('POST /api/teacher/class-teachers — authorization matrix', () => {
  const body = { class_id: 'class-1', action: 'add' as const, target_user_id: 'new-teacher' }

  it('allows the LEAD (classes.teacher_user_id)', async () => {
    const res = makeRes()
    await handler(makeReq(body), res)
    expect(res.statusCode).toBe(200)
    expect(activeTags().map((t) => t.user_id)).toContain('new-teacher')
  })

  // THE RULING (2026-08-06): a plain co-teacher may TEACH the class but may
  // not change who else teaches it. Only the lead teacher and the leaders
  // above the class recruit.
  it('REFUSES a co-teacher holding an active class/teacher tag', async () => {
    authResult = { valid: true, userId: 'co-1' }
    DB.user_tags = [tag({ user_id: 'co-1' })]
    const res = makeRes()
    await handler(makeReq(body), res)
    expect(res.statusCode).toBe(403)
    expect(activeTags().map((t) => t.user_id)).not.toContain('new-teacher')
  })

  it('refuses a co-teacher whose tag has been soft-REMOVED', async () => {
    authResult = { valid: true, userId: 'co-1' }
    DB.user_tags = [tag({ user_id: 'co-1', removed_at: '2026-02-01T00:00:00.000Z' })]
    const res = makeRes()
    await handler(makeReq(body), res)
    expect(res.statusCode).toBe(403)
  })

  it('allows any active teacher when the class has NO lead pointer at all', async () => {
    DB.classes[0] = { id: 'class-1', teacher_user_id: null, school_id: null, group_id: null }
    authResult = { valid: true, userId: 'co-1' }
    DB.user_tags = [tag({ user_id: 'co-1' })]
    const res = makeRes()
    await handler(makeReq(body), res)
    expect(res.statusCode).toBe(200)
  })

  it("allows a govt_admin leading the school's own node", async () => {
    DB.classes[0] = { id: 'class-1', teacher_user_id: 'lead-1', school_id: 'school-1', group_id: null }
    DB.schools = [{ id: 'school-1', admin_user_id: 'admin-1', group_id: null, node_group_id: 'node-1' }]
    DB.groups = [{ id: 'node-1', parent_id: null }]
    DB.govt_admins = [{ user_id: 'leader-1', group_id: 'node-1' }]
    authResult = { valid: true, userId: 'leader-1' }
    const res = makeRes()
    await handler(makeReq(body), res)
    expect(res.statusCode).toBe(200)
  })

  it('allows a govt_admin leading an ANCESTOR group of the class', async () => {
    DB.classes[0] = { id: 'class-1', teacher_user_id: 'lead-1', school_id: 'school-1', group_id: null }
    DB.schools = [{ id: 'school-1', admin_user_id: 'admin-1', group_id: null, node_group_id: 'node-1' }]
    DB.groups = [{ id: 'council', parent_id: null }, { id: 'node-1', parent_id: 'council' }]
    DB.govt_admins = [{ user_id: 'leader-1', group_id: 'council' }]
    authResult = { valid: true, userId: 'leader-1' }
    const res = makeRes()
    await handler(makeReq(body), res)
    expect(res.statusCode).toBe(200)
  })

  it('refuses a govt_admin leading a SIDEWAYS group', async () => {
    DB.classes[0] = { id: 'class-1', teacher_user_id: 'lead-1', school_id: 'school-1', group_id: null }
    DB.schools = [{ id: 'school-1', admin_user_id: 'admin-1', group_id: null, node_group_id: 'node-1' }]
    DB.groups = [
      { id: 'council', parent_id: null },
      { id: 'node-1', parent_id: 'council' },
      { id: 'other-school', parent_id: 'council' },
    ]
    DB.govt_admins = [{ user_id: 'leader-2', group_id: 'other-school' }]
    authResult = { valid: true, userId: 'leader-2' }
    const res = makeRes()
    await handler(makeReq(body), res)
    expect(res.statusCode).toBe(403)
  })

  it('lets a co-teacher REMOVE THEMSELVES — leaving is not managing', async () => {
    authResult = { valid: true, userId: 'co-1' }
    DB.user_tags = [tag({ user_id: 'co-1' })]
    const res = makeRes()
    await handler(
      makeReq({ class_id: 'class-1', action: 'remove', target_user_id: 'co-1' }),
      res,
    )
    expect(res.statusCode).toBe(200)
    expect(activeTags().map((t) => t.user_id)).not.toContain('co-1')
  })

  it('refuses a co-teacher removing SOMEBODY ELSE', async () => {
    authResult = { valid: true, userId: 'co-1' }
    DB.user_tags = [tag({ user_id: 'co-1' }), tag({ user_id: 'co-2' })]
    const res = makeRes()
    await handler(
      makeReq({ class_id: 'class-1', action: 'remove', target_user_id: 'co-2' }),
      res,
    )
    expect(res.statusCode).toBe(403)
    expect(activeTags().map((t) => t.user_id)).toContain('co-2')
  })

  it('allows an ssi_admin', async () => {
    authResult = { valid: true, userId: 'admin-1' }
    DB.learners = [{ user_id: 'admin-1', platform_role: 'ssi_admin', educational_role: null }]
    const res = makeRes()
    await handler(makeReq(body), res)
    expect(res.statusCode).toBe(200)
  })

  it('allows a god (educational_role)', async () => {
    authResult = { valid: true, userId: 'god-1' }
    DB.learners = [{ user_id: 'god-1', platform_role: null, educational_role: 'god' }]
    const res = makeRes()
    await handler(makeReq(body), res)
    expect(res.statusCode).toBe(200)
  })

  it("allows the school_admin of the class's school", async () => {
    DB.classes[0] = { id: 'class-1', teacher_user_id: 'lead-1', school_id: 'school-1', group_id: null }
    DB.schools = [{ id: 'school-1', admin_user_id: 'admin-1' }]
    authResult = { valid: true, userId: 'admin-1' }
    const res = makeRes()
    await handler(makeReq(body), res)
    expect(res.statusCode).toBe(200)
  })

  it("refuses the admin of a DIFFERENT school", async () => {
    DB.classes[0] = { id: 'class-1', teacher_user_id: 'lead-1', school_id: 'school-1', group_id: null }
    DB.schools = [{ id: 'school-1', admin_user_id: 'admin-1' }, { id: 'school-2', admin_user_id: 'admin-2' }]
    authResult = { valid: true, userId: 'admin-2' }
    const res = makeRes()
    await handler(makeReq(body), res)
    expect(res.statusCode).toBe(403)
  })

  it('refuses a non-member stranger, and writes nothing', async () => {
    authResult = { valid: true, userId: 'stranger' }
    const res = makeRes()
    await handler(makeReq(body), res)
    expect(res.statusCode).toBe(403)
    expect(DB.user_tags).toHaveLength(0)
  })

  it('401s without a valid token', async () => {
    authResult = { valid: false, error: 'no token' }
    const res = makeRes()
    await handler(makeReq(body), res)
    expect(res.statusCode).toBe(401)
  })

  it('rejects an admin write attempted while viewing-as', async () => {
    authResult = { valid: true, userId: 'admin-1' }
    DB.learners = [{ user_id: 'admin-1', platform_role: 'ssi_admin', educational_role: null }]
    const res = makeRes()
    await handler(makeReq(body, { 'x-ssi-view-as': '1' }), res)
    expect(res.statusCode).toBe(403)
    expect(DB.user_tags).toHaveLength(0)
  })

  it('404s when the class does not exist', async () => {
    const res = makeRes()
    await handler(makeReq({ ...body, class_id: 'nope' }), res)
    expect(res.statusCode).toBe(404)
  })
})

describe('POST /api/teacher/class-teachers — input validation', () => {
  it('405s on a non-POST method', async () => {
    const res = makeRes()
    await handler({ method: 'GET', body: {}, headers: {} } as any, res)
    expect(res.statusCode).toBe(405)
  })

  it('400s without class_id', async () => {
    const res = makeRes()
    await handler(makeReq({ action: 'add', target_user_id: 'x' }), res)
    expect(res.statusCode).toBe(400)
  })

  it('400s on an unknown action', async () => {
    const res = makeRes()
    await handler(makeReq({ class_id: 'class-1', action: 'promote', target_user_id: 'x' }), res)
    expect(res.statusCode).toBe(400)
  })

  it('400s without target_user_id', async () => {
    const res = makeRes()
    await handler(makeReq({ class_id: 'class-1', action: 'add' }), res)
    expect(res.statusCode).toBe(400)
  })
})

describe("POST /api/teacher/class-teachers — action 'add'", () => {
  it('inserts a class/teacher tag for the target', async () => {
    const res = makeRes()
    await handler(makeReq({ class_id: 'class-1', action: 'add', target_user_id: 'co-2' }), res)
    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({ ok: true, action: 'add', target_user_id: 'co-2' })
    const inserted = DB.user_tags.find((t) => t.user_id === 'co-2')
    expect(inserted).toMatchObject({
      tag_type: 'class',
      tag_value: CLASS_TAG,
      role_in_context: 'teacher',
      removed_at: null,
      added_by: 'lead-1',
    })
  })

  it('is IDEMPOTENT — re-adding an active teacher inserts no duplicate row', async () => {
    DB.user_tags = [tag({ user_id: 'co-2' })]
    const res = makeRes()
    await handler(makeReq({ class_id: 'class-1', action: 'add', target_user_id: 'co-2' }), res)
    expect(res.statusCode).toBe(200)
    expect(DB.user_tags.filter((t) => t.user_id === 'co-2')).toHaveLength(1)
  })

  it('REACTIVATES a soft-removed tag rather than inserting a second row', async () => {
    // unique_active_tag is TOTAL, so the removed row still occupies the slot.
    DB.user_tags = [tag({ user_id: 'co-2', removed_at: '2026-02-01T00:00:00.000Z', added_by: 'someone' })]
    const res = makeRes()
    await handler(makeReq({ class_id: 'class-1', action: 'add', target_user_id: 'co-2' }), res)
    expect(res.statusCode).toBe(200)
    const rows = DB.user_tags.filter((t) => t.user_id === 'co-2')
    expect(rows).toHaveLength(1)
    expect(rows[0].removed_at).toBeNull()
    expect(rows[0].added_by).toBe('lead-1')
  })

  it('set_lead repoints classes.teacher_user_id at the target', async () => {
    const res = makeRes()
    await handler(
      makeReq({ class_id: 'class-1', action: 'add', target_user_id: 'co-2', set_lead: true }),
      res,
    )
    expect(res.statusCode).toBe(200)
    expect(res.body.lead).toBe('co-2')
    expect(DB.classes[0].teacher_user_id).toBe('co-2')
  })

  it('leaves the lead alone when set_lead is absent', async () => {
    const res = makeRes()
    await handler(makeReq({ class_id: 'class-1', action: 'add', target_user_id: 'co-2' }), res)
    expect(DB.classes[0].teacher_user_id).toBe('lead-1')
    expect(res.body.lead).toBe('lead-1')
  })

  it('500s (never a false success) when the tag insert fails', async () => {
    failWrites['user_tags:insert'] = 'boom'
    const res = makeRes()
    await handler(makeReq({ class_id: 'class-1', action: 'add', target_user_id: 'co-2' }), res)
    expect(res.statusCode).toBe(500)
  })
})

describe("POST /api/teacher/class-teachers — action 'remove'", () => {
  it('soft-deletes the target tag and leaves other teachers alone', async () => {
    DB.user_tags = [tag({ user_id: 'co-1' }), tag({ user_id: 'co-2' })]
    const res = makeRes()
    await handler(makeReq({ class_id: 'class-1', action: 'remove', target_user_id: 'co-1' }), res)
    expect(res.statusCode).toBe(200)
    expect(DB.user_tags.find((t) => t.user_id === 'co-1')!.removed_at).toBeTruthy()
    expect(DB.user_tags.find((t) => t.user_id === 'co-2')!.removed_at).toBeNull()
    // Not the lead → the pointer is untouched.
    expect(DB.classes[0].teacher_user_id).toBe('lead-1')
  })

  it('HANDS THE LEAD ON to a remaining active teacher when the lead is removed', async () => {
    DB.user_tags = [tag({ user_id: 'lead-1' }), tag({ user_id: 'co-2' })]
    const res = makeRes()
    await handler(makeReq({ class_id: 'class-1', action: 'remove', target_user_id: 'lead-1' }), res)
    expect(res.statusCode).toBe(200)
    expect(DB.classes[0].teacher_user_id).toBe('co-2')
    expect(res.body.lead).toBe('co-2')
  })

  it('nulls the lead when the removed lead was the last teacher', async () => {
    DB.user_tags = [tag({ user_id: 'lead-1' })]
    const res = makeRes()
    await handler(makeReq({ class_id: 'class-1', action: 'remove', target_user_id: 'lead-1' }), res)
    expect(res.statusCode).toBe(200)
    expect(DB.classes[0].teacher_user_id).toBeNull()
    expect(res.body.lead).toBeNull()
  })

  it('does not hand the lead to an already-REMOVED teacher', async () => {
    DB.user_tags = [
      tag({ user_id: 'lead-1' }),
      tag({ user_id: 'co-2', removed_at: '2026-02-01T00:00:00.000Z' }),
    ]
    const res = makeRes()
    await handler(makeReq({ class_id: 'class-1', action: 'remove', target_user_id: 'lead-1' }), res)
    expect(DB.classes[0].teacher_user_id).toBeNull()
  })

  it('500s when the soft-delete write fails', async () => {
    failWrites['user_tags:update'] = 'boom'
    DB.user_tags = [tag({ user_id: 'co-1' })]
    const res = makeRes()
    await handler(makeReq({ class_id: 'class-1', action: 'remove', target_user_id: 'co-1' }), res)
    expect(res.statusCode).toBe(500)
  })
})
