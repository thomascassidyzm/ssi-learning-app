/**
 * SECURITY AUDIT 2026-08-15 — findings SEC15-02 (medium) and SEC15-03 (low).
 *
 * A follow-on audit of the 2026-08-11 fix for INPUT-01.
 *
 * The fix added a verified-session requirement to /api/audio/batch-urls for
 * premium past-preview ids, unconditionally (not behind ENTITLEMENT_ENFORCE).
 * That is a real improvement and the tests in batchUrlsBulk.security.test.ts
 * lock it. This file records what the fix does NOT do, because the write-up
 * around it reads as though the paid catalogue is now protected, and it is not.
 *
 * SEC15-02, in two parts:
 *
 *   (a) The gate is AUTHENTICATION, not ENTITLEMENT. It asks `verifyAuthToken`
 *       whether the caller holds any valid Supabase session. It never asks
 *       whether that session has a subscription or an entitlement — unlike the
 *       content endpoints, which go through `resolveServerCourseAccess`
 *       (api/_utils/courseAccess.ts) for exactly that question. Email-OTP
 *       signup is open, so the cost of clearing this gate is one free account.
 *
 *   (b) A denied id is not a withheld id. The client treats `denied` as
 *       "fetch it the slow way" and falls back to the per-clip proxy —
 *       packages/player-vue/src/playback/bulkAudioDownload.ts:201-202, whose
 *       own comment says "Denied ids fall back to ensure(), which enforces its
 *       own entitlement." The per-clip proxy does not enforce it. With
 *       ENTITLEMENT_ENFORCE unset — which the audit's own note records as the
 *       production state — `resolveAudioEntitlement` returns
 *       `{ allowed: true, gated: true, tag: 'no-token-open' }`
 *       (api/_utils/audioAccess.ts:541-543) and api/audio/[audioId].ts serves
 *       the bytes to an anonymous caller.
 *
 * So the change to the bulk endpoint raises the cost of pulling the paid
 * catalogue from "one request per 500 clips" to "one request per clip", and
 * from "anonymous" to "one free signup". It does not make the catalogue
 * unavailable. The thing that would is arming the entitlement check on the
 * proxy — which the code documents it cannot do yet, because no subscriber
 * token mint site exists. That is the real open item; this test exists so it
 * is not mistaken for a closed one.
 *
 * SEC15-03: api/audio/[audioId].ts:211-215 returns the internal S3 object key
 * and the raw S3 error message to the client on a fetch failure.
 *
 * Full write-up: docs/security-audit-2026-08-15/README.md
 *
 * NOTE ON SCOPE: these tests characterise today's behaviour. They change nothing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

/** Premium course (fra_for_eng), seed 300 — well past the Yellow-belt preview. */
const PREMIUM_ID = '22220000-2222-2222-2222-222222222222'

const courseAudioRows: Record<string, any> = {
  [PREMIUM_ID]: {
    id: PREMIUM_ID,
    s3_key: 'mastered/premium-300.mp3',
    duration_ms: 1000,
    course_code: 'fra_for_eng',
    lego_id: 'S0300L01',
  },
}

/** Only `Bearer free-account` is a valid session — and it owns nothing. */
vi.mock('../_utils/auth', () => ({
  verifyAuthToken: (req: any) =>
    Promise.resolve(
      req?.headers?.authorization === 'Bearer free-account'
        ? { valid: true, userId: 'user-with-no-subscription' }
        : { valid: false, error: 'Missing or invalid Authorization header' },
    ),
}))

