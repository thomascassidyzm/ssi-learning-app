/**
 * POST /api/auth/end-other-sessions — ruling 3's "sign that one out": runs
 * only on the person's tap, ends every session but the caller's own.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'
process.env.SUPABASE_URL = 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'

let authed: string | null = 'user-1'
vi.mock('../_utils/auth', () => ({ getAuthUserId: vi.fn(async () => authed) }))
let signOutCalls: any[] = []
let signOutResult: { error: any } = { error: null }
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { admin: { signOut: (...a: any[]) => { signOutCalls.push(a); return Promise.resolve(signOutResult) } } } }),
}))
function makeRes() {
  const res: any = {}
  res.status = vi.fn((code: number) => { res._status = code; return res })
  res.json = vi.fn((body: unknown) => { res._json = body; return res })
  return res as VercelResponse & { _status?: number; _json?: any }
}
const req = (over: Partial<VercelRequest> = {}) => ({ method: 'POST', headers: { authorization: 'Bearer tok-1' }, body: {}, ...over }) as any as VercelRequest

describe('POST /api/auth/end-other-sessions', () => {
  let handler: typeof import('./end-other-sessions').default
  beforeEach(async () => { vi.resetModules(); signOutCalls = []; signOutResult = { error: null }; authed = 'user-1'; handler = (await import('./end-other-sessions')).default })

  it("ends the OTHER sessions with the caller's own token — scope 'others', never 'global'", async () => {
    const res = makeRes()
    await handler(req(), res)
    expect(res._status).toBe(200)
    expect(signOutCalls).toEqual([['tok-1', 'others']])
  })
  it('refuses without a session', async () => {
    authed = null
    const res = makeRes()
    await handler(req(), res)
    expect(res._status).toBe(401)
    expect(signOutCalls).toHaveLength(0)
  })
  it('reports a GoTrue failure plainly', async () => {
    signOutResult = { error: { message: 'nope' } }
    const res = makeRes()
    await handler(req(), res)
    expect(res._status).toBe(500)
  })
})
