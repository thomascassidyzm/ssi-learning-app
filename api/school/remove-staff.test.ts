/**
 * Tests for POST /api/school/remove-staff — server-mediated replacement for
 * TeachersView.vue's direct client user_tags.update(), which silently no-ops
 * under own-row RLS (2026-07-16 teacher-loop audit finding). Covers:
 * admin-only authorization, and that removal actually flips removed_at
 * (never a false "success").
 *
 * A-74 adds the CASCADE: removing a teacher from a school must also revoke
 * their CLASS:<id>/teacher relationships for that school's classes and hand
 * on any lead pointer they hold. Without it a "removed" teacher kept
 * class-level tags and therefore kept pupil-data visibility through
 * resolveVisibleScope — a live authz hole, not a cosmetic one.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-key'

let authUserId: string
vi.mock('../_utils/auth', () => ({
  verifyAuthToken: vi.fn(async () => ({ valid: true, userId: authUserId })),
}))

interface TagRow {
  id: string
  user_id: string
  tag_type: string
  tag_value: string
  role_in_context: string | null
  removed_at: string | null
}

let DB: {
  schools: Array<{ id: string; admin_user_id: string | null }>
  classes: Array<{ id: string; school_id: string | null; teacher_user_id: string | null }>
  user_tags: TagRow[]
}

/** Per-table failure injection, keyed 'table:select' | 'table:update'. */
let failOps: Record<string, string>

function makeChainable(table: string) {
  const filters: Array<(r: any) => boolean> = []
  let limitN: number | null = null
  let op: 'select' | 'update' = 'select'
  let payload: any = null

  const rows = () => {
    let out = (DB as any)[table].filter((r: any) => filters.every((f) => f(r)))
    if (limitN != null) out = out.slice(0, limitN)
    return out
  }

  const run = () => {
    const fail = failOps[`${table}:${op}`]
    if (fail) return { data: null, error: { message: fail } }
    if (op === 'select') return { data: rows(), error: null }
    const hit = rows()
    for (const r of hit) Object.assign(r, payload)
    return { data: hit, error: null }
  }

  const builder: any = {
    select() { return builder },
    update(patch: any) { op = 'update'; payload = patch; return builder },
    eq(col: string, val: unknown) { filters.push((r) => r[col] === val); return builder },
    neq(col: string, val: unknown) { filters.push((r) => r[col] !== val); return builder },
    in(col: string, vals: unknown[]) { filters.push((r) => vals.includes(r[col])); return builder },
    is(col: string) { filters.push((r) => (r[col] ?? null) === null); return builder },
    limit(n: number) { limitN = n; return builder },
    async maybeSingle() {
      const r = run()
      if (r.error) return { data: null, error: r.error }
      return { data: (r.data as any[])[0] ?? null, error: null }
    },
    then(resolve: any) { return Promise.resolve(run()).then(resolve) },
  }
  return builder
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: (table: string) => makeChainable(table) }),
}))

function makeReq(body: any): VercelRequest {
  return { method: 'POST', body, headers: { authorization: 'Bearer tok' } } as any
}

function makeRes(): VercelResponse & { statusCode?: number; body?: any } {
  const res: any = {}
  res.status = vi.fn((code: number) => { res.statusCode = code; return res })
  res.json = vi.fn((body: any) => { res.body = body; return res })
  return res
}

const tagOf = (id: string) => DB.user_tags.find((t) => t.id === id)!

let handler: typeof import('./remove-staff').default

beforeEach(async () => {
  vi.resetModules()
  failOps = {}
  handler = (await import('./remove-staff')).default
  DB = {
    schools: [{ id: 'school-1', admin_user_id: 'admin-a' }],
    classes: [],
    user_tags: [
      { id: 'tag-1', user_id: 'teacher-x', tag_type: 'school', tag_value: 'SCHOOL:school-1', role_in_context: 'teacher', removed_at: null },
    ],
  }
})