/** S3 succeeds by default; one test flips it to a failure to check the error body. */
let s3ShouldFail = false
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class {
    send() {
      if (s3ShouldFail) {
        const err: any = new Error('Access Denied')
        err.Code = 'AccessDenied'
        err.name = 'AccessDenied'
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
        eq: (_col: string, id: string) => ({
          maybeSingle: () =>
            Promise.resolve({
              data: table === 'course_audio' ? (courseAudioRows[id] ?? null) : null,
              error: null,
            }),
          single: () =>
            Promise.resolve({
              data: table === 'course_audio' ? (courseAudioRows[id] ?? null) : null,
              error: null,
            }),
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
// The production state recorded by the 2026-08-11 audit: absent, so fail-open.
process.env.ENTITLEMENT_ENFORCE = ''

function makeRes() {
  const res: any = { _headers: {} }
  res.setHeader = vi.fn((k: string, v: string) => { res._headers[k] = v; return res })
  res.status = vi.fn((code: number) => { res._status = code; return res })
  res.json = vi.fn((body: unknown) => { res._json = body; return res })
  res.send = vi.fn((body: unknown) => { res._body = body; return res })
  res.end = vi.fn(() => res)
  return res as VercelResponse & { _status?: number; _json?: any; _body?: any; _headers: Record<string, string> }
}

describe('SEC15-02(a) — the bulk gate asks for a session, not for an entitlement', () => {
  let handler: typeof import('./batch-urls').default

  beforeEach(async () => {
    vi.resetModules()
    s3ShouldFail = false
    handler = (await import('./batch-urls')).default
  })

  const post = (headers: Record<string, string>) =>
    ({ method: 'POST', query: {}, headers, cookies: {}, body: { audioIds: [PREMIUM_ID] } }) as unknown as VercelRequest

  it('CONTROL: an anonymous caller is denied the premium id — the 2026-08-11 fix holds', async () => {
    const res = makeRes()
    await handler(post({}), res)

    expect(res._json.denied).toContain(PREMIUM_ID)
    expect(res._json.urls[PREMIUM_ID]).toBeUndefined()
  })

  // SECURITY FINDING SEC15-02(a): the session belongs to an account with no
  // subscription and no entitlement — the mock's userId says so — and it is
  // handed a presigned S3 URL for premium seed-300 content anyway. The gate
  // never consults `resolveServerCourseAccess`, which is the helper that
  // answers "may this user have this course?" for every content endpoint.
  it('SEC15-02: a brand-new free account is handed the premium clip (vulnerable, characterized)', async () => {
    const res = makeRes()
    await handler(post({ authorization: 'Bearer free-account' }), res)

    expect(res._json.denied).not.toContain(PREMIUM_ID)
    expect(res._json.urls[PREMIUM_ID]).toContain('mastered/premium-300.mp3')
  })

  it.todo(
    'SEC15-02: batch-urls should resolve entitlement per course via resolveServerCourseAccess, ' +
      'not accept any valid session as sufficient for premium past-preview ids',
  )
})

describe('SEC15-02(b) — a denied id is recoverable from the per-clip proxy', () => {
  let proxy: typeof import('./[audioId]').default

  beforeEach(async () => {
    vi.resetModules()
    s3ShouldFail = false
    proxy = (await import('./[audioId]')).default
  })

  const get = (headers: Record<string, string> = {}) =>
    ({ method: 'GET', query: { audioId: PREMIUM_ID }, headers, cookies: {} }) as unknown as VercelRequest

  // SECURITY FINDING SEC15-02(b): the exact id the bulk endpoint just refused
  // to an anonymous caller is served to that same anonymous caller here, with
  // the bytes in the body. This is the client's documented fallback path
  // (bulkAudioDownload.ts:201-202), so nothing about the download is actually
  // withheld — only slowed. The `X-SSi-Entitlement: no-token-open` header is
  // the code's own admission that it knows it is failing open.
  it('SEC15-02: the proxy serves the premium clip to an anonymous caller (vulnerable, characterized)', async () => {
    const res = makeRes()
    await proxy(get(), res)

    expect(res._status).not.toBe(403)
    expect(res._body).toBeInstanceOf(Buffer)
    expect(res._headers['X-SSi-Entitlement']).toBe('no-token-open')
  })

  it.todo(
    'SEC15-02: once a subscriber entitlement-token mint site exists, the proxy should fail CLOSED ' +
      'for premium past-preview ids — that is the change that actually withholds the catalogue',
  )
})

describe('SEC15-03 — the proxy leaks its storage layout on failure', () => {
  let proxy: typeof import('./[audioId]').default

  beforeEach(async () => {
    vi.resetModules()
    proxy = (await import('./[audioId]')).default
  })

  // SECURITY FINDING SEC15-03 (low): api/audio/[audioId].ts:211-215 puts the
  // internal S3 object key and the raw provider error message into the client
  // response body. Neither is actionable by a client — the client's only
  // recovery is to retry or give up — and both describe the bucket layout and
  // the failure mode of the storage account to anyone who can trigger a 502.
  it('SEC15-03: a storage failure returns the internal S3 key and provider error to the client (vulnerable, characterized)', async () => {
    s3ShouldFail = true
    const res = makeRes()
    await proxy(
      { method: 'GET', query: { audioId: PREMIUM_ID }, headers: {}, cookies: {} } as unknown as VercelRequest,
      res,
    )

    expect(res._status).toBe(502)
    expect(res._json.key).toBe('mastered/premium-300.mp3')
    expect(res._json.details).toBe('Access Denied')
  })

  it.todo('SEC15-03: the 502 body should carry a correlation id only; the key and provider error belong in the server log')
})
