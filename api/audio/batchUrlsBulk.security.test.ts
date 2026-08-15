/**
 * SECURITY AUDIT 2026-08-11 — area 3 (input handling & injection).
 *
 * INPUT-01, the bulk shape: /api/audio/batch-urls took NO authentication at
 * all and handed back direct-to-S3 presigned URLs, 500 at a time. Combined
 * with the fail-open entitlement default that made the whole premium catalogue
 * retrievable by anyone who can enumerate audio uuids — and the uuids are
 * handed out freely by the unauthenticated /api/courses/:code/cycles route.
 *
 * FIXED 2026-08-11: premium past-preview ids now require a verified session
 * (or a valid entitlement token) on this endpoint, unconditionally — NOT via
 * `ENTITLEMENT_ENFORCE`, which is absent in production and defaults fail-open.
 * These tests lock that closed, prove free/preview content is unaffected, and
 * lock the input caps that bound the blast radius.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

const PREMIUM_IDS = Array.from(
  { length: 500 },
  (_, i) => `2222${String(i).padStart(4, '0')}-2222-2222-2222-222222222222`,
)

/** Premium course, but inside the free Yellow-belt preview (seed ≤ 19). */
const PREVIEW_ID = '33330000-3333-3333-3333-333333333333'
/** Community course — free on every belt. */
const FREE_ID = '44440000-4444-4444-4444-444444444444'

const courseAudioRows: Record<string, any> = {
  ...Object.fromEntries(
    PREMIUM_IDS.map((id, i) => [
      id,
      {
        id,
        s3_key: `mastered/premium-${i}.mp3`,
        duration_ms: 1000,
        course_code: 'fra_for_eng',
        lego_id: 'S0300L01',
      },
    ]),
  ),
  [PREVIEW_ID]: {
    id: PREVIEW_ID,
    s3_key: 'mastered/preview.mp3',
    duration_ms: 1000,
    course_code: 'fra_for_eng',
    lego_id: 'S0005L01',
  },
  [FREE_ID]: {
    id: FREE_ID,
    s3_key: 'mastered/free.mp3',
    duration_ms: 1000,
    course_code: 'community_cym_for_eng',
    lego_id: 'S0300L01',
  },
}

/** Stand-in for Supabase Auth: `Bearer good-session` is the only valid one. */
vi.mock('../_utils/auth', () => ({
  verifyAuthToken: (req: any) =>
    Promise.resolve(
      req?.headers?.authorization === 'Bearer good-session'
        ? { valid: true, userId: 'user-1' }
        : { valid: false, error: 'Missing or invalid Authorization header' },
    ),
}))

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
  getSignedUrl: (_c: unknown, cmd: { Key: string }, opts: { expiresIn: number }) =>
    Promise.resolve(`https://ssi-audio.s3.amazonaws.com/${cmd.Key}?X-Amz-Expires=${opts.expiresIn}`),
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => ({
      select: () => ({
        in: (_col: string, ids: string[]) =>
          Promise.resolve({
            data: table === 'course_audio' ? ids.map((id) => courseAudioRows[id]).filter(Boolean) : [],
            error: null,
          }),
      }),
    }),
  }),
}))

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
  res.end = vi.fn(() => res)
  return res as VercelResponse & { _status?: number; _json?: any }
}

/** Deliberately no Authorization header and no cookies — a bare internet caller. */
function anonymousReq(body: unknown): VercelRequest {
  return { method: 'POST', query: {}, headers: {}, cookies: {}, body } as unknown as VercelRequest
}

/** A signed-in learner: the offline downloader's real caller. */
function signedInReq(body: unknown): VercelRequest {
  return {
    method: 'POST',
    query: {},
    headers: { authorization: 'Bearer good-session' },
    cookies: {},
    body,
  } as unknown as VercelRequest
}

