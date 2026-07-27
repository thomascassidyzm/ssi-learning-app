/**
 * Tests for POST /api/code/validate — the unauthenticated code-validation
 * oracle. Focus of plan 007: it must throttle per IP (429 past the limit) so
 * the ABC-123 keyspace can't be swept to enumerate elevated-role invites, and
 * still validate real codes on the happy path.
 *
 * Supabase mock modelled on api/code/redeem.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

process.env.SUPABASE_URL = 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'

// Captures every insert per table for assertions.
let writes: Record<string, any[]> = {}
// Per-test table responders: (calls) => { data?, count?, error? } | undefined.
let responders: Record<string, (calls: any[][]) => any> = {}

function recordWrite(table: string, op: string, payload: unknown) {
  writes[table] = writes[table] || []
  writes[table].push({ op, payload })
}

function makeChainable(table: string) {
  const calls: any[][] = []
  const builder: any = {
    select: (cols: string, opts?: unknown) => { calls.push(['select', cols, opts]); return builder },
    insert: (obj: unknown) => { calls.push(['insert', obj]); recordWrite(table, 'insert', obj); return builder },
    eq: (col: string, val: unknown) => { calls.push(['eq', col, val]); return builder },
    neq: (col: string, val: unknown) => { calls.push(['neq', col, val]); return builder },
    gte: (col: string, val: unknown) => { calls.push(['gte', col, val]); return builder },
    resolve: () => {
      const respond = responders[table]
      if (respond) {
        const r = respond(calls)
        if (r !== undefined) return r
      }
      return { data: null, error: null, count: 0 }
    },
    maybeSingle() { return Promise.resolve(this.resolve()) },
    single() { return Promise.resolve(this.resolve()) },
    then(onF: any, onR: any) { return Promise.resolve(this.resolve()).then(onF, onR) },
  }
  return builder
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => makeChainable(table),
  }),
}))

function makeRes() {
  const res: any = { _headers: {} }
  res.status = vi.fn((code: number) => { res._status = code; return res })
  res.json = vi.fn((body: unknown) => { res._json = body; return res })
  return res as VercelResponse & { _status?: number; _json?: any }
}

function makeReq(overrides: Partial<VercelRequest>): VercelRequest {
  return { method: 'POST', query: {}, headers: {}, body: {}, ...overrides } as VercelRequest
}

// Helper: possession_mint_attempts responder that reports a given windowed
// count for the per-IP SELECT and swallows the audit INSERT.
function attemptsResponder(ipCount: number) {
  return (calls: any[][]) => {
    if (calls.some((c) => c[0] === 'insert')) return { error: null }
    return { count: ipCount, error: null }
  }
}

describe('POST /api/code/validate', () => {
  let handler: typeof import('./validate').default

  beforeEach(async () => {
    vi.resetModules()
    writes = {}
    responders = {}
    handler = (await import('./validate')).default
  })

  it('rejects non-POST with 405', async () => {
    const res = makeRes()
    await handler(makeReq({ method: 'GET' }), res)
    expect(res._status).toBe(405)
  })

  it('rejects a missing code with 400', async () => {
    const res = makeRes()
    await handler(makeReq({ body: {} }), res)
    expect(res._status).toBe(400)
    expect(res._json.valid).toBe(false)
  })

  it('validates a real invite code (valid:true) under the limit', async () => {
    responders.possession_mint_attempts = attemptsResponder(0)
    responders.invite_code_validation = (calls) => {
      if (calls.some((c) => c[0] === 'select')) {
        return {
          data: {
            id: 'invite-1',
            code: 'ABC-123',
            code_type: 'tester', // no extra context lookup
            grants_region: null,
            grants_school_id: null,
            grants_class_id: null,
            grants_group_id: null,
            metadata: {},
            max_uses: null,
            use_count: 0,
            expires_at: null,
            is_active: true,
          },
          error: null,
        }
      }
      return { data: null, error: null }
    }

    const res = makeRes()
    await handler(makeReq({ body: { code: 'ABC-123' }, headers: { 'x-forwarded-for': '1.2.3.4' } }), res)

    expect(res._status).toBe(200)
    expect(res._json.valid).toBe(true)
    expect(res._json.codeKind).toBe('invite')
    expect(res._json.codeType).toBe('tester')
    // The attempt was audited (so the per-IP window accumulates).
    expect(writes.possession_mint_attempts.some((w) => w.op === 'insert')).toBe(true)
  })

  it('returns {valid:false} for an unknown code (still under the limit)', async () => {
    responders.possession_mint_attempts = attemptsResponder(0)
    responders.invite_code_validation = () => ({ data: null, error: null })
    responders.entitlement_code_validation = () => ({ data: null, error: null })

    const res = makeRes()
    await handler(makeReq({ body: { code: 'ZZZ-999' }, headers: { 'x-forwarded-for': '1.2.3.4' } }), res)

    expect(res._status).toBe(200)
    expect(res._json.valid).toBe(false)
  })

  it('returns 429 once the per-IP window is at/over the limit', async () => {
    // PER_IP_LIMIT is 10; simulate the window already at the limit.
    responders.possession_mint_attempts = attemptsResponder(10)
    // Even a valid code must NOT be revealed once throttled.
    responders.invite_code_validation = (calls) => {
      if (calls.some((c) => c[0] === 'select')) {
        return { data: { id: 'invite-x', code: 'ABC-123', code_type: 'teacher', is_active: true, use_count: 0, max_uses: null, expires_at: null, grants_school_id: 'school-1' }, error: null }
      }
      return { data: null, error: null }
    }

    const res = makeRes()
    await handler(makeReq({ body: { code: 'ABC-123' }, headers: { 'x-forwarded-for': '9.9.9.9' } }), res)

    expect(res._status).toBe(429)
    expect(res._json.valid).toBe(false)
    // The throttle hit was logged (abuse observable).
    const inserts = (writes.possession_mint_attempts || []).filter((w) => w.op === 'insert')
    expect(inserts.some((w) => w.payload.outcome === 'rate_limited_ip')).toBe(true)
    // No code detail leaked in the 429 body.
    expect(res._json.codeKind).toBeUndefined()
  })

  // Regression, live repro 2026-07-27 (IME demo pre-flight): this endpoint
  // shares possession_mint_attempts with possession-redeem, which excludes
  // successful personal-link sign-ins and its own refusals from the window.
  // Counting them here 429'd a working leader link after ten legitimate
  // clicks from one IP, and each retry re-armed the window.
  it('per-IP window ignores personal sign-ins and its own refusals', async () => {
    let countCalls: any[][] = []
    responders.possession_mint_attempts = (calls) => {
      if (calls.some((c) => c[0] === 'insert')) return { error: null }
      countCalls = calls
      return { count: 0, error: null }
    }
    responders.invite_code_validation = () => ({ data: null, error: null })
    responders.entitlement_code_validation = () => ({ data: null, error: null })

    const res = makeRes()
    await handler(makeReq({ body: { code: 'ABC-123' }, headers: { 'x-forwarded-for': '1.2.3.4' } }), res)

    expect(res._status).toBe(200)
    const excluded = countCalls.filter((c) => c[0] === 'neq').map((c) => c[2])
    expect(excluded).toContain('personal_signin')
    expect(excluded).toContain('rate_limited_ip')
    expect(excluded).toContain('rate_limited_code')
    // The enumeration signal itself is still counted — the throttle's purpose.
    expect(excluded).not.toContain('validate_attempt')
  })
})
