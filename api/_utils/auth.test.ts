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
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    auth: { getUser: vi.fn(async () => getUserResult) },
  })),
}))

const { verifyAuthToken } = await import('./auth')

function makeReq(authorization?: string): VercelRequest {
  return { headers: authorization ? { authorization } : {} } as VercelRequest
}

beforeEach(() => {
  getUserResult = { data: { user: null }, error: null }
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
