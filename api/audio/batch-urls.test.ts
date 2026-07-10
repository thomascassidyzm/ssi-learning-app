import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

const FREE_ID = '11111111-1111-1111-1111-111111111111'
const PREMIUM_PAST_PREVIEW_ID = '22222222-2222-2222-2222-222222222222'
const SHARED_ID = '33333333-3333-3333-3333-333333333333'
const MISSING_ID = '44444444-4444-4444-4444-444444444444'
const BAD_SHAPE_ID = '55555555-5555-5555-5555-555555555555'

const courseAudioRows: Record<string, any> = {
  [FREE_ID]: { id: FREE_ID, s3_key: 'k/free.mp3', duration_ms: 1000, course_code: 'community_toki_for_eng', lego_id: 'S0001L01' },
  [PREMIUM_PAST_PREVIEW_ID]: {
    id: PREMIUM_PAST_PREVIEW_ID,
    s3_key: 'k/premium.mp3',
    duration_ms: 1000,
    course_code: 'fra_for_eng',
    lego_id: 'S0025L01',
  },
  [BAD_SHAPE_ID]: { id: BAD_SHAPE_ID, s3_key: '', duration_ms: 1000, course_code: 'community_toki_for_eng', lego_id: 'S0001L01' },
}
const sharedAudioRows: Record<string, any> = {
  [SHARED_ID]: { id: SHARED_ID, s3_key: 'k/shared.mp3', duration_ms: 500 },
}

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class {
    send() {
      return Promise.resolve({})
    }
  },
  GetObjectCommand: class {
    Bucket: string
    Key: string
    constructor(opts: { Bucket: string; Key: string }) {
      this.Bucket = opts.Bucket
      this.Key = opts.Key
    }
  },
}))

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: (_client: unknown, command: { Key: string }, opts: { expiresIn: number }) =>
    Promise.resolve(`https://s3.example.com/${command.Key}?ttl=${opts.expiresIn}`),
}))

// supabase-js chains select().in() — both must return promise-resolving thenables.
vi.mock('@supabase/supabase-js', () => {
  function makeQuery(table: string) {
    return {
      select: () => ({
        in: (_col: string, ids: string[]) => {
          const source = table === 'course_audio' ? courseAudioRows : sharedAudioRows
          const data = ids.map((id) => source[id]).filter(Boolean)
          return Promise.resolve({ data, error: null })
        },
      }),
    }
  }
  return {
    createClient: () => ({
      from: (table: string) => makeQuery(table),
    }),
  }
})

process.env.SUPABASE_URL = 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'
process.env.S3_AUDIO_BUCKET = 'ssi-audio-test'
process.env.AWS_ACCESS_KEY_ID = 'test'
process.env.AWS_SECRET_ACCESS_KEY = 'test'
process.env.ENTITLEMENT_ENFORCE = ''

function makeRes() {
  const res: Partial<VercelResponse> & { _status?: number; _json?: unknown; _headers: Record<string, string> } = {
    _headers: {},
  }
  res.setHeader = vi.fn((k: string, v: string) => {
    res._headers[k] = v
    return res as VercelResponse
  })
  res.status = vi.fn((code: number) => {
    res._status = code
    return res as VercelResponse
  })
  res.json = vi.fn((body: unknown) => {
    res._json = body
    return res as VercelResponse
  })
  res.end = vi.fn(() => res as VercelResponse)
  return res as VercelResponse & { _status?: number; _json?: any; _headers: Record<string, string> }
}

function makeReq(overrides: Partial<VercelRequest>): VercelRequest {
  return {
    method: 'POST',
    query: {},
    headers: {},
    body: {},
    ...overrides,
  } as VercelRequest
}

describe('POST /api/audio/batch-urls', () => {
  let handler: typeof import('./batch-urls').default

  beforeEach(async () => {
    vi.resetModules()
    handler = (await import('./batch-urls')).default
  })

  it('rejects non-POST methods', async () => {
    const res = makeRes()
    await handler(makeReq({ method: 'GET' }), res)
    expect(res._status).toBe(405)
  })

  it('handles OPTIONS preflight with CORS headers', async () => {
    const res = makeRes()
    await handler(makeReq({ method: 'OPTIONS' }), res)
    expect(res._status).toBe(204)
    expect(res._headers['Access-Control-Allow-Methods']).toContain('POST')
  })

  it('rejects a missing/empty audioIds body', async () => {
    const res = makeRes()
    await handler(makeReq({ body: {} }), res)
    expect(res._status).toBe(400)
  })

  it('rejects a batch over the 500-id cap', async () => {
    const res = makeRes()
    const audioIds = Array.from({ length: 501 }, () => FREE_ID)
    await handler(makeReq({ body: { audioIds } }), res)
    expect(res._status).toBe(400)
  })

  it('returns presigned urls for free-course and shared audio, denies malformed ids', async () => {
    const res = makeRes()
    await handler(makeReq({ body: { audioIds: [FREE_ID, SHARED_ID, 'not-a-uuid'] } }), res)

    expect(res._status).toBe(200)
    const json = res._json as { urls: Record<string, string>; denied: string[]; ttlSeconds: number }
    expect(json.urls[FREE_ID]).toContain('k/free.mp3')
    expect(json.urls[SHARED_ID]).toContain('k/shared.mp3')
    expect(json.denied).toContain('not-a-uuid')
    expect(json.ttlSeconds).toBe(300)
  })

  it('denies ids not found in either table', async () => {
    const res = makeRes()
    await handler(makeReq({ body: { audioIds: [MISSING_ID] } }), res)
    const json = res._json as { urls: Record<string, string>; denied: string[] }
    expect(json.urls[MISSING_ID]).toBeUndefined()
    expect(json.denied).toContain(MISSING_ID)
  })

  it('denies rows that fail shape validation', async () => {
    const res = makeRes()
    await handler(makeReq({ body: { audioIds: [BAD_SHAPE_ID] } }), res)
    const json = res._json as { urls: Record<string, string>; denied: string[] }
    expect(json.urls[BAD_SHAPE_ID]).toBeUndefined()
    expect(json.denied).toContain(BAD_SHAPE_ID)
  })

  it('fail-open (default): premium past-preview audio with no entitlement token still gets a url', async () => {
    const res = makeRes()
    await handler(makeReq({ body: { audioIds: [PREMIUM_PAST_PREVIEW_ID] } }), res)
    const json = res._json as { urls: Record<string, string>; denied: string[] }
    expect(json.urls[PREMIUM_PAST_PREVIEW_ID]).toBeDefined()
    expect(json.denied).not.toContain(PREMIUM_PAST_PREVIEW_ID)
  })

  it('strict mode: premium past-preview audio with no entitlement token is denied', async () => {
    process.env.ENTITLEMENT_ENFORCE = 'strict'
    vi.resetModules()
    handler = (await import('./batch-urls')).default

    const res = makeRes()
    await handler(makeReq({ body: { audioIds: [PREMIUM_PAST_PREVIEW_ID, FREE_ID] } }), res)
    const json = res._json as { urls: Record<string, string>; denied: string[] }
    expect(json.denied).toContain(PREMIUM_PAST_PREVIEW_ID)
    expect(json.urls[FREE_ID]).toBeDefined()

    process.env.ENTITLEMENT_ENFORCE = ''
  })
})
