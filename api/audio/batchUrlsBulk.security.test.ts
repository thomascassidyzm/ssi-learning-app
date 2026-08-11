/**
 * SECURITY AUDIT 2026-08-11 — area 3 (input handling & injection).
 *
 * INPUT-01, the bulk shape: /api/audio/batch-urls takes NO authentication at
 * all and hands back direct-to-S3 presigned URLs, 500 at a time. Combined with
 * the fail-open entitlement default that makes the whole premium catalogue
 * retrievable by anyone who can enumerate audio uuids — and the uuids are
 * handed out freely by the unauthenticated /api/courses/:code/cycles route.
 *
 * These tests characterize that reachability and lock the input caps that
 * bound it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

const PREMIUM_IDS = Array.from(
  { length: 500 },
  (_, i) => `2222${String(i).padStart(4, '0')}-2222-2222-2222-222222222222`,
)

const courseAudioRows: Record<string, any> = Object.fromEntries(
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
)

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

describe('POST /api/audio/batch-urls — unauthenticated bulk extraction (INPUT-01)', () => {
  let handler: typeof import('./batch-urls').default

  beforeEach(async () => {
    vi.resetModules()
    handler = (await import('./batch-urls')).default
  })

  // SECURITY FINDING INPUT-01: no authentication is required, and with the
  // default (non-strict) entitlement posture every premium past-preview clip
  // is granted a presigned S3 URL. 500 direct-download URLs per request, from
  // an anonymous caller, is the paid catalogue in bulk. What should happen
  // instead: premium past-preview ids require a valid entitlement token
  // (ENTITLEMENT_ENFORCE=strict), and this endpoint — which exists to serve
  // signed-in offline downloaders — should require a verified session
  // regardless of the strict flag.
  it('INPUT-01: an anonymous caller gets 500 presigned premium URLs in one request (vulnerable, characterized)', async () => {
    const res = makeRes()
    await handler(anonymousReq({ audioIds: PREMIUM_IDS }), res)

    expect(res._status).toBe(200)
    const json = res._json as { urls: Record<string, string>; denied: string[]; ttlSeconds: number }
    expect(Object.keys(json.urls)).toHaveLength(500)
    expect(json.denied).toHaveLength(0)
    expect(json.urls[PREMIUM_IDS[0]]).toContain('X-Amz-Expires=300')
  })

  it.todo('INPUT-01: /api/audio/batch-urls should require a verified session before issuing presigned URLs')

  it.todo('INPUT-01b: arm ENTITLEMENT_ENFORCE=strict so premium past-preview ids are denied without a token')

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
      anonymousReq({ audioIds: ['../../etc/passwd', 'mastered/premium-0.mp3', PREMIUM_IDS[0]] }),
      res,
    )
    const json = res._json as { urls: Record<string, string>; denied: string[] }
    expect(json.denied).toContain('../../etc/passwd')
    expect(json.denied).toContain('mastered/premium-0.mp3')
    expect(Object.keys(json.urls)).toEqual([PREMIUM_IDS[0]])
  })

  it('CONTROL: presigned URLs are short-lived (300s), bounding a leaked link', async () => {
    const res = makeRes()
    await handler(anonymousReq({ audioIds: [PREMIUM_IDS[0]] }), res)
    expect((res._json as { ttlSeconds: number }).ttlSeconds).toBe(300)
  })
})
