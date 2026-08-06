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

const UUID = '11111111-2222-3333-4444-555555555555'

describe('per-clip versioned audio refs', () => {
  it('parses a bare uuid as "current revision"', async () => {
    const { parseAudioRef } = await import('./audioAccess')
    expect(parseAudioRef(UUID)).toEqual({ id: UUID, revision: null })
  })

  it('parses a versioned ref into id + revision', async () => {
    const { parseAudioRef } = await import('./audioAccess')
    expect(parseAudioRef(`${UUID}.v2`)).toEqual({ id: UUID, revision: 2 })
    expect(parseAudioRef(`${UUID}.v37`)).toEqual({ id: UUID, revision: 37 })
  })

  it('rejects malformed refs', async () => {
    const { parseAudioRef, isValidAudioId } = await import('./audioAccess')
    expect(parseAudioRef(`${UUID}.v0`)).toBeNull()
    expect(parseAudioRef(`${UUID}.v`)).toBeNull()
    expect(parseAudioRef(`${UUID}.vx`)).toBeNull()
    expect(parseAudioRef('not-a-uuid')).toBeNull()
    expect(isValidAudioId('not-a-uuid')).toBe(false)
  })

  it('accepts both bare and versioned refs as valid audio ids', async () => {
    const { isValidAudioId, isBareUuid } = await import('./audioAccess')
    expect(isValidAudioId(UUID)).toBe(true)
    expect(isValidAudioId(`${UUID}.v2`)).toBe(true)
    // The bare-uuid check stays strict for callers that need it.
    expect(isBareUuid(`${UUID}.v2`)).toBe(false)
    expect(isBareUuid(UUID)).toBe(true)
  })

  it('leaves revision 1 as a bare uuid so existing URLs and caches are untouched', async () => {
    const { buildAudioRef } = await import('./audioAccess')
    expect(buildAudioRef(UUID, 1)).toBe(UUID)
    expect(buildAudioRef(UUID, null)).toBe(UUID)
    expect(buildAudioRef(UUID, undefined)).toBe(UUID)
    expect(buildAudioRef(UUID, 2)).toBe(`${UUID}.v2`)
  })

  it('round-trips build → parse', async () => {
    const { buildAudioRef, parseAudioRef } = await import('./audioAccess')
    expect(parseAudioRef(buildAudioRef(UUID, 4))).toEqual({ id: UUID, revision: 4 })
  })
})

/** Minimal Supabase stub: only the `course_audio_revisions` select path. */
function revisionsStub(rows: unknown[]) {
  return {
    from: () => ({
      select: () => ({
        eq: () => Promise.resolve({ data: rows, error: null }),
      }),
    }),
  } as never
}

describe('resolveRevisionS3Key — old refs serve old bytes', () => {
  const LEDGER = [
    { revision: 2, previous_revision: 1, previous_s3_key: 'mastered/OLD.mp3', new_s3_key: 'repair-candidates/NEW.mp3' },
  ]

  it('short-circuits when the requested revision is already current', async () => {
    const { resolveRevisionS3Key } = await import('./audioAccess')
    const r = await resolveRevisionS3Key(revisionsStub([]), UUID, 2, 2, 'repair-candidates/NEW.mp3')
    expect(r).toEqual({ s3Key: 'repair-candidates/NEW.mp3', exact: true })
  })

  it('resolves a superseded revision to the key it used to point at', async () => {
    const { resolveRevisionS3Key } = await import('./audioAccess')
    const r = await resolveRevisionS3Key(revisionsStub(LEDGER), UUID, 1, 2, 'repair-candidates/NEW.mp3')
    // This is the free rollback: ref .v1 still serves the pre-repair bytes.
    expect(r).toEqual({ s3Key: 'mastered/OLD.mp3', exact: true })
  })

  it('resolves a revision to the key the swap that produced it wrote', async () => {
    const { resolveRevisionS3Key } = await import('./audioAccess')
    const r = await resolveRevisionS3Key(revisionsStub(LEDGER), UUID, 2, 3, 'mastered/NEWEST.mp3')
    expect(r).toEqual({ s3Key: 'repair-candidates/NEW.mp3', exact: true })
  })

  it('falls back to the current key rather than failing when the ledger cannot answer', async () => {
    const { resolveRevisionS3Key } = await import('./audioAccess')
    const r = await resolveRevisionS3Key(revisionsStub([]), UUID, 9, 2, 'mastered/CURRENT.mp3')
    // Always-play outranks exactness: a newest-good clip beats silence.
    expect(r).toEqual({ s3Key: 'mastered/CURRENT.mp3', exact: false })
  })
})

describe('applyAudioRef', () => {
  it('stamps revised ids and leaves unrevised ones alone', async () => {
    const { applyAudioRef } = await import('./audioAccess')
    const refs = new Map([[UUID, `${UUID}.v2`]])
    expect(applyAudioRef(refs, UUID)).toBe(`${UUID}.v2`)
    expect(applyAudioRef(refs, 'other-id')).toBe('other-id')
    expect(applyAudioRef(refs, null)).toBeNull()
    expect(applyAudioRef(refs, undefined)).toBeNull()
  })
})