describe('POST /api/audio/batch-urls — unauthenticated bulk extraction (INPUT-01)', () => {
  let handler: typeof import('./batch-urls').default

  beforeEach(async () => {
    vi.resetModules()
    handler = (await import('./batch-urls')).default
  })

  // SECURITY FINDING INPUT-01 (FIXED): an anonymous caller used to receive
  // 500 presigned premium URLs per request — the paid catalogue in bulk. The
  // gate is now on unconditionally, NOT behind ENTITLEMENT_ENFORCE (note the
  // env var is deliberately empty in this suite: that is production's real
  // state, and the deny must hold anyway).
  it('INPUT-01: an anonymous caller is denied every premium past-preview id', async () => {
    const res = makeRes()
    await handler(anonymousReq({ audioIds: PREMIUM_IDS }), res)

    expect(res._status).toBe(200)
    const json = res._json as { urls: Record<string, string>; denied: string[]; ttlSeconds: number }
    expect(Object.keys(json.urls)).toHaveLength(0)
    expect(json.denied).toHaveLength(500)
  })

  it('INPUT-01: a verified session still gets its presigned URLs (no regression for real downloaders)', async () => {
    const res = makeRes()
    await handler(signedInReq({ audioIds: PREMIUM_IDS }), res)

    expect(res._status).toBe(200)
    const json = res._json as { urls: Record<string, string>; denied: string[] }
    expect(Object.keys(json.urls)).toHaveLength(500)
    expect(json.denied).toHaveLength(0)
    expect(json.urls[PREMIUM_IDS[0]]).toContain('X-Amz-Expires=300')
  })

  it('INPUT-01: free and preview content stays anonymous — guests lose nothing', async () => {
    const res = makeRes()
    await handler(anonymousReq({ audioIds: [FREE_ID, PREVIEW_ID, PREMIUM_IDS[0]] }), res)

    const json = res._json as { urls: Record<string, string>; denied: string[] }
    expect(Object.keys(json.urls).sort()).toEqual([FREE_ID, PREVIEW_ID].sort())
    expect(json.denied).toEqual([PREMIUM_IDS[0]])
  })

  // ── Input caps that DO hold, bounding the above ───────────────────────

  it('CONTROL: the 500-id cap is enforced, so one request cannot pull the whole course', async () => {
    const res = makeRes()
    await handler(anonymousReq({ audioIds: [...PREMIUM_IDS, PREMIUM_IDS[0]] }), res)
    expect(res._status).toBe(400)
  })

  it('CONTROL: a non-array audioIds is rejected, not coerced', async () => {
    for (const audioIds of ['a', 42, { 0: 'a' }, null]) {
      const res = makeRes()
      await handler(anonymousReq({ audioIds }), res)
      expect(res._status).toBe(400)
    }
  })

  it('CONTROL: a mixed-type array is rejected wholesale rather than partially processed', async () => {
    const res = makeRes()
    await handler(anonymousReq({ audioIds: [PREMIUM_IDS[0], 42, null] }), res)
    expect(res._status).toBe(400)
  })

  it('CONTROL: traversal-shaped ids are denied and never reach S3 key construction', async () => {
    const res = makeRes()
    await handler(
      signedInReq({ audioIds: ['../../etc/passwd', 'mastered/premium-0.mp3', PREMIUM_IDS[0]] }),
      res,
    )
    const json = res._json as { urls: Record<string, string>; denied: string[] }
    expect(json.denied).toContain('../../etc/passwd')
    expect(json.denied).toContain('mastered/premium-0.mp3')
    expect(Object.keys(json.urls)).toEqual([PREMIUM_IDS[0]])
  })

  it('CONTROL: presigned URLs are short-lived (300s), bounding a leaked link', async () => {
    const res = makeRes()
    await handler(signedInReq({ audioIds: [PREMIUM_IDS[0]] }), res)
    expect((res._json as { ttlSeconds: number }).ttlSeconds).toBe(300)
  })
})
