/**
 * SECURITY AUDIT 2026-08-11 — area 1 (auth & identity core).
 *
 * AUTH-CORE-03: POST /api/try-link/validate is unauthenticated, has NO rate
 * limit, and resolves a LOW-ENTROPY code (api/_utils/codeGen.ts generateCode()
 * — 3 consonants from a 24-letter alphabet + 3 digits = 13,824,000 values,
 * shared with invite/entitlement codes). A hit mints a server-signed,
 * 30-day, scope:'all' entitlement token that the audio proxy accepts
 * (api/_utils/audioAccess.ts) — i.e. free access to the whole paid catalogue.
 *
 * The sibling /api/code/validate throttles exactly this shape of guessing
 * against possession_mint_attempts. This endpoint does not.
 *
 * AUTH-CORE-10: the catch-all returns `error?.message` — a raw DB error string
 * — to an unauthenticated caller.
 *
 * Full write-up: docs/security-audit-2026-08-11/auth-core.md
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

const VALID_LINK = { id: 'link-1', code: 'TRYME', label: 'Try SSi', expires_at: null, is_active: true }

/** Codes the mocked try_links table considers real. Everything else misses. */
let knownCodes = new Set<string>(['TRYME'])
/** Every table the handler touched — the throttle-presence probe. */
let tablesTouched: string[] = []
/** Forced lookup error, for the error-disclosure characterization. */
let lookupError: any = null

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => {
      tablesTouched.push(table)
      if (table === 'try_links') {
        let wanted = ''
        const builder: any = {
          select: () => builder,
          eq: (_col: string, val: string) => { wanted = val; return builder },
          maybeSingle: () =>
            Promise.resolve(
              lookupError
                ? { data: null, error: lookupError }
                : { data: knownCodes.has(wanted) ? VALID_LINK : null, error: null },
            ),
        }
        return builder
      }
      return { insert: () => ({ then: (cb: (r: { error: null }) => void) => cb({ error: null }) }) }
    },
  }),
}))

function makeRes() {
  const res: any = {}
  res.status = vi.fn((code: number) => { res._status = code; return res })
  res.json = vi.fn((body: unknown) => { res._json = body; return res })
  return res as VercelResponse & { _status?: number; _json?: any }
}

function makeReq(body: unknown, headers: Record<string, string> = {}): VercelRequest {
  return { method: 'POST', query: {}, headers, body } as VercelRequest
}

const ORIG_ENV = { ...process.env }
let handler: typeof import('./validate').default

beforeEach(async () => {
  vi.resetModules()
  knownCodes = new Set(['TRYME'])
  tablesTouched = []
  lookupError = null
  process.env.VITE_SUPABASE_URL = 'https://example.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'
  process.env.ENTITLEMENT_TOKEN_SECRET = 'shared-entitlement-secret'
  delete process.env.VERCEL_ENV
  process.env.NODE_ENV = 'test'
  handler = (await import('./validate')).default
})

afterEach(() => {
  process.env = { ...ORIG_ENV }
})

describe('AUTH-CORE-03 — /api/try-link/validate code-guessing throttle', () => {
  // SECURITY FINDING AUTH-CORE-03: an unauthenticated caller should get a 429
  // once a per-IP guess budget is spent, exactly as /api/code/validate does.
  it('CHARACTERIZATION: 30 wrong codes from one caller, all answered, none throttled', async () => {
    const statuses: (number | undefined)[] = []
    for (let i = 0; i < 30; i++) {
      const res = makeRes()
      await handler(makeReq({ code: `AAA-${String(i).padStart(3, '0')}` }, { 'x-forwarded-for': '198.51.100.7' }), res)
      statuses.push(res._status)
    }
    // Every miss is a plain 404 — a clean, cheap oracle answer.
    expect(statuses.every((s) => s === 404)).toBe(true)
    expect(statuses).not.toContain(429)
  })

  // SECURITY FINDING AUTH-CORE-03: no read of any rate-limit ledger happens at
  // all — the only tables touched are the lookup and the visit log.
  it('CHARACTERIZATION: never consults a rate-limit budget (possession_mint_attempts or otherwise)', async () => {
    const res = makeRes()
    await handler(makeReq({ code: 'AAA-000' }, { 'x-forwarded-for': '198.51.100.7' }), res)
    expect(tablesTouched).toEqual(['try_links'])
    expect(tablesTouched).not.toContain('possession_mint_attempts')
  })

  // SECURITY FINDING AUTH-CORE-03: this is the payoff a single lucky guess
  // yields — a 30-day, all-courses entitlement token, minted to an anonymous
  // caller with no account and no payment.
  it('CHARACTERIZATION: one guessed try-link code mints a 30-day scope:all entitlement token', async () => {
    const res = makeRes()
    await handler(makeReq({ code: 'TRYME' }), res)
    expect(res._status).toBe(200)
    const token = res._json.entitlementToken as string
    expect(token).toBeTruthy()
    const payload = JSON.parse(
      Buffer.from(token.split('.')[0].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString(),
    )
    expect(payload.scope).toBe('all')
    expect(payload.kind).toBe('try')
    expect(payload.exp).toBeGreaterThan(Date.now() + 29 * 24 * 60 * 60 * 1000)
  })

  // SECURITY FINDING AUTH-CORE-10: an unauthenticated caller should get a
  // generic message, the way api/onboarding/provision.ts deliberately does.
  it('CHARACTERIZATION: a DB failure returns its raw message to an unauthenticated caller', async () => {
    lookupError = new Error('permission denied for relation try_links')
    const res = makeRes()
    await handler(makeReq({ code: 'TRYME' }), res)
    expect(res._status).toBe(500)
    expect(res._json.error).toBe('permission denied for relation try_links')
  })

  it.todo('AUTH-CORE-03: /api/try-link/validate answers 429 once the per-IP guess budget is spent')
  it.todo('AUTH-CORE-10: /api/try-link/validate returns a generic message, never a raw DB error string')
})
