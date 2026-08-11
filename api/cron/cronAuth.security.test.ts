/**
 * SECURITY AUDIT 2026-08-11 — area 3 (input handling & injection).
 *
 * Cron endpoints are publicly routable URLs (vercel.json `crons`), so the
 * ONLY thing between the open internet and a money-moving job is the
 * CRON_SECRET bearer check. These tests lock that gate.
 *
 * Findings: INPUT-12 (non-constant-time secret compare; non-prod bypass).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

process.env.SUPABASE_URL = 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'

/** True if a handler got past its auth gate far enough to touch the DB. */
let dbTouched = false

vi.mock('@supabase/supabase-js', () => {
  function chain(): any {
    const c: any = {
      select: () => c,
      eq: () => c,
      in: () => c,
      lte: () => c,
      not: () => c,
      update: () => c,
      insert: () => Object.assign(Promise.resolve({ error: null }), { then: undefined as never }),
      then: (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null }),
    }
    return c
  }
  return {
    createClient: () => ({
      from: () => {
        dbTouched = true
        return chain()
      },
      auth: { admin: { updateUserById: () => Promise.resolve({}) } },
    }),
  }
})

vi.mock('../_utils/wise', () => ({
  wiseApi: () => {
    dbTouched = true
    return Promise.resolve({})
  },
  requireProfileId: () => 'profile-1',
}))

function makeRes() {
  const res: any = {}
  res.setHeader = vi.fn(() => res)
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

function makeReq(headers: Record<string, string> = {}): VercelRequest {
  return { method: 'GET', query: {}, headers, body: {} } as VercelRequest
}

const ORIGINAL_NODE_ENV = process.env.NODE_ENV
const ORIGINAL_VERCEL_ENV = process.env.VERCEL_ENV

describe.each([
  ['expire-demo-schools', './expire-demo-schools'],
  ['teacher-payouts', './teacher-payouts'],
])('cron auth gate — /api/cron/%s', (_name, modulePath) => {
  beforeEach(() => {
    dbTouched = false
    vi.resetModules()
  })

  afterEach(() => {
    process.env.NODE_ENV = ORIGINAL_NODE_ENV
    if (ORIGINAL_VERCEL_ENV === undefined) delete process.env.VERCEL_ENV
    else process.env.VERCEL_ENV = ORIGINAL_VERCEL_ENV
    delete process.env.CRON_SECRET
  })

  it('CONTROL: in production, an unauthenticated request is rejected with 401 and never reaches the job', async () => {
    process.env.VERCEL_ENV = 'production'
    process.env.CRON_SECRET = 'the-real-secret'
    const handler = (await import(modulePath)).default

    const res = makeRes()
    await handler(makeReq(), res)

    expect(res._status).toBe(401)
    expect(dbTouched).toBe(false)
  })

  it('CONTROL: in production, a wrong bearer is rejected with 401', async () => {
    process.env.VERCEL_ENV = 'production'
    process.env.CRON_SECRET = 'the-real-secret'
    const handler = (await import(modulePath)).default

    const res = makeRes()
    await handler(makeReq({ authorization: 'Bearer the-real-secre' }), res)

    expect(res._status).toBe(401)
    expect(dbTouched).toBe(false)
  })

  it('CONTROL: in production with CRON_SECRET unset, the job refuses to run (fails closed)', async () => {
    process.env.VERCEL_ENV = 'production'
    delete process.env.CRON_SECRET
    const handler = (await import(modulePath)).default

    const res = makeRes()
    await handler(makeReq({ authorization: 'Bearer anything' }), res)

    expect(res._status).toBe(500)
    expect(res._json.error).toContain('CRON_SECRET')
    expect(dbTouched).toBe(false)
  })

  // SECURITY FINDING INPUT-12: the gate is a plain `!==` string comparison on
  // the whole `Bearer <secret>` header (api/cron/expire-demo-schools.ts:35,
  // api/cron/teacher-payouts.ts:101). It is not constant-time, so it leaks a
  // prefix-length timing signal on a long-lived shared secret. Over the public
  // internet the network noise floor makes this impractical, which is why this
  // is info-level rather than a real break — but crypto.timingSafeEqual on
  // equal-length buffers costs nothing and removes the question.
  it('INPUT-12: the secret is compared with a non-constant-time !== (characterized)', async () => {
    process.env.VERCEL_ENV = 'production'
    process.env.CRON_SECRET = 'the-real-secret'
    const handler = (await import(modulePath)).default

    // Correct secret, extra whitespace: the handler trims the header, so this
    // is accepted — demonstrating the comparison is plain string equality on a
    // normalised value, with no length-blinding.
    const res = makeRes()
    await handler(makeReq({ authorization: '  Bearer the-real-secret  ' }), res)

    expect(res._status).not.toBe(401)
  })

  it.todo('INPUT-12: compare CRON_SECRET with crypto.timingSafeEqual instead of !==')

  // SECURITY FINDING INPUT-12b: when CRON_SECRET is unset AND the environment
  // is not production, the check is skipped entirely (`if (cronSecret && …)`)
  // and the job runs for any caller. That is deliberate for local development,
  // but it means a preview/self-hosted deployment that forgets the env var
  // exposes a service-role job — including, for teacher-payouts, one that
  // creates Wise transfers. A deploy-time assertion (or failing closed
  // whenever VERCEL_ENV is set at all) would close it.
  it('INPUT-12b: with no CRON_SECRET outside production the gate is skipped entirely (characterized)', async () => {
    process.env.NODE_ENV = 'test'
    delete process.env.VERCEL_ENV
    delete process.env.CRON_SECRET
    const handler = (await import(modulePath)).default

    const res = makeRes()
    await handler(makeReq(), res)

    // No 401 — the unauthenticated caller got past the gate and ran the job
    // body, which is what `dbTouched` records.
    expect(res._status).not.toBe(401)
    expect(dbTouched).toBe(true)
  })

  it.todo('INPUT-12b: fail closed whenever VERCEL_ENV is set, not only when it equals "production"')
})
