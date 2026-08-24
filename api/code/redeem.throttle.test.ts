/**
 * SEC-AUDIT-2026-08-18 · Finding 2 — /api/code/redeem must not be an
 * unthrottled code-enumeration oracle for elevated-role invites. FIXED
 * 2026-08-18; this spec graduated out of the `*.security-audit.ts` suite into
 * the CI-gated `pnpm run test:api` glob, per the audit's own convention.
 *
 * The threat, and the defence, in the siblings' own words:
 *
 *   api/code/validate.ts   — "without a throttle it is a code-enumeration
 *                             oracle: the ~13.8M ABC-123 keyspace is sweepable,
 *                             and a hit yields an elevated-role invite
 *                             (teacher/school_admin/govt_admin) ... i.e. school
 *                             infiltration"  → per-IP limit, 429.
 *   api/auth/possession-redeem.ts — per-code AND per-IP limits, 429.
 *
 * redeem.ts had neither. It requires a bearer token, but sign-up is open
 * self-service OTP, so "authenticated" costs an attacker one throwaway
 * mailbox — and unlike validate.ts, a hit here does not merely *report* the
 * code, it REDEEMS it: the codeType branches write platform_role='ssi_admin',
 * platform_role='tester', educational_role='school_admin'/'teacher', and the
 * govt_admin branch creates a govt_admins row.
 *
 * redeem.ts now runs the shared per-IP throttle (api/_utils/codeAttemptThrottle.ts)
 * against the same possession_mint_attempts table, window and limit as both
 * siblings, before any code lookup. These assertions are that property:
 *   1. a sustained sweep from one IP is refused with a 429 before it finishes,
 *      and the refused guesses never reach the code table;
 *   2. a single wrong guess still answers uniformly and cheaply — but is now
 *      RECORDED, which is what makes (1) possible.
 *
 * The throttle is per-IP only, matching the siblings exactly. The bucket key
 * is a client-set header — that is Finding 5, which is still open and is
 * deliberately shared by all three endpoints so it stays a one-place fix.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PER_IP_LIMIT } from '../_utils/codeAttemptThrottle'

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-key'
process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'anon-key'

const ATTACKER_UID = 'attacker-uid'

/** Every code string the handler looked up — the sweep, as the DB saw it. */
let lookups: string[] = []
/** The throttle ledger: possession_mint_attempts, as the DB holds it. */
let attempts: Record<string, any>[] = []

vi.mock('@supabase/supabase-js', () => {
  const builder = (table: string): any => {
    // Filters accumulated on this query, applied when the ledger is counted.
    const eqs: [string, unknown][] = []
    const neqs: [string, unknown][] = []
    let counting = false

    const b: any = {}
    b.select = (_cols: string, opts?: { count?: string; head?: boolean }) => {
      if (opts?.count) counting = true
      return b
    }
    b.eq = (col: string, val: unknown) => {
      if (table === 'invite_codes' && col === 'code_normalized') lookups.push(String(val))
      eqs.push([col, val])
      return b
    }
    b.neq = (col: string, val: unknown) => { neqs.push([col, val]); return b }
    b.is = () => b
    b.insert = (row: Record<string, unknown>) => {
      if (table === 'possession_mint_attempts') attempts.push({ ...row, created_at: new Date().toISOString() })
      return Promise.resolve({ error: null })
    }
    // Nothing matches: every guess is a miss, which is what a sweep looks like.
    b.single = async () => ({ data: null, error: { code: 'PGRST116' } })
    b.maybeSingle = async () => ({ data: null, error: null })

    const settle = () => {
      if (counting && table === 'possession_mint_attempts') {
        const rows = attempts.filter((r) =>
          eqs.every(([c, v]) => r[c] === v) && neqs.every(([c, v]) => r[c] !== v)
        )
        return { data: null, error: null, count: rows.length }
      }
      return { data: null, error: null, count: 0 }
    }
    // `.gte(...)` is the last link in the count chain, so it must resolve.
    b.gte = () => Promise.resolve(settle())
    b.then = (onF: any, onR: any) => Promise.resolve(settle()).then(onF, onR)
    return b
  }
  return {
    createClient: () => ({
      from: (table: string) => builder(table),
      rpc: async () => ({ data: null, error: null }),
    }),
  }
})

vi.mock('../_utils/auth', () => ({
  verifyAuthToken: async () => ({ valid: true, userId: ATTACKER_UID }),
}))

function makeRes() {
  const out: { status: number; body: any } = { status: 0, body: null }
  const res: any = {
    status(code: number) { out.status = code; return res },
    json(body: any) { out.body = body; return res },
  }
  return { res, out }
}

/** One guess in the sweep. */
async function guess(handler: any, code: string, ip: string) {
  const { res, out } = makeRes()
  await handler({
    method: 'POST',
    headers: { authorization: 'Bearer attacker-token', 'x-forwarded-for': ip },
    socket: { remoteAddress: ip },
    body: { code, codeKind: 'invite' },
  } as any, res)
  return out
}

describe('SEC-AUDIT Finding 2 — /api/code/redeem enumeration throttle', () => {
  beforeEach(() => { lookups = []; attempts = [] })

  it('429s a sustained wrong-code sweep from one account and one IP', async () => {
    const { default: handler } = await import('./redeem')

    const ATTEMPTS = 200
    const statuses: number[] = []
    for (let i = 0; i < ATTEMPTS; i++) {
      const out = await guess(handler, `ABC-${String(i).padStart(3, '0')}`, '203.0.113.9')
      statuses.push(out.status)
    }

    // The sweep is refused before it finishes, and the refused guesses never
    // reach the code table.
    expect(statuses).toContain(429)
    expect(lookups.length).toBeLessThan(ATTEMPTS)
    expect(lookups).toHaveLength(PER_IP_LIMIT)
    expect(statuses.filter((s) => s === 429)).toHaveLength(ATTEMPTS - PER_IP_LIMIT)

    // The refusals themselves are not counted into the window — a limiter
    // counts actions, not its own refusals — so a retrying client cannot keep
    // its own block alive forever.
    expect(attempts.filter((a) => a.outcome === 'redeem_attempt')).toHaveLength(PER_IP_LIMIT)
  })

  it('answers a wrong code uniformly and cheaply, and records the attempt', async () => {
    const { default: handler } = await import('./redeem')

    const out = await guess(handler, 'ZZZ-999', '203.0.113.9')

    // A miss is still a clean, indistinguishable 200 — no oracle is created by
    // the fix — but it is no longer free: something upstream is now counting.
    expect(out.status).toBe(200)
    expect(out.body).toMatchObject({ success: false })
    expect(lookups).toEqual(['ZZZ999'])
    expect(attempts).toHaveLength(1)
    expect(attempts[0]).toMatchObject({ outcome: 'redeem_attempt', auth_user_id: ATTACKER_UID })
    // Only ever the hash — raw IPs are never stored.
    expect(attempts[0].ip_hash).not.toContain('203.0.113.9')
  })

  it('buckets by IP: a different IP is unaffected by another IP spending its window', async () => {
    const { default: handler } = await import('./redeem')

    for (let i = 0; i < PER_IP_LIMIT + 5; i++) {
      await guess(handler, `ABC-${String(i).padStart(3, '0')}`, '203.0.113.9')
    }
    const other = await guess(handler, 'QRS-123', '198.51.100.4')

    expect(other.status).toBe(200)
  })
})
