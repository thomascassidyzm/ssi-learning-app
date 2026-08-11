/**
 * SECURITY AUDIT 2026-08-11 — area 3 (input handling & injection).
 *
 * /api/audio/:audioId is an unauthenticated endpoint whose path segment ends
 * up naming an S3 object. This file locks the controls that stop the segment
 * from ever reaching the S3 key, and characterizes the error-body disclosure
 * and the fail-open entitlement default.
 *
 * Findings: INPUT-01 (entitlement fail-open), INPUT-08 (S3 key + raw S3 error
 * in the 502 body).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

const FREE_ID = '11111111-1111-1111-1111-111111111111'
const PREMIUM_PAST_PREVIEW_ID = '22222222-2222-2222-2222-222222222222'
const S3_FAILS_ID = '66666666-6666-6666-6666-666666666666'

const courseAudioRows: Record<string, any> = {
  [FREE_ID]: {
    id: FREE_ID,
    s3_key: 'mastered/free.mp3',
    duration_ms: 1000,
    course_code: 'community_toki_for_eng',
    lego_id: 'S0001L01',
  },
  [PREMIUM_PAST_PREVIEW_ID]: {
    id: PREMIUM_PAST_PREVIEW_ID,
    s3_key: 'mastered/premium.mp3',
    duration_ms: 1000,
    course_code: 'fra_for_eng',
    lego_id: 'S0025L01',
  },
  [S3_FAILS_ID]: {
    id: S3_FAILS_ID,
    s3_key: 'mastered/private-bucket-path/secret.mp3',
    duration_ms: 1000,
    course_code: 'community_toki_for_eng',
    lego_id: 'S0001L01',
  },
}

/** Every GetObjectCommand the handler builds, so the S3 Key is observable. */
let s3Commands: { Bucket: string; Key: string; Range?: string }[] = []
/** Every id the handler actually asked the DB for. */
let queriedIds: string[] = []

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class {
    send(cmd: any) {
      if (cmd.Key.includes('private-bucket-path')) {
        const err: any = new Error('Access Denied for arn:aws:s3:::ssi-audio-prod/mastered/private-bucket-path')
        err.Code = 'AccessDenied'
        return Promise.reject(err)
      }
      return Promise.resolve({
        ContentType: 'audio/mpeg',
        ContentLength: 4,
        Body: { transformToByteArray: () => Promise.resolve(new Uint8Array([1, 2, 3, 4])) },
      })
    }
  },
  GetObjectCommand: class {
    Bucket: string
    Key: string
    Range?: string
    constructor(opts: { Bucket: string; Key: string; Range?: string }) {
      this.Bucket = opts.Bucket
      this.Key = opts.Key
      this.Range = opts.Range
      s3Commands.push(opts)
    }
  },
}))

vi.mock('@supabase/supabase-js', () => {
  function makeQuery(table: string): any {
    return {
      select: () => ({
        eq: (_col: string, id: string) => {
          queriedIds.push(id)
          return {
            maybeSingle: () =>
              Promise.resolve({
                data: table === 'course_audio' ? courseAudioRows[id] || null : null,
                error: null,
              }),
          }
        },
      }),
    }
  }
  return { createClient: () => ({ from: (t: string) => makeQuery(t) }) }
})

process.env.SUPABASE_URL = 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'
process.env.S3_AUDIO_BUCKET = 'ssi-audio-test'
process.env.AWS_ACCESS_KEY_ID = 'test'
process.env.AWS_SECRET_ACCESS_KEY = 'test'
process.env.ENTITLEMENT_ENFORCE = ''

function makeRes() {
  const res: any = { _headers: {} }
  res.setHeader = vi.fn((k: string, v: string) => {
    res._headers[k] = v
    return res
  })
  res.status = vi.fn((code: number) => {
    res._status = code
    return res
  })
  res.json = vi.fn((body: unknown) => {
    res._json = body
    return res
  })
  res.send = vi.fn((body: unknown) => {
    res._body = body
    return res
  })
  res.end = vi.fn(() => res)
  return res as VercelResponse & { _status?: number; _json?: any; _body?: any; _headers: Record<string, string> }
}

function makeReq(overrides: Partial<VercelRequest>): VercelRequest {
  return { method: 'GET', query: {}, headers: {}, body: {}, ...overrides } as VercelRequest
}

