/**
 * SECURITY AUDIT 2026-08-11 — area 1 (auth & identity core).
 *
 * AUTH-CORE-12: the CALLER CONTRACT of api/_utils/auth.ts. auth.test.ts already
 * pins verifyAdmin's own decisions; this file pins the three properties that
 * every CALLER depends on and that a refactor could quietly break:
 *
 *   1. verifyAuthToken never trusts the token's own claims — it hands the
 *      bearer to GoTrue under the ANON key and believes only getUser()'s
 *      answer. No service-role client is constructed on the verification path,
 *      so a forged/expired JWT cannot be laundered into a privileged client.
 *   2. verifyAdmin re-reads the role under the CALLER's token (RLS applies),
 *      not the service role.
 *   3. verifyAdmin's 403 result deliberately carries `userId` so dual-door
 *      endpoints can reuse the verified uid. That makes `if (result.userId)` a
 *      FOOTGUN: it admits a rejected non-admin. The one correct check is
 *      `if ('error' in result)`. Every live call site uses that form; this test
 *      makes the trap executable so it stays that way.
 *
 * Full write-up: docs/security-audit-2026-08-11/auth-core.md
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest } from '@vercel/node'

process.env.VITE_SUPABASE_URL = 'https://example.supabase.co'
process.env.SUPABASE_URL = 'https://example.supabase.co'
process.env.VITE_SUPABASE_ANON_KEY = 'the-anon-key'
process.env.SUPABASE_ANON_KEY = 'the-anon-key'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'the-service-role-key'

let getUserResult: any
let learnerResult: any
/** Every (key, forwarded Authorization) pair auth.ts constructed a client with. */
let clientsCreated: Array<{ key: string; authorization?: string }>

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn((_url: string, key: string, opts?: any) => {
    clientsCreated.push({ key, authorization: opts?.global?.headers?.Authorization })
    return {
      auth: { getUser: vi.fn(async () => getUserResult) },
      from: vi.fn(() => ({
        select: vi.fn(() => ({ eq: vi.fn(() => ({ single: vi.fn(async () => learnerResult) })) })),
      })),
    }
  }),
}))

function makeReq(authorization?: string): VercelRequest {
  return { headers: authorization ? { authorization } : {} } as VercelRequest
}

let verifyAuthToken: typeof import('./auth').verifyAuthToken
let verifyAdmin: typeof import('./auth').verifyAdmin

beforeEach(async () => {
  vi.resetModules()
  clientsCreated = []
  getUserResult = { data: { user: null }, error: null }
  learnerResult = { data: null, error: null }
  const mod = await import('./auth')
  verifyAuthToken = mod.verifyAuthToken
  verifyAdmin = mod.verifyAdmin
})

describe('AUTH-CORE-12 — verifyAuthToken is a real server-side verification', () => {
  // Control that HOLDS: the caller's bearer is forwarded to GoTrue under the
  // ANON key. Nothing here parses or trusts the JWT locally.
  it('CONTROL: verifies under the anon key, forwarding the caller\'s bearer, never the service role', async () => {
    getUserResult = { data: { user: { id: 'user-1' } }, error: null }
    const result = await verifyAuthToken(makeReq('Bearer caller-token'))

    expect(result).toEqual({ valid: true, userId: 'user-1' })
    expect(clientsCreated).toEqual([{ key: 'the-anon-key', authorization: 'Bearer caller-token' }])
    expect(clientsCreated.some((c) => c.key === 'the-service-role-key')).toBe(false)
  })

  // Control that HOLDS: no Authorization header means no GoTrue round trip at
  // all — the endpoint cannot be tricked into an anonymous "valid" result.
  it('CONTROL: a missing bearer short-circuits before any client is built', async () => {
    const result = await verifyAuthToken(makeReq())
    expect(result.valid).toBe(false)
    expect(clientsCreated).toHaveLength(0)
  })

  // Control that HOLDS: `Bearer ` with nothing after it is rejected, not sent
  // on as an empty token.
  it('CONTROL: an empty bearer is rejected without a GoTrue round trip', async () => {
    const result = await verifyAuthToken(makeReq('Bearer '))
    expect(result).toEqual({ valid: false, error: 'Empty token' })
    expect(clientsCreated).toHaveLength(0)
  })

  // Control that HOLDS: a non-Bearer scheme never reaches GoTrue. In
  // particular, presenting the service-role key as an apikey-style credential
  // is not a login.
  it('CONTROL: a non-Bearer Authorization scheme is rejected outright', async () => {
    const result = await verifyAuthToken(makeReq('the-service-role-key'))
    expect(result).toEqual({ valid: false, error: 'Missing or invalid Authorization header' })
    expect(clientsCreated).toHaveLength(0)
  })
})

describe('AUTH-CORE-12 — verifyAdmin caller contract', () => {
  // Control that HOLDS: the role re-read runs under the CALLER's token, so RLS
  // scopes it to their own learners row. A service-role read here would let a
  // future predicate bug read someone else's role.
  it('CONTROL: re-reads the role under the caller\'s own token, not the service role', async () => {
    getUserResult = { data: { user: { id: 'admin-1' } }, error: null }
    learnerResult = { data: { platform_role: 'ssi_admin', educational_role: null }, error: null }

    await verifyAdmin(makeReq('Bearer admin-token'))

    expect(clientsCreated.every((c) => c.key === 'the-anon-key')).toBe(true)
    expect(clientsCreated.every((c) => c.authorization === 'Bearer admin-token')).toBe(true)
  })

  // SECURITY FINDING AUTH-CORE-12 (contract footgun, no live instance found):
  // a rejected non-admin comes back with BOTH `error`/`status: 403` AND a
  // populated `userId`. Any caller that gates on the presence of `userId`
  // instead of `'error' in result` admits them. All 30-odd live call sites use
  // the `'error' in result` form (grepped 2026-08-11); this locks the shape so
  // a future caller can see the trap in a test rather than in production.
  it('CHARACTERIZATION: a 403 result still carries userId — only `\'error\' in result` is a safe check', async () => {
    getUserResult = { data: { user: { id: 'plain-user' } }, error: null }
    learnerResult = { data: { platform_role: null, educational_role: null }, error: null }

    const result = await verifyAdmin(makeReq('Bearer plain-user-token'))

    // The correct check refuses.
    expect('error' in result).toBe(true)
    // The tempting one does not.
    expect((result as { userId?: string }).userId).toBe('plain-user')
  })

  // Control that HOLDS: the 401 path (bad token) carries NO userId, so even the
  // footgun check cannot be reached without a verified session.
  it('CONTROL: the 401 path carries no userId at all', async () => {
    getUserResult = { data: { user: null }, error: { name: 'AuthApiError', message: 'invalid JWT' } }
    const result = await verifyAdmin(makeReq('Bearer garbage'))
    expect(result).toEqual({ error: 'invalid JWT', status: 401 })
    expect((result as { userId?: string }).userId).toBeUndefined()
  })

  it.todo('AUTH-CORE-12: verifyAdmin returns a discriminated union whose non-admin branch cannot be mistaken for success')
})
