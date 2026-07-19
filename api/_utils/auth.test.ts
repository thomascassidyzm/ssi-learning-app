/**
 * Tests for verifyAuthToken (api/_utils/auth.ts) — the single GoTrue
 * verification point every server-mediated endpoint goes through.
 *
 * FABLE incident 2 (2026-07-18): a session revoked elsewhere (global
 * sign-out on another device) leaves the browser sending a well-signed,
 * unexpired token; GoTrue answers session_not_found, which supabase-js
 * surfaces as AuthSessionMissingError ("Auth session missing!") — and that
 * string landed raw in the admin UI's error banner. The mapping test pins
 * the plain-words replacement.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest } from '@vercel/node'

process.env.SUPABASE_URL = 'https://example.supabase.co'
process.env.SUPABASE_ANON_KEY = 'anon-key'

let getUserResult: any
let learnerResult: any
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    auth: { getUser: vi.fn(async () => getUserResult) },
    // Minimal PostgREST chain for verifyAdmin's learners lookup:
    // from('learners').select(...).eq(...).single() -> learnerResult
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(async () => learnerResult),
        })),
      })),
    })),
  })),
}))

const { verifyAuthToken, verifyAdmin } = await import('./auth')

function makeReq(authorization?: string): VercelRequest {
  return { headers: authorization ? { authorization } : {} } as VercelRequest
}

beforeEach(() => {
  getUserResult = { data: { user: null }, error: null }
  learnerResult = { data: null, error: null }
})

describe('verifyAuthToken', () => {
  it('rejects a request with no Authorization header', async () => {
    const result = await verifyAuthToken(makeReq())
    expect(result.valid).toBe(false)
    expect(result.error).toBe('Missing or invalid Authorization header')
  })

  it('accepts a token GoTrue verifies, returning the user id', async () => {
    getUserResult = { data: { user: { id: 'user-1' } }, error: null }
    const result = await verifyAuthToken(makeReq('Bearer good-token'))
    expect(result).toEqual({ valid: true, userId: 'user-1' })
  })

  it('maps a revoked session (AuthSessionMissingError) to a plain actionable message', async () => {
    getUserResult = {
      data: { user: null },
      error: { name: 'AuthSessionMissingError', message: 'Auth session missing!' },
    }
    const result = await verifyAuthToken(makeReq('Bearer revoked-session-token'))
    expect(result.valid).toBe(false)
    expect(result.error).toBe('Your session has ended — sign in again')
  })

  it('passes other GoTrue errors through unchanged (e.g. malformed JWT)', async () => {
    getUserResult = {
      data: { user: null },
      error: { name: 'AuthApiError', message: 'invalid JWT: token is malformed' },
    }
    const result = await verifyAuthToken(makeReq('Bearer garbage'))
    expect(result.valid).toBe(false)
    expect(result.error).toBe('invalid JWT: token is malformed')
  })
})

/**
 * verifyAdmin re-reads learners.platform_role/educational_role on EVERY call,
 * from the caller's own token. This is the sole per-request admin enforcement
 * that made removing the client 60s role poll safe (commit 4a17a767): a
 * de-platformed ssi_admin's next request 403s regardless of client state.
 * Proven live 2026-07-19 (throwaway persona: 200 as admin -> revoke row ->
 * 403 with the SAME token). These pins guard that logic against regression.
 */
describe('verifyAdmin', () => {
  it('401s when the token is not a valid session', async () => {
    getUserResult = { data: { user: null }, error: { name: 'AuthApiError', message: 'bad' } }
    const result = await verifyAdmin(makeReq('Bearer garbage'))
    expect(result).toEqual({ error: 'bad', status: 401 })
  })

  it('admits an ssi_admin, returning the user id', async () => {
    getUserResult = { data: { user: { id: 'admin-1' } }, error: null }
    learnerResult = { data: { platform_role: 'ssi_admin', educational_role: null }, error: null }
    const result = await verifyAdmin(makeReq('Bearer good-token'))
    expect(result).toEqual({ userId: 'admin-1' })
  })

  it('admits an educational_role=god caller', async () => {
    getUserResult = { data: { user: { id: 'god-1' } }, error: null }
    learnerResult = { data: { platform_role: null, educational_role: 'god' }, error: null }
    const result = await verifyAdmin(makeReq('Bearer good-token'))
    expect(result).toEqual({ userId: 'god-1' })
  })

  it('403s a REVOKED admin — role stripped in the DB, same still-valid token', async () => {
    getUserResult = { data: { user: { id: 'was-admin' } }, error: null }
    // The exact live scenario: the token still verifies, but the learners row
    // no longer carries an admin role.
    learnerResult = { data: { platform_role: null, educational_role: null }, error: null }
    const result = await verifyAdmin(makeReq('Bearer still-valid-token'))
    expect(result).toEqual({ error: 'Requires SSi admin access', status: 403 })
  })

  it('403s when the caller has no learner row (PGRST116)', async () => {
    getUserResult = { data: { user: { id: 'ghost' } }, error: null }
    learnerResult = { data: null, error: { code: 'PGRST116' } }
    const result = await verifyAdmin(makeReq('Bearer good-token'))
    expect(result).toEqual({ error: 'Requires SSi admin access', status: 403 })
  })

  it('500s (never silently denies) on a transient lookup error — no false lockout', async () => {
    getUserResult = { data: { user: { id: 'admin-1' } }, error: null }
    learnerResult = { data: null, error: { code: 'XX000', message: 'db blip' } }
    const result = await verifyAdmin(makeReq('Bearer good-token'))
    expect(result).toEqual({ error: 'Admin verification failed', status: 500 })
  })
})
