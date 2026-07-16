/**
 * Tests for POST /api/school/update-seats — SECURITY: only a school_admin
 * may change paid seat counts. A plain teacher's SCHOOL: tag
 * (role_in_context 'teacher') must be rejected (403) and audit-logged, and
 * must never reach Paddle (2026-07-16 teacher-loop audit finding — same gap
 * as update-profile.ts).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-key'

let authUserId: string
vi.mock('../_utils/auth', () => ({
  verifyAuthToken: vi.fn(async () => ({ valid: true, userId: authUserId })),
}))

const auditSpy = vi.fn(async () => {})
vi.mock('../_utils/auditSchoolWriteRejection', () => ({
  auditSchoolWriteRejection: auditSpy,
}))

const paddleGet = vi.fn()
const paddleUpdate = vi.fn()
vi.mock('../_utils/paddle', () => ({
  paddle: { subscriptions: { get: (...a: any[]) => paddleGet(...a), update: (...a: any[]) => paddleUpdate(...a) } },
}))

let DB: {
  schools: Array<{ id: string; admin_user_id: string | null; provider_subscription_id: string | null; platform_status: string | null; teacher_seats: number | null }>
  user_tags: Array<{ user_id: string; tag_type: string; tag_value: string; role_in_context: string | null; removed_at: string | null }>
}

function makeChainable(table: string) {
  let rows: any[] = [...((DB as any)[table] ?? [])]
  const builder: any = {
    select() { return builder },
    eq(col: string, val: unknown) { rows = rows.filter((r) => r[col] === val); return builder },
    is(col: string, val: unknown) { rows = rows.filter((r) => (r[col] ?? null) === val); return builder },
    limit() { return builder },
    update() { return { eq: async () => ({ data: null, error: null }) } },
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

let handler: typeof import('./update-seats').default

beforeEach(async () => {
  vi.resetModules()
  auditSpy.mockClear()
  paddleGet.mockClear()
  paddleUpdate.mockClear()
  handler = (await import('./update-seats')).default
  DB = {
    schools: [{ id: 'school-1', admin_user_id: 'admin-a', provider_subscription_id: null, platform_status: 'active', teacher_seats: 5 }],
    user_tags: [],
  }
})

describe('POST /api/school/update-seats', () => {
  it('REJECTS a plain teacher (role_in_context=teacher) with 403, audit-logs, and never calls Paddle', async () => {
    authUserId = 'teacher-c'
    DB.user_tags.push({ user_id: 'teacher-c', tag_type: 'school', tag_value: 'SCHOOL:school-1', role_in_context: 'teacher', removed_at: null })
    const res = makeRes()
    await handler(makeReq({ seats: 10 }), res)
    expect(res.statusCode).toBe(403)
    expect(paddleGet).not.toHaveBeenCalled()
    expect(paddleUpdate).not.toHaveBeenCalled()
    expect(auditSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ authUserId: 'teacher-c', schoolId: 'school-1', roleInContext: 'teacher', endpoint: 'school/update-seats' }),
    )
  })

  it('404s an account with no school tag at all (no audit log)', async () => {
    authUserId = 'nobody'
    const res = makeRes()
    await handler(makeReq({ seats: 10 }), res)
    expect(res.statusCode).toBe(404)
    expect(auditSpy).not.toHaveBeenCalled()
  })

  it('lets the school_admin owner reach the subscription check (409 — no live subscription yet)', async () => {
    authUserId = 'admin-a'
    const res = makeRes()
    await handler(makeReq({ seats: 10 }), res)
    expect(res.statusCode).toBe(409)
    expect(res.body.requires_checkout).toBe(true)
  })

  it('lets a user_tags admin (role_in_context=admin) reach the subscription check', async () => {
    authUserId = 'admin-b'
    DB.user_tags.push({ user_id: 'admin-b', tag_type: 'school', tag_value: 'SCHOOL:school-1', role_in_context: 'admin', removed_at: null })
    const res = makeRes()
    await handler(makeReq({ seats: 10 }), res)
    expect(res.statusCode).toBe(409)
  })
})
