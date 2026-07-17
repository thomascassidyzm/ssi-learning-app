import { describe, it, expect, vi } from 'vitest'
import { createHmac } from 'crypto'

// audioAccess.ts constructs an S3Client at module load; keep it inert.
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class {},
  GetObjectCommand: class {},
}))
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({}),
}))

// audioAccess.ts requires a Supabase URL at module load.
process.env.SUPABASE_URL = 'https://example.supabase.co'
process.env.VITE_SUPABASE_URL = 'https://example.supabase.co'

// MUST be set before importing the module — the secret is read at module load.
const SECRET = 'test-entitlement-secret-round-trip'
process.env.ENTITLEMENT_TOKEN_SECRET = SECRET
// Ensure the module does not silently pick up the old service-role fallback.
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-should-not-be-used-for-signing'

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// Mirror api/try-link/validate.ts's mint exactly, so this test proves the mint
// and verify sides agree on secret + format.
function mint(secret: string, payloadObj: Record<string, unknown>): string {
  const payload = b64url(Buffer.from(JSON.stringify(payloadObj)))
  const sig = b64url(createHmac('sha256', secret).update(payload).digest())
  return `${payload}.${sig}`
}

describe('audioAccess entitlement token (dedicated secret)', () => {
  it('round-trips: a token minted with ENTITLEMENT_TOKEN_SECRET verifies', async () => {
    const { verifyEntitlementToken } = await import('./audioAccess')
    const token = mint(SECRET, { kind: 'try', scope: 'all', exp: Date.now() + 60_000 })
    const payload = verifyEntitlementToken(token)
    expect(payload).not.toBeNull()
    expect(payload?.scope).toBe('all')
  })

  it('rejects a token signed with the service-role key (no silent fallback)', async () => {
    const { verifyEntitlementToken } = await import('./audioAccess')
    const token = mint('service-role-should-not-be-used-for-signing', {
      scope: 'all',
      exp: Date.now() + 60_000,
    })
    expect(verifyEntitlementToken(token)).toBeNull()
  })

  it('rejects a tampered signature', async () => {
    const { verifyEntitlementToken } = await import('./audioAccess')
    const token = mint(SECRET, { scope: 'all', exp: Date.now() + 60_000 })
    const [payload] = token.split('.')
    expect(verifyEntitlementToken(`${payload}.AAAA`)).toBeNull()
  })

  it('rejects an expired token', async () => {
    const { verifyEntitlementToken } = await import('./audioAccess')
    const token = mint(SECRET, { scope: 'all', exp: Date.now() - 1 })
    expect(verifyEntitlementToken(token)).toBeNull()
  })
})