describe('POST /api/school/remove-staff', () => {
  it('the schools.admin_user_id owner removes a teacher — removed_at is actually set', async () => {
    authUserId = 'admin-a'
    const res = makeRes()
    await handler(makeReq({ target_user_id: 'teacher-x' }), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(tagOf('tag-1').removed_at).not.toBeNull()
  })

  it('a user_tags admin (role_in_context=admin) can also remove', async () => {
    authUserId = 'admin-b'
    DB.schools[0].admin_user_id = 'someone-else'
    DB.user_tags.push({ id: 'tag-2', user_id: 'admin-b', tag_type: 'school', tag_value: 'SCHOOL:school-1', role_in_context: 'admin', removed_at: null })
    const res = makeRes()
    await handler(makeReq({ target_user_id: 'teacher-x' }), res)
    expect(res.statusCode).toBe(200)
    expect(tagOf('tag-1').removed_at).not.toBeNull()
  })

  it('REJECTS a plain teacher trying to remove a colleague — 403, no write happens', async () => {
    authUserId = 'teacher-y'
    DB.user_tags.push({ id: 'tag-3', user_id: 'teacher-y', tag_type: 'school', tag_value: 'SCHOOL:school-1', role_in_context: 'teacher', removed_at: null })
    const res = makeRes()
    await handler(makeReq({ target_user_id: 'teacher-x' }), res)
    expect(res.statusCode).toBe(403)
    expect(tagOf('tag-1').removed_at).toBeNull()
  })

  it('404s when the target is not an active teacher of the caller\'s school', async () => {
    authUserId = 'admin-a'
    const res = makeRes()
    await handler(makeReq({ target_user_id: 'not-a-teacher' }), res)
    expect(res.statusCode).toBe(404)
  })

  it('400s a missing target_user_id', async () => {
    authUserId = 'admin-a'
    const res = makeRes()
    await handler(makeReq({}), res)
    expect(res.statusCode).toBe(400)
  })
})

describe('POST /api/school/remove-staff — class-tag cascade (A-74, S9)', () => {
  beforeEach(() => {
    authUserId = 'admin-a'
    DB.classes = [
      { id: 'class-1', school_id: 'school-1', teacher_user_id: 'lead-1' },
      { id: 'class-2', school_id: 'school-1', teacher_user_id: 'lead-1' },
    ]
  })

  it('revokes the removed teacher\'s CLASS tags for that school\'s classes', async () => {
    DB.user_tags.push(
      { id: 'ct-1', user_id: 'teacher-x', tag_type: 'class', tag_value: 'CLASS:class-1', role_in_context: 'teacher', removed_at: null },
      { id: 'ct-2', user_id: 'teacher-x', tag_type: 'class', tag_value: 'CLASS:class-2', role_in_context: 'teacher', removed_at: null },
    )
    const res = makeRes()
    await handler(makeReq({ target_user_id: 'teacher-x' }), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.class_tags_removed).toBe(2)
    expect(tagOf('ct-1').removed_at).not.toBeNull()
    expect(tagOf('ct-2').removed_at).not.toBeNull()
  })

  it('leaves ANOTHER teacher\'s tags on the same classes alone', async () => {
    DB.user_tags.push(
      { id: 'ct-1', user_id: 'teacher-x', tag_type: 'class', tag_value: 'CLASS:class-1', role_in_context: 'teacher', removed_at: null },
      { id: 'ct-other', user_id: 'teacher-z', tag_type: 'class', tag_value: 'CLASS:class-1', role_in_context: 'teacher', removed_at: null },
    )
    const res = makeRes()
    await handler(makeReq({ target_user_id: 'teacher-x' }), res)
    expect(res.statusCode).toBe(200)
    expect(tagOf('ct-1').removed_at).not.toBeNull()
    expect(tagOf('ct-other').removed_at).toBeNull()
  })

  it('does NOT touch their class tags at a DIFFERENT school', async () => {
    DB.classes.push({ id: 'other-class', school_id: 'school-2', teacher_user_id: 'teacher-x' })
    DB.user_tags.push(
      { id: 'ct-1', user_id: 'teacher-x', tag_type: 'class', tag_value: 'CLASS:class-1', role_in_context: 'teacher', removed_at: null },
      { id: 'ct-elsewhere', user_id: 'teacher-x', tag_type: 'class', tag_value: 'CLASS:other-class', role_in_context: 'teacher', removed_at: null },
    )
    const res = makeRes()
    await handler(makeReq({ target_user_id: 'teacher-x' }), res)
    expect(tagOf('ct-1').removed_at).not.toBeNull()
    expect(tagOf('ct-elsewhere').removed_at).toBeNull()
  })

  it('does NOT touch their PERSONAL tutor classes (school_id IS NULL)', async () => {
    DB.classes.push({ id: 'personal-1', school_id: null, teacher_user_id: 'teacher-x' })
    DB.user_tags.push(
      { id: 'ct-personal', user_id: 'teacher-x', tag_type: 'class', tag_value: 'CLASS:personal-1', role_in_context: 'teacher', removed_at: null },
    )
    const res = makeRes()
    await handler(makeReq({ target_user_id: 'teacher-x' }), res)
    expect(res.statusCode).toBe(200)
    expect(tagOf('ct-personal').removed_at).toBeNull()
    expect(DB.classes.find((c) => c.id === 'personal-1')!.teacher_user_id).toBe('teacher-x')
  })

  it('does NOT revoke a non-teacher (student) class tag', async () => {
    DB.user_tags.push(
      { id: 'ct-student', user_id: 'teacher-x', tag_type: 'class', tag_value: 'CLASS:class-1', role_in_context: 'student', removed_at: null },
    )
    const res = makeRes()
    await handler(makeReq({ target_user_id: 'teacher-x' }), res)
    expect(tagOf('ct-student').removed_at).toBeNull()
  })

  it('hands the LEAD pointer on to a remaining active co-teacher', async () => {
    DB.classes[0].teacher_user_id = 'teacher-x'
    DB.user_tags.push(
      { id: 'ct-1', user_id: 'teacher-x', tag_type: 'class', tag_value: 'CLASS:class-1', role_in_context: 'teacher', removed_at: null },
      { id: 'ct-co', user_id: 'teacher-z', tag_type: 'class', tag_value: 'CLASS:class-1', role_in_context: 'teacher', removed_at: null },
    )
    const res = makeRes()
    await handler(makeReq({ target_user_id: 'teacher-x' }), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.classes_lead_handed_over).toBe(1)
    expect(DB.classes[0].teacher_user_id).toBe('teacher-z')
  })

  it('NULLS the lead pointer when no other teacher remains — never leaves the removed teacher named', async () => {
    DB.classes[0].teacher_user_id = 'teacher-x'
    DB.user_tags.push(
      { id: 'ct-1', user_id: 'teacher-x', tag_type: 'class', tag_value: 'CLASS:class-1', role_in_context: 'teacher', removed_at: null },
    )
    const res = makeRes()
    await handler(makeReq({ target_user_id: 'teacher-x' }), res)
    expect(res.statusCode).toBe(200)
    expect(DB.classes[0].teacher_user_id).toBeNull()
  })

  it('succeeds cleanly when the teacher held no class tags at all', async () => {
    const res = makeRes()
    await handler(makeReq({ target_user_id: 'teacher-x' }), res)
    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({ ok: true, class_tags_removed: 0, classes_lead_handed_over: 0 })
  })

  it('500s (never a false "removed") when the cascade write fails', async () => {
    DB.user_tags.push(
      { id: 'ct-1', user_id: 'teacher-x', tag_type: 'class', tag_value: 'CLASS:class-1', role_in_context: 'teacher', removed_at: null },
    )
    // The school-tag soft-delete is also a user_tags update, so target the
    // failure at the class lookup that gates the cascade instead.
    failOps['classes:select'] = 'boom'
    const res = makeRes()
    await handler(makeReq({ target_user_id: 'teacher-x' }), res)
    expect(res.statusCode).toBe(500)
    expect(String(res.body.error)).toMatch(/revoke their class access/i)
  })
})
