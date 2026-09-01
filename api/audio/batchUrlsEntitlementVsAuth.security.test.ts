/**
 * SEC0901-D-01 (REGRESSION TEST — was a characterization test) —
 * /api/audio/batch-urls must gate premium past-preview ids on ENTITLEMENT,
 * not merely on AUTHENTICATION.
 *
 * HISTORY. The 2026-09-01 audit wrote this file as a CHARACTERIZATION test.
 * It pinned the vulnerable behaviour — a free OTP-signup account with zero
 * subscriptions and zero entitlements received presigned URLs for every
 * premium uuid it asked for, indistinguishable from a paying subscriber — and
 * its header said it "should go RED the day batch-urls.ts actually resolves
 * the caller's subscription/entitlement state the way resolveServerCourseAccess
 * already does for bundle/cycles/infplay-cycles". That day is 2026-09-01, so
 * the assertions are inverted: they now assert the FIXED behaviour, including
 * the static test that used to prove the handler never named an entitlement
 * table (it now must).
 *
 * THE RULE UNDER TEST, and the reason both directions are covered: the
 * endpoint answers the SAME question `/api/courses/:code/bundle` answers. If a
 * caller can load the full (non-preview) bundle for a course, they get
 * presigned URLs for that course's audio here; if they cannot, they do not.
 * The "still receives them" cases below are not decoration — a gate that denies
 * a genuine subscriber their offline download is a worse defect than the leak
 * it closes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

const PREMIUM_IDS = Array.from(
  { length: 10 },
  (_, i) => `9999${String(i).padStart(4, '0')}-9999-9999-9999-999999999999`,
)
// Free-course + preview-window ids: never `gated`, must stay anonymous-friendly.
const FREE_ID = '11110000-1111-1111-1111-111111111111'
const PREVIEW_ID = '22220000-2222-2222-2222-222222222222'

const courseAudioRows: Record<string, any> = {
  ...Object.fromEntries(
    PREMIUM_IDS.map((id, i) => [
      id,
      {
        id,
        s3_key: `mastered/premium-${i}.mp3`,
        duration_ms: 1000,
        course_code: 'spa_for_eng',
        lego_id: 'S0300L01', // seed 300 — well past the Yellow ceiling (19)
      },
    ]),
  ),
  [FREE_ID]: {
    id: FREE_ID,
    s3_key: 'mastered/free.mp3',
    duration_ms: 1000,
    course_code: 'community_cym',
    lego_id: 'S0300L01',
  },
  [PREVIEW_ID]: {
    id: PREVIEW_ID,
    s3_key: 'mastered/preview.mp3',
    duration_ms: 1000,
    course_code: 'spa_for_eng',
    lego_id: 'S0005L01', // inside the free preview window
  },
}

const COURSE_ROWS: Record<string, any> = {
  spa_for_eng: { course_code: 'spa_for_eng', target_lang: 'spa', pricing_tier: 'premium', is_community: false },
  community_cym: { course_code: 'community_cym', target_lang: 'cym', pricing_tier: 'community', is_community: true },
}

/**
 * The caller the mocked database describes. Swapped per test — this is the
 * whole point of the suite: identical requests, different DB state.
 */
interface Scenario {
  authUserId: string | null
  learner: { id: string; platform_role: string | null; educational_role: string | null } | null
  subscription: { status: string; current_period_end: string | null } | null
  entitlements: Array<{ access_type: string; granted_courses: string[] | null; expires_at: string | null }>
  cascadeCourses: string[] | null
  /** Make the entitlement-side reads throw, to pin the fail-closed posture. */
  dbFailsOnEntitlementReads?: boolean
}

let scenario: Scenario

function freshScenario(): Scenario {
  return {
    authUserId: 'free-user-never-paid',
    learner: { id: 'learner-free', platform_role: null, educational_role: null },
    subscription: null,
    entitlements: [],
    cascadeCourses: null,
  }
}

