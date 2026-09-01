/**
 * SEC0901-D-01 — /api/audio/batch-urls's "verified session" gate is
 * AUTHENTICATION, not ENTITLEMENT.
 *
 * `batchUrlsBulk.security.test.ts` (2026-08-11, INPUT-01) already proves the
 * anonymous case is closed. Its own second test is titled "a verified session
 * still gets its presigned URLs (no regression for real downloaders)" — but
 * the mock behind "verified session" in that suite (and in the production
 * code path it exercises) is `verifyAuthToken()`, which is pure Supabase-JWT
 * authentication: is there a live user for this token. Nothing in
 * `batch-urls.ts` queries `learners`, `user_subscriptions`, or
 * `user_entitlements` for the caller — `hasVerifiedSession()` is the ENTIRE
 * gate once `resolveAudioEntitlement`'s stateless HMAC-token check fails
 * (which it always does for a normal Supabase session bearer, since that
 * token was never minted as an entitlement token in the first place — see
 * `verifyEntitlementToken`, which tries to HMAC-verify it and gets garbage).
 *
 * Consequence: a free account with ZERO subscription and ZERO entitlements —
 * created by a throwaway email OTP signup, which costs nothing and takes
 * seconds — passes this gate identically to a paying subscriber, for EVERY
 * premium past-preview course in the catalogue, provided it already holds (or
 * is handed) the audio uuids. This narrows the 2026-08-25 remediation note's
 * claim that "the bulk path is already closed to anonymous callers" — true,
 * but "closed to anonymous" is not "closed to unentitled", and the bulk path
 * markets itself as the harder-to-defeat sibling of the fail-open per-clip
 * proxy.
 *
 * This is a CHARACTERIZATION test: it pins CURRENT behaviour and passes
 * today. It should go RED the day `batch-urls.ts` actually resolves the
 * caller's subscription/entitlement state (the way `resolveServerCourseAccess`
 * already does for bundle/cycles/infplay-cycles) before honouring a premium
 * past-preview id — red here means SEC0901-D-01 is closed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

const PREMIUM_IDS = Array.from(
  { length: 10 },
  (_, i) => `9999${String(i).padStart(4, '0')}-9999-9999-9999-999999999999`,
)

const courseAudioRows: Record<string, any> = Object.fromEntries(
  PREMIUM_IDS.map((id, i) => [
    id,
    {
      id,
      s3_key: `mastered/premium-${i}.mp3`,
      duration_ms: 1000,
      course_code: 'spa_for_eng',
      lego_id: 'S0300L01',
    },
  ])
)

// The mock IS the production shape: `verifyAuthToken` answers purely from a
// bearer token, with no notion of subscription/entitlement at all — matching
// api/_utils/auth.ts's real `verifyAuthToken`, which only calls
// `supabase.auth.getUser()`.
vi.mock('../_utils/auth', () => ({
  verifyAuthToken: (req: any) =>
    Promise.resolve(
      req?.headers?.authorization === 'Bearer free-account-zero-subscriptions'
        ? { valid: true, userId: 'free-user-never-paid' }
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

// No `learners`, no `user_subscriptions`, no `user_entitlements` table is
// wired up at all — deliberately, to prove the handler never reaches for
// them. If a future fix queries one of those tables, this mock's `from()`
// throws and the test fails loudly rather than silently returning empty rows.
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => {
      if (table !== 'course_audio' && table !== 'shared_audio') {
        throw new Error(`unexpected table read in batch-urls entitlement path: ${table}`)
      }
      return {
        select: () => ({
          in: (_col: string, ids: string[]) =>
            Promise.resolve({
              data: table === 'course_audio' ? ids.map((id) => courseAudioRows[id]).filter(Boolean) : [],
              error: null,
            }),
        }),
      }
    },
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

function freeAccountReq(body: unknown): VercelRequest {
  return {
    method: 'POST',
    query: {},
    headers: { authorization: 'Bearer free-account-zero-subscriptions' },
    cookies: {},
    body,
  } as unknown as VercelRequest
}

describe('SEC0901-D-01: batch-urls gate is authentication-only, not entitlement', () => {
  let handler: typeof import('./batch-urls').default

  beforeEach(async () => {
    vi.resetModules()
    handler = (await import('./batch-urls')).default
  })

  it('a freshly-registered account with no subscription/entitlement row anywhere receives every premium URL it asks for', async () => {
    const res = makeRes()
    await handler(freeAccountReq({ audioIds: PREMIUM_IDS }), res)

    expect(res._status).toBe(200)
    const json = res._json as { urls: Record<string, string>; denied: string[] }
    // The mocked Supabase client above throws if the handler ever queries a
    // subscription/entitlement table — it did not throw, and yet every id
    // still resolved. That IS the finding: authentication alone is sufficient.
    expect(Object.keys(json.urls)).toHaveLength(PREMIUM_IDS.length)
    expect(json.denied).toHaveLength(0)
  })

  it('the handler never references learners/user_subscriptions/user_entitlements tables', async () => {
    // Static confirmation alongside the behavioural one above: read the
    // handler and its entitlement dependency, and prove neither name a
    // subscription/entitlement table. If this test starts failing because
    // the source now DOES reference one, that is progress on SEC0901-D-01,
    // not a regression — update/remove this test as part of that fix.
    const { readFileSync } = await import('node:fs')
    const { fileURLToPath } = await import('node:url')
    const { dirname, resolve } = await import('node:path')
    const here = dirname(fileURLToPath(import.meta.url))
    const batchUrlsSrc = readFileSync(resolve(here, 'batch-urls.ts'), 'utf8')
    const audioAccessSrc = readFileSync(resolve(here, '../_utils/audioAccess.ts'), 'utf8')
    for (const table of ['user_subscriptions', 'user_entitlements', "from('learners')"]) {
      expect(batchUrlsSrc, `batch-urls.ts should not (yet) reference ${table}`).not.toContain(table)
      expect(audioAccessSrc, `audioAccess.ts's resolveAudioEntitlement should not (yet) reference ${table}`).not.toContain(
        table
      )
    }
  })
})
