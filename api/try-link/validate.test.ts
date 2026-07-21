import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

// A valid, active, non-expiring try link the mocked DB returns.
const VALID_LINK = { id: 'link-1', code: 'TRYME', label: 'Try SSi', expires_at: null, is_active: true }

vi.mock('@supabase/supabase-js', () => {
  return {
    createClient: () => ({
      from: (table: string) => {
        if (table === 'try_links') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: () => Promise.resolve({ data: VALID_LINK, error: null }),
              }),
            }),
          }
        }
        // try_link_visits — insert(...).then(cb)
        return {
          insert: () => ({ then: (cb: (r: { error: null }) => void) => cb({ error: null }) }),
        }
      },
    }),
  }
})

function makeRes() {
  const res: Partial<VercelResponse> & { _status?: number; _json?: any } = {}
  res.status = vi.fn((code: number) => {
    res._status = code
    return res as VercelResponse
  })
  res.json = vi.fn((body: unknown) => {
    res._json = body
    return res as VercelResponse
  })
  return res as VercelResponse & { _status?: number; _json?: any }
}

function makeReq(overrides: Partial<VercelRequest>): VercelRequest {
  return { method: 'POST', query: {}, headers: {}, body: {}, ...overrides } as VercelRequest
}

const ORIG_ENV = { ...process.env }

describe('POST /api/try-link/validate — dedicated entitlement secret', () => {
  beforeEach(() => {
    vi.resetModules()
    process.env.VITE_SUPABASE_URL = 'https://example.supabase.co'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'
  })

  afterEach(() => {
    process.env = { ...ORIG_ENV }
  })

  it('fails CLOSED in production when ENTITLEMENT_TOKEN_SECRET is unset', async () => {
    process.env.VERCEL_ENV = 'production'
    delete process.env.ENTITLEMENT_TOKEN_SECRET
    vi.resetModules()
    const handler = (await import('./validate')).default

    const res = makeRes()
    await handler(makeReq({ body: { code: 'TRYME' } }), res)
    expect(res._status).toBe(500)
    expect((res._json as { error: string }).error).toMatch(/ENTITLEMENT_TOKEN_SECRET/)
  })

  it('mints a token that the audio proxy verify side accepts (mint/verify agree)', async () => {
    delete process.env.VERCEL_ENV
    process.env.NODE_ENV = 'test'
    const SECRET = 'shared-entitlement-secret'
    process.env.ENTITLEMENT_TOKEN_SECRET = SECRET
    vi.resetModules()

    const handler = (await import('./validate')).default
    const res = makeRes()
    await handler(makeReq({ body: { code: 'TRYME' } }), res)

    expect(res._status).toBe(200)
    const token = (res._json as { entitlementToken: string | null }).entitlementToken
    expect(token).toBeTruthy()

    // Cross-file round trip: the verify side (audioAccess) reads the SAME env
    // var and must accept the freshly minted token.
    vi.doMock('@aws-sdk/client-s3', () => ({ S3Client: class {}, GetObjectCommand: class {} }))
    const { verifyEntitlementToken } = await import('../_utils/audioAccess')
    const payload = verifyEntitlementToken(token as string)
    expect(payload).not.toBeNull()
    expect(payload?.scope).toBe('all')
  })
})