// verifyAuthToken keeps its real shape: it answers from the bearer alone and
// has no notion of subscription. That is not the bug — the bug was treating
// its answer as the whole gate.
vi.mock('../_utils/auth', () => ({
  verifyAuthToken: (req: any) =>
    Promise.resolve(
      typeof req?.headers?.authorization === 'string' && req.headers.authorization.startsWith('Bearer ') && scenario.authUserId
        ? { valid: true, userId: scenario.authUserId }
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

/** Counts every table read, so the query-count claim in the fix is testable. */
const tableReads: string[] = []

vi.mock('@supabase/supabase-js', () => {
  function query(table: string) {
    tableReads.push(table)
    const state: Record<string, unknown> = {}
    const rows = (): { data: unknown; error: unknown } => {
      switch (table) {
        case 'course_audio': {
          const ids = (state.in as string[]) || []
          return { data: ids.map((id) => courseAudioRows[id]).filter(Boolean), error: null }
        }
        case 'shared_audio':
          return { data: [], error: null }
        case 'courses': {
          if (scenario.dbFailsOnEntitlementReads) return { data: null, error: { message: 'courses read failed' } }
          const codes = (state.in as string[]) || []
          return { data: codes.map((c) => COURSE_ROWS[c]).filter(Boolean), error: null }
        }
        case 'user_entitlements':
          return { data: scenario.entitlements, error: null }
        default:
          return { data: [], error: null }
      }
    }
    const single = (): { data: unknown; error: unknown } => {
      switch (table) {
        case 'learners':
          return { data: scenario.learner, error: null }
        case 'subscriptions':
          return { data: scenario.subscription, error: null }
        case 'family_members':
          return { data: null, error: null }
        default:
          return { data: null, error: null }
      }
    }
    const q: any = {
      select: () => q,
      eq: (col: string, val: unknown) => {
        state[col] = val
        return q
      },
      is: () => q,
      in: (_col: string, vals: string[]) => {
        state.in = vals
        return q
      },
      maybeSingle: () => Promise.resolve(single()),
      then: (ok: any, err: any) => Promise.resolve(rows()).then(ok, err),
    }
    return q
  }
  return {
    createClient: () => ({
      from: (table: string) => query(table),
      rpc: async () => ({ data: scenario.cascadeCourses, error: null }),
    }),
  }
})

process.env.SUPABASE_URL = 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'
process.env.SUPABASE_ANON_KEY = 'anon-key'
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

function req(body: unknown, authed = true): VercelRequest {
  return {
    method: 'POST',
    query: {},
    headers: authed ? { authorization: 'Bearer a-real-supabase-session' } : {},
    cookies: {},
    body,
  } as unknown as VercelRequest
}

describe('SEC0901-D-01: batch-urls gates on entitlement, not merely authentication', () => {
  let handler: typeof import('./batch-urls').default

  beforeEach(async () => {
    vi.resetModules()
    scenario = freshScenario()
    tableReads.length = 0
    handler = (await import('./batch-urls')).default
  })

  it('DENIES premium past-preview ids to a valid session with no subscription and no entitlements', async () => {
    const res = makeRes()
    await handler(req({ audioIds: PREMIUM_IDS }), res)

    expect(res._status).toBe(200)
    const json = res._json as { urls: Record<string, string>; denied: string[] }
    expect(Object.keys(json.urls)).toHaveLength(0)
    expect(json.denied.sort()).toEqual([...PREMIUM_IDS].sort())
    // ...and it reached the real entitlement tables to decide that.
    expect(tableReads).toContain('learners')
    expect(tableReads).toContain('user_entitlements')
  })

  it('NO REGRESSION — an ACTIVE SUBSCRIBER still receives every URL', async () => {
    scenario.subscription = { status: 'active', current_period_end: null }
    const res = makeRes()
    await handler(req({ audioIds: PREMIUM_IDS }), res)

    const json = res._json as { urls: Record<string, string>; denied: string[] }
    expect(Object.keys(json.urls)).toHaveLength(PREMIUM_IDS.length)
    expect(json.denied).toHaveLength(0)
    expect(json.urls[PREMIUM_IDS[0]]).toContain('X-Amz-Expires=300')
  })

  it('NO REGRESSION — a lapsed subscription (period ended) is denied, an in-date one is not', async () => {
    scenario.subscription = { status: 'active', current_period_end: '2020-01-01T00:00:00Z' }
    const lapsed = makeRes()
    await handler(req({ audioIds: PREMIUM_IDS }), lapsed)
    expect(Object.keys((lapsed._json as any).urls)).toHaveLength(0)

    vi.resetModules()
    tableReads.length = 0
    handler = (await import('./batch-urls')).default
    scenario.subscription = { status: 'active', current_period_end: '2999-01-01T00:00:00Z' }
    const live = makeRes()
    await handler(req({ audioIds: PREMIUM_IDS }), live)
    expect(Object.keys((live._json as any).urls)).toHaveLength(PREMIUM_IDS.length)
  })

  it('NO REGRESSION — a course-scoped ENTITLEMENT GRANT still receives every URL', async () => {
    scenario.entitlements = [{ access_type: 'courses', granted_courses: ['spa_for_eng'], expires_at: null }]
    const res = makeRes()
    await handler(req({ audioIds: PREMIUM_IDS }), res)
    expect(Object.keys((res._json as any).urls)).toHaveLength(PREMIUM_IDS.length)
  })

  it('NO REGRESSION — a cascaded (school/group) grant still receives every URL', async () => {
    scenario.cascadeCourses = ['spa_for_eng']
    const res = makeRes()
    await handler(req({ audioIds: PREMIUM_IDS }), res)
    expect(Object.keys((res._json as any).urls)).toHaveLength(PREMIUM_IDS.length)
  })

  it('NO REGRESSION — the ssi_admin platform-role branch still receives every URL', async () => {
    scenario.learner = { id: 'learner-admin', platform_role: 'ssi_admin', educational_role: null }
    const res = makeRes()
    await handler(req({ audioIds: PREMIUM_IDS }), res)
    expect(Object.keys((res._json as any).urls)).toHaveLength(PREMIUM_IDS.length)
  })

  it('NO REGRESSION — free/community and preview-window ids are served to an ANONYMOUS caller', async () => {
    scenario.authUserId = null
    const res = makeRes()
    await handler(req({ audioIds: [FREE_ID, PREVIEW_ID] }, false), res)

    const json = res._json as { urls: Record<string, string>; denied: string[]; ttlSeconds: number }
    expect(Object.keys(json.urls).sort()).toEqual([FREE_ID, PREVIEW_ID].sort())
    expect(json.denied).toHaveLength(0)
    expect(json.ttlSeconds).toBe(300)
    // Ungated ids must not have cost an entitlement round trip at all.
    expect(tableReads).not.toContain('learners')
    expect(tableReads).not.toContain('courses')
  })

  it('FAILS CLOSED — an entitlement lookup error denies gated ids rather than waving them through', async () => {
    scenario.subscription = { status: 'active', current_period_end: null } // a real subscriber
    scenario.dbFailsOnEntitlementReads = true
    const res = makeRes()
    await handler(req({ audioIds: PREMIUM_IDS }), res)

    expect(res._status).toBe(200) // still a normal response — the client falls back to the per-clip proxy
    const json = res._json as { urls: Record<string, string>; denied: string[] }
    expect(Object.keys(json.urls)).toHaveLength(0)
    expect(json.denied).toHaveLength(PREMIUM_IDS.length)
  })

  it('resolves entitlement ONCE PER COURSE, not once per id (500 ids must not be 500 round trips)', async () => {
    scenario.subscription = { status: 'active', current_period_end: null }
    const res = makeRes()
    await handler(req({ audioIds: PREMIUM_IDS }), res)

    expect(Object.keys((res._json as any).urls)).toHaveLength(PREMIUM_IDS.length)
    // One `courses` read for the whole batch, one learner/subscription/
    // entitlement resolution for the one distinct course in it.
    expect(tableReads.filter((t) => t === 'courses')).toHaveLength(1)
    expect(tableReads.filter((t) => t === 'learners')).toHaveLength(1)
    expect(tableReads.filter((t) => t === 'user_entitlements')).toHaveLength(1)
  })

  it('the handler DOES now resolve the caller against the real entitlement tables', async () => {
    // The inverse of the static test this file used to carry, which asserted
    // the source named none of these. Keeping it as an assertion (rather than
    // deleting it) makes the fix's shape hard to remove by accident.
    const { readFileSync } = await import('node:fs')
    const { fileURLToPath } = await import('node:url')
    const { dirname, resolve } = await import('node:path')
    const here = dirname(fileURLToPath(import.meta.url))
    const batchUrlsSrc = readFileSync(resolve(here, 'batch-urls.ts'), 'utf8')
    const courseAccessSrc = readFileSync(resolve(here, '../_utils/courseAccess.ts'), 'utf8')
    expect(batchUrlsSrc).toContain('resolveServerCourseAccess')
    expect(courseAccessSrc).toContain('user_entitlements')
    expect(courseAccessSrc).toContain("from('learners')")
    // And the old authentication-only gate is gone.
    expect(batchUrlsSrc).not.toContain('hasVerifiedSession')
  })
})
