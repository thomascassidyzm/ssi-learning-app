/**
 * SECURITY AUDIT 2026-08-11 — area 3 (input handling & injection).
 *
 * The /api/courses/** routes are the app's unauthenticated content surface:
 * a path segment and two query params go straight into a service-role RPC.
 * These are regression locks on the validation that currently HOLDS there —
 * this is the pattern the rest of the API should copy, so it is worth pinning.
 *
 * No vulnerability findings in this file: every hostile input tested is
 * rejected before it reaches Postgres.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

process.env.SUPABASE_URL = 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'

/** Everything the handler asked the DB for, so we can prove nothing leaked through. */
let rpcCalls: { fn: string; args: Record<string, unknown> }[] = []
let tablesQueried: string[] = []

vi.mock('@supabase/supabase-js', () => {
  function chain(table: string): any {
    tablesQueried.push(table)
    const c: any = {
      select: () => c,
      eq: () => c,
      order: () => Promise.resolve({ data: [], error: null }),
      maybeSingle: () => Promise.resolve({ data: null, error: null }),
      then: (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null }),
    }
    return c
  }
  return {
    createClient: () => ({
      from: (t: string) => chain(t),
      rpc: (fn: string, args: Record<string, unknown>) => {
        rpcCalls.push({ fn, args })
        return Promise.resolve({ data: null, error: null })
      },
    }),
  }
})

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

function makeReq(query: Record<string, unknown>): VercelRequest {
  return { method: 'GET', query, headers: {}, body: {} } as unknown as VercelRequest
}

const HOSTILE_CODES = [
  '../../../etc/passwd',
  'fra_for_eng,course_code.neq.x',
  "fra_for_eng' OR '1'='1",
  'fra_for_eng%00',
  'FRA_FOR_ENG', // uppercase is outside the allow-list on purpose
  'fra-for-eng',
  'fra_for_eng*',
  '',
]

describe('GET /api/courses/:code/cycles — input validation (controls)', () => {
  let handler: typeof import('./[code]/cycles').default

  beforeEach(async () => {
    rpcCalls = []
    tablesQueried = []
    vi.resetModules()
    handler = (await import('./[code]/cycles')).default
  })

  it.each(HOSTILE_CODES)('CONTROL: rejects course code %j with 400 before any DB call', async (code) => {
    const res = makeRes()
    await handler(makeReq({ code, from: 'S0001L01' }), res)
    expect(res._status).toBe(400)
    expect(rpcCalls).toHaveLength(0)
    expect(tablesQueried).toHaveLength(0)
  })

  it('CONTROL: rejects an array course code rather than coercing it', async () => {
    const res = makeRes()
    await handler(makeReq({ code: ['fra_for_eng', 'x'], from: 'S0001L01' }), res)
    expect(res._status).toBe(400)
    expect(rpcCalls).toHaveLength(0)
  })

  it.each([
    'S0001L01,x',
    "S0001L01' --",
    'S1L1',
    'S00001L01',
    '../S0001L01',
    'S0001L01%20OR%201=1',
  ])('CONTROL: rejects `from` LEGO id %j with 400 before any DB call', async (from) => {
    const res = makeRes()
    await handler(makeReq({ code: 'fra_for_eng', from }), res)
    expect(res._status).toBe(400)
    expect(rpcCalls).toHaveLength(0)
  })

  it('CONTROL: clamps an absurd limit instead of passing it to the RPC', async () => {
    const res = makeRes()
    await handler(makeReq({ code: 'fra_for_eng', from: 'S0001L01', limit: '999999999' }), res)

    expect(rpcCalls).toHaveLength(1)
    const roundLimit = rpcCalls[0].args.p_round_limit as number
    expect(roundLimit).toBeLessThanOrEqual(102)
    expect(roundLimit).toBeGreaterThan(0)
  })

  it('CONTROL: a negative / NaN / injected limit falls back to the default, never reaching the RPC raw', async () => {
    for (const limit of ['-1', '0', 'abc', '1); drop table--', '1e309']) {
      rpcCalls = []
      vi.resetModules()
      const h = (await import('./[code]/cycles')).default
      const res = makeRes()
      await h(makeReq({ code: 'fra_for_eng', from: 'S0001L01', limit }), res)

      expect(rpcCalls).toHaveLength(1)
      expect(typeof rpcCalls[0].args.p_round_limit).toBe('number')
      expect(Number.isFinite(rpcCalls[0].args.p_round_limit as number)).toBe(true)
      expect(rpcCalls[0].args.p_round_limit as number).toBeLessThanOrEqual(102)
    }
  })

  it('CONTROL: RPC parameters are passed as named values, never concatenated into SQL', async () => {
    const res = makeRes()
    await handler(makeReq({ code: 'fra_for_eng', from: 'S0001L01' }), res)
    expect(res).toBeDefined()
    expect(rpcCalls[0].fn).toBe('get_course_cycles_window')
    expect(Object.keys(rpcCalls[0].args).sort()).toEqual([
      'p_course_code',
      'p_from_lego_id',
      'p_round_limit',
    ])
    expect(rpcCalls[0].args.p_course_code).toBe('fra_for_eng')
  })
})

describe('GET /api/courses/:code/round-map — input validation (controls)', () => {
  let handler: typeof import('./[code]/round-map').default

  beforeEach(async () => {
    rpcCalls = []
    tablesQueried = []
    vi.resetModules()
    handler = (await import('./[code]/round-map')).default
  })

  it.each(HOSTILE_CODES)('CONTROL: rejects course code %j with 400 before any DB call', async (code) => {
    const res = makeRes()
    await handler(makeReq({ code }), res)
    expect(res._status).toBe(400)
    expect(tablesQueried).toHaveLength(0)
  })

  it('CONTROL: rejects non-GET methods', async () => {
    const res = makeRes()
    await handler({ method: 'POST', query: {}, headers: {} } as VercelRequest, res)
    expect(res._status).toBe(405)
  })
})

describe('course-code / lego-id validators are not ReDoS-prone', () => {
  // The allow-list regexes are single character classes with one quantifier
  // each, so they are linear. This pins that: a pathological 200k-char input
  // that fails the match must still return in well under a second.
  it('CONTROL: a 200k-character hostile course code is rejected quickly', async () => {
    vi.resetModules()
    const handler = (await import('./[code]/round-map')).default
    const res = makeRes()

    const started = Date.now()
    await handler(makeReq({ code: `${'a'.repeat(200_000)}!` }), res)
    const elapsed = Date.now() - started

    expect(res._status).toBe(400)
    expect(elapsed).toBeLessThan(1000)
  })
})