describe('GET /api/audio/:audioId — path traversal & key handling', () => {
  let handler: typeof import('./[audioId]').default

  beforeEach(async () => {
    s3Commands = []
    queriedIds = []
    vi.resetModules()
    handler = (await import('./[audioId]')).default
  })

  // ── Controls that HOLD ────────────────────────────────────────────────

  it.each([
    '../../../etc/passwd',
    'mastered/../../secret.mp3',
    '%2e%2e%2fetc%2fpasswd',
    '11111111-1111-1111-1111-111111111111/../other',
    '11111111-1111-1111-1111-111111111111%00.mp3',
    '11111111-1111-1111-1111-111111111111.v1e9',
  ])('CONTROL: rejects traversal/malformed audioId %s with 400 and never touches S3', async (audioId) => {
    const res = makeRes()
    await handler(makeReq({ query: { audioId } }), res)
    expect(res._status).toBe(400)
    expect(s3Commands).toHaveLength(0)
    expect(queriedIds).toHaveLength(0)
  })

  it('CONTROL: rejects an array audioId (?audioId=a&audioId=b) rather than coercing it', async () => {
    const res = makeRes()
    await handler(makeReq({ query: { audioId: [FREE_ID, FREE_ID] as any } }), res)
    expect(res._status).toBe(400)
  })

  it('CONTROL: the S3 Key comes from the DB row, never from the request', async () => {
    const res = makeRes()
    await handler(makeReq({ query: { audioId: FREE_ID } }), res)
    expect(res._status).not.toBe(400)
    expect(s3Commands).toHaveLength(1)
    expect(s3Commands[0].Key).toBe('mastered/free.mp3')
    expect(s3Commands[0].Bucket).toBe('ssi-audio-test')
  })

  it('CONTROL: a versioned ref resolves to the bare uuid for the DB lookup', async () => {
    const res = makeRes()
    await handler(makeReq({ query: { audioId: `${FREE_ID}.v3` } }), res)
    expect(queriedIds).toContain(FREE_ID)
    expect(res._status).not.toBe(400)
  })

  it('CONTROL: the Range header is forwarded verbatim to S3 and cannot alter the Key', async () => {
    const res = makeRes()
    await handler(makeReq({ query: { audioId: FREE_ID }, headers: { range: 'bytes=0-1' } }), res)
    expect(s3Commands[0].Range).toBe('bytes=0-1')
    expect(s3Commands[0].Key).toBe('mastered/free.mp3')
  })

  // ── Findings ──────────────────────────────────────────────────────────

  // SECURITY FINDING INPUT-08: the 502 branch echoes the internal S3 object key
  // and the raw S3 error message back to an unauthenticated caller
  // (api/audio/[audioId].ts:211-215). The AWS message can carry the bucket ARN
  // and the key prefix layout. It should return a generic body and keep the
  // detail in the server log, which the same handler already does correctly for
  // the 500 branch at line 221.
  it('INPUT-08: the 502 body leaks the S3 key and the raw S3 error (vulnerable, characterized)', async () => {
    const res = makeRes()
    await handler(makeReq({ query: { audioId: S3_FAILS_ID } }), res)

    expect(res._status).toBe(502)
    expect(res._json.key).toBe('mastered/private-bucket-path/secret.mp3')
    expect(res._json.details).toContain('arn:aws:s3:::ssi-audio-prod')
  })

  it.todo('INPUT-08: the audio proxy 502 should return a generic body and log the key/error server-side only')

  // SECURITY FINDING INPUT-01: the entitlement gate defaults to fail-OPEN
  // (api/_utils/audioAccess.ts:408, 538-543 — ENTITLEMENT_ENFORCE must equal
  // 'strict' to deny). So premium past-preview audio is served to an
  // unauthenticated caller with no token at all; the only trace is the
  // X-SSi-Entitlement observability header. This is deliberate and documented,
  // but it means the paid catalogue is world-readable to anyone who can
  // enumerate audio uuids. Arming strict mode is the fix; the tag header shows
  // when coverage is good enough to do so.
  it('INPUT-01: premium past-preview audio is served with no entitlement token (fail-open, characterized)', async () => {
    const res = makeRes()
    await handler(makeReq({ query: { audioId: PREMIUM_PAST_PREVIEW_ID } }), res)

    expect(res._status).not.toBe(403)
    expect(res._headers['X-SSi-Entitlement']).toBe('no-token-open')
    expect(s3Commands[0].Key).toBe('mastered/premium.mp3')
  })

  it.todo('INPUT-01: arm ENTITLEMENT_ENFORCE=strict once client token coverage is proven by the X-SSi-Entitlement tag')

  it('CONTROL: strict mode does deny premium past-preview audio with no token', async () => {
    process.env.ENTITLEMENT_ENFORCE = 'strict'
    vi.resetModules()
    const h = (await import('./[audioId]')).default

    const res = makeRes()
    await h(makeReq({ query: { audioId: PREMIUM_PAST_PREVIEW_ID } }), res)
    expect(res._status).toBe(403)
    expect(s3Commands).toHaveLength(0)

    process.env.ENTITLEMENT_ENFORCE = ''
  })

  it('CONTROL: a forged entitlement token does not unlock premium content in strict mode', async () => {
    process.env.ENTITLEMENT_ENFORCE = 'strict'
    process.env.ENTITLEMENT_TOKEN_SECRET = 'test-secret'
    vi.resetModules()
    const h = (await import('./[audioId]')).default

    const forged = `${Buffer.from(JSON.stringify({ scope: 'all' })).toString('base64url')}.${Buffer.from(
      'not-a-real-signature',
    ).toString('base64url')}`
    const res = makeRes()
    await h(makeReq({ query: { audioId: PREMIUM_PAST_PREVIEW_ID, et: forged } }), res)
    expect(res._status).toBe(403)

    process.env.ENTITLEMENT_ENFORCE = ''
    delete process.env.ENTITLEMENT_TOKEN_SECRET
  })
})
