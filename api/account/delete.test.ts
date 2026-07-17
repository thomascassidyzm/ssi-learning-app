/**
 * Tests for POST /api/account/delete — server-mediated account deletion.
 * Covers: caller-only scope (no target param to abuse), the learners-row
 * delete that cascades everything, FK-restrict (family/class-entity link)
 * surfaced as a clear 409 instead of a silent partial delete, and that the
 * Auth identity is actually removed (never a false "deleted successfully").
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
  learners: Array<{ id: string; user_id: string }>
}
let deletedAuthUserIds: string[]
let authDeleteShouldFail: boolean
let fkRestrictViolation: boolean

function makeChainable() {
  let rows: any[] = [...DB.learners]
  const builder: any = {
    select() { return builder },
    eq(col: string, val: unknown) { rows = rows.filter((r: any) => r[col] === val); return builder },
    async maybeSingle() {
      return { data: rows[0] ?? null, error: null }
    },
    delete() {
      return {
        eq: async (col: string, val: unknown) => {
          if (fkRestrictViolation) {
            return { data: null, error: { code: '23503', message: 'update or delete on table "learners" violates foreign key constraint' } }
          }
          const before = DB.learners.length
          DB.learners = DB.learners.filter((r: any) => r[col] !== val)
          if (DB.learners.length === before) return { data: null, error: null }
          return { data: null, error: null }
        },
      }
    },
  }
  return builder
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => makeChainable(),
    auth: {
      admin: {
        deleteUser: async (userId: string) => {
          if (authDeleteShouldFail) return { data: null, error: { message: 'admin API unavailable' } }
          deletedAuthUserIds.push(userId)
          return { data: {}, error: null }
        },
      },
    },
  }),
}))

function makeReq(body: any = {}): VercelRequest {
  return { method: 'POST', body, headers: { authorization: 'Bearer tok' } } as any
}

function makeRes(): VercelResponse & { statusCode?: number; body?: any } {
  const res: any = {}
  res.status = vi.fn((code: number) => { res.statusCode = code; return res })
  res.json = vi.fn((body: any) => { res.body = body; return res })
  return res
}

let handler: typeof import('./delete').default

beforeEach(async () => {
  vi.resetModules()
  handler = (await import('./delete')).default
  DB = { learners: [{ id: 'learner-1', user_id: 'user-a' }] }
  deletedAuthUserIds = []
  authDeleteShouldFail = false
  fkRestrictViolation = false
})

describe('POST /api/account/delete', () => {
  it('deletes the learner row and the auth identity — real success, not a fake one', async () => {
    authUserId = 'user-a'
    const res = makeRes()
    await handler(makeReq(), res)
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ ok: true, dataDeleted: true, authDeleted: true })
    expect(DB.learners).toHaveLength(0)
    expect(deletedAuthUserIds).toEqual(['user-a'])
  })

  it('ignores any target_user_id in the body — always deletes the caller\'s own account', async () => {
    authUserId = 'user-a'
    DB.learners.push({ id: 'learner-2', user_id: 'someone-else' })
    const res = makeRes()
    await handler(makeReq({ target_user_id: 'someone-else' }), res)
    expect(res.statusCode).toBe(200)
    expect(DB.learners).toEqual([{ id: 'learner-2', user_id: 'someone-else' }])
    expect(deletedAuthUserIds).toEqual(['user-a'])
  })

  it('401s an unauthenticated caller', async () => {
    const { verifyAuthToken } = await import('../_utils/auth')
    ;(verifyAuthToken as any).mockResolvedValueOnce({ valid: false, error: 'no token' })
    const res = makeRes()
    await handler(makeReq(), res)
    expect(res.statusCode).toBe(401)
    expect(DB.learners).toHaveLength(1)
    expect(deletedAuthUserIds).toEqual([])
  })

  it('409s on a family/class-entity FK-restrict link — no partial delete, honest error', async () => {
    authUserId = 'user-a'
    fkRestrictViolation = true
    const res = makeRes()
    await handler(makeReq(), res)
    expect(res.statusCode).toBe(409)
    expect(DB.learners).toHaveLength(1)
    expect(deletedAuthUserIds).toEqual([])
  })

  it('reports a real partial failure when the auth identity cannot be removed — never claims full success', async () => {
    authUserId = 'user-a'
    authDeleteShouldFail = true
    const res = makeRes()
    await handler(makeReq(), res)
    expect(res.statusCode).toBe(500)
    expect(res.body.dataDeleted).toBe(true)
    expect(res.body.authDeleted).toBe(false)
    expect(DB.learners).toHaveLength(0)
  })

  it('still removes the auth identity when no learner row exists (cleanup edge case)', async () => {
    authUserId = 'orphan-user'
    const res = makeRes()
    await handler(makeReq(), res)
    expect(res.statusCode).toBe(200)
    expect(deletedAuthUserIds).toEqual(['orphan-user'])
  })

  it('405s a non-POST method', async () => {
    authUserId = 'user-a'
    const res = makeRes()
    await handler({ method: 'GET', headers: {} } as any, res)
    expect(res.statusCode).toBe(405)
  })
})
