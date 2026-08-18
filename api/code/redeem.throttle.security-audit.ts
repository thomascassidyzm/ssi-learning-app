/**
 * SEC-AUDIT-2026-08-18 · Finding 2 — /api/code/redeem is an unthrottled
 * code-enumeration oracle for elevated-role invites.
 *
 * The sibling endpoints already name this exact threat and defend it:
 *
 *   api/code/validate.ts   — "without a throttle it is a code-enumeration
 *                             oracle: the ~13.8M ABC-123 keyspace is sweepable,
 *                             and a hit yields an elevated-role invite
 *                             (teacher/school_admin/govt_admin) ... i.e. school
 *                             infiltration"  → per-IP limit, 429.
 *   api/auth/possession-redeem.ts — per-code AND per-IP limits, 429.
 *
 * api/code/redeem.ts has neither. It requires a bearer token, but sign-up is
 * open self-service OTP, so "authenticated" costs an attacker one throwaway
 * mailbox — and unlike validate.ts, a hit here does not merely *report* the
 * code, it REDEEMS it: the codeType branches write platform_role='ssi_admin',
 * platform_role='tester', educational_role='school_admin'/'teacher', and the
 * govt_admin branch creates a govt_admins row. Every wrong guess returns a
 * uniform 200 {success:false,error:'Invalid code'} with no cost and no record.
 *
 * THIS TEST FAILS ON PURPOSE against current main. It is the finding,
 * executable. It passes once redeem carries a throttle comparable to its two
 * siblings (per-IP and/or per-account attempt window, 429 on exhaustion).
 *
 * No production behaviour is changed by this file.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-key'
process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'anon-key'

const ATTACKER_UID = 'attacker-uid'

/** Every code string the handler looked up — the sweep, as the DB saw it. */
let lookups: string[] = []

vi.mock('@supabase/supabase-js', () => {
  const builder = (table: string): any => {
    const b: any = {}
    b.select = () => b
    b.eq = (col: string, val: unknown) => {
      if (table === 'invite_codes' && col === 'code_normalized') lookups.push(String(val))
      return b
    }
    b.neq = () => b
    b.gte = () => b
    b.insert = () => Promise.resolve({ error: null })
    // Nothing matches: every guess is a miss, which is what a sweep looks like.
    b.single = async () => ({ data: null, error: { code: 'PGRST116' } })
    b.maybeSingle = async () => ({ data: null, error: null })
    b.then = undefined
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
  beforeEach(() => { lookups = [] })

  it('429s a sustained wrong-code sweep from one account and one IP', async () => {
    const { default: handler } = await import('./redeem')

    const ATTEMPTS = 200
    const statuses: number[] = []
    for (let i = 0; i < ATTEMPTS; i++) {
      const out = await guess(handler, `ABC-${String(i).padStart(3, '0')}`, '203.0.113.9')
      statuses.push(out.status)
    }

    // Every one of them reached the code table: no limiter stood in the way.
    expect(lookups).toHaveLength(ATTEMPTS)

    // The property we want: a sweep this size must be refused before it
    // finishes. Against current main every response is 200 {success:false}.
    expect(statuses).toContain(429)
  })

  it('answers a wrong code uniformly and cheaply, with no attempt recorded', async () => {
    const { default: handler } = await import('./redeem')

    const out = await guess(handler, 'ZZZ-999', '203.0.113.9')

    // The oracle: a miss is a clean, free, indistinguishable 200. That is only
    // acceptable when something upstream is counting the misses — nothing is.
    expect(out.status).toBe(200)
    expect(out.body).toMatchObject({ success: false })
    expect(lookups).toEqual(['ZZZ999'])
  })
})
