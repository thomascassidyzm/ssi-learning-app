/**
 * SEC-AUDIT-2026-08-18 · Finding 5 — the anti-enumeration throttle is keyed on
 * a header the attacker sets.
 *
 * Three endpoints share one limiter (the `possession_mint_attempts` table) and
 * one identical helper:
 *
 *     function getClientIp(req) {
 *       return (req.headers['x-forwarded-for'])?.split(',')[0]?.trim()
 *           || (req.headers['x-real-ip'])
 *           || 'unknown'
 *     }
 *
 *   — api/code/validate.ts, api/auth/possession-redeem.ts, api/try-link/validate.ts
 *
 * `X-Forwarded-For` is a hop list, and the LEFTMOST entry is the one the
 * original client wrote. Reading position 0 is reading attacker input; so is
 * `x-real-ip`, which any client can send. Whether a given request actually
 * reaches the function with a forged value depends on whether the edge in
 * front of it strips or overwrites the header — so this is a property of the
 * DEPLOYMENT as much as the code, and it has NOT been verified against the
 * live Vercel edge here (this pass is code + tests only, nothing fired at
 * production). What the code can be held to regardless is the defensive shape:
 * the throttle bucket must not be derivable from a header the request body's
 * author controls when a platform-attested source is available (Vercel exposes
 * `x-vercel-forwarded-for`, and `req.socket.remoteAddress` is the transport
 * truth).
 *
 * Why it matters more than a normal limiter bypass: validate.ts's own comment
 * says the limiter is the ONLY thing standing between an anonymous caller and
 * a sweep of the "~13.8M ABC-123 keyspace", where "a hit yields an
 * elevated-role invite (teacher/school_admin/govt_admin) ... i.e. school
 * infiltration". A per-IP window of 10 that an attacker can reset by
 * incrementing a header is not a limiter, it is a formality.
 *
 * THIS TEST FAILS ON PURPOSE against current main. It is the finding,
 * executable. No production behaviour is changed by this file.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-key'
process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'anon-key'

/** ip_hash values the handler wrote to possession_mint_attempts. */
let attemptHashes: string[] = []
/** ip_hash values the handler counted against the window. */
let countedHashes: string[] = []

vi.mock('@supabase/supabase-js', () => {
  const makeBuilder = (table: string): any => {
    const b: any = {}
    b.select = () => b
    b.eq = (col: string, val: unknown) => {
      if (table === 'possession_mint_attempts' && col === 'ip_hash') countedHashes.push(String(val))
      return b
    }
    b.neq = () => b
    b.gte = async () => ({ count: 0 })
    b.insert = (values: Record<string, unknown>) => {
      if (table === 'possession_mint_attempts') attemptHashes.push(String(values.ip_hash))
      return Promise.resolve({ error: null })
    }
    b.single = async () => ({ data: null, error: null })
    b.maybeSingle = async () => ({ data: null, error: null })
    return b
  }
  return { createClient: () => ({ from: (table: string) => makeBuilder(table) }) }
})

vi.mock('../_utils/auth', () => ({
  verifyAuthToken: async () => ({ valid: false, error: 'no token' }),
}))

function makeRes() {
  const out: { status: number; body: any } = { status: 0, body: null }
  const res: any = {
    status(code: number) { out.status = code; return res },
    json(body: any) { out.body = body; return res },
  }
  return { res, out }
}

/** One attempt from ONE real machine, declaring whatever forwarded-for it likes. */
async function attempt(handler: any, headers: Record<string, string>) {
  const { res, out } = makeRes()
  await handler({
    method: 'POST',
    headers,
    // The transport truth is constant across every call in this file: one host.
    socket: { remoteAddress: '203.0.113.9' },
    body: { code: 'ABC-123' },
  } as any, res)
  return out
}

describe('SEC-AUDIT Finding 5 — throttle bucket is client-controlled', () => {
  beforeEach(() => { attemptHashes = []; countedHashes = [] })

  it('keeps one machine in one bucket regardless of the X-Forwarded-For it sends', async () => {
    const { default: handler } = await import('./validate')

    for (let i = 0; i < 25; i++) {
      // A sweep that rotates its declared client IP every request.
      await attempt(handler, { 'x-forwarded-for': `198.51.100.${i}, 203.0.113.9` })
    }

    expect(attemptHashes).toHaveLength(25)

    // The property we want: the same physical caller lands in the same window,
    // so 25 attempts against a limit of 10 cannot all be counted as first
    // attempts. Against current main every request gets a fresh bucket.
    expect(new Set(attemptHashes).size).toBe(1)
    expect(new Set(countedHashes).size).toBe(1)
  })

  it('does not let x-real-ip pick the bucket either', async () => {
    const { default: handler } = await import('./validate')

    await attempt(handler, { 'x-real-ip': '198.51.100.1' })
    await attempt(handler, { 'x-real-ip': '198.51.100.2' })

    expect(new Set(attemptHashes).size).toBe(1)
  })
})
