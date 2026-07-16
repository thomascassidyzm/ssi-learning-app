/**
 * Tests for POST /api/school/remove-staff — server-mediated replacement for
 * TeachersView.vue's direct client user_tags.update(), which silently no-ops
 * under own-row RLS (2026-07-16 teacher-loop audit finding). Covers:
 * admin-only authorization, and that removal actually flips removed_at
 * (never a false "success").
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-key'

let authUserId: string
vi.mock('../_utils/auth', () => ({
  verifyAuthToken: vi.fn(async () => ({ valid: true, userId: authUserId })),
}))

let DB: {
  schools: Array<{ id: string; admin_user_id: string | null }>
  user_tags: Array<{ id: string; user_id: string; tag_type: string; tag_value: string; role_in_context: string | null; removed_at: string | null }>
}

function makeChainable(table: string) {
  let rows: any[] = [...((DB as any)[table] ?? [])]
  const builder: any = {
    select() { return builder },
    eq(col: string, val: unknown) { rows = rows.filter((r) => r[col] === val); return builder },
    is(col: string, val: unknown) { rows = rows.filter((r) => (r[col] ?? null) === val); return builder },
    limit() { return builder },
    update(patch: any) {
      return {
        eq: async (col: string, val: unknown) => {
          const match = ((DB as any)[table] as any[]).filter((r) => r[col] === val)
          match.forEach((r) => Object.assign(r, patch))
          return { data: null, error: null }
        },
      }
    },
    async maybeSingle() {
      return { data: rows[0] ?? null, error: null }
    },
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

let handler: typeof import('./remove-staff').default

beforeEach(async () => {
  vi.resetModules()
  handler = (await import('./remove-staff')).default
  DB = {
    schools: [{ id: 'school-1', admin_user_id: 'admin-a' }],
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
    expect(DB.user_tags[0].removed_at).not.toBeNull()
  })

  it('a user_tags admin (role_in_context=admin) can also remove', async () => {
    authUserId = 'admin-b'
    DB.schools[0].admin_user_id = 'someone-else'
    DB.user_tags.push({ id: 'tag-2', user_id: 'admin-b', tag_type: 'school', tag_value: 'SCHOOL:school-1', role_in_context: 'admin', removed_at: null })
    const res = makeRes()
    await handler(makeReq({ target_user_id: 'teacher-x' }), res)
    expect(res.statusCode).toBe(200)
    expect(DB.user_tags[0].removed_at).not.toBeNull()
  })

  it('REJECTS a plain teacher trying to remove a colleague — 403, no write happens', async () => {
    authUserId = 'teacher-y'
    DB.user_tags.push({ id: 'tag-3', user_id: 'teacher-y', tag_type: 'school', tag_value: 'SCHOOL:school-1', role_in_context: 'teacher', removed_at: null })
    const res = makeRes()
    await handler(makeReq({ target_user_id: 'teacher-x' }), res)
    expect(res.statusCode).toBe(403)
    expect(DB.user_tags[0].removed_at).toBeNull()
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
