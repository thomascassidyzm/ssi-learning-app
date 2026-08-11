/**
 * SECURITY AUDIT 2026-08-11 — area 1 (auth & identity core).
 *
 * AUTH-CORE-01: POST /api/code/redeem is an UNTHROTTLED code oracle.
 *
 * api/code/validate.ts carries a deliberate per-IP throttle whose own comment
 * spells out the threat model verbatim: "without a throttle it is a
 * code-enumeration oracle: the ~13.8M ABC-123 keyspace is sweepable, and a hit
 * yields an elevated-role invite (teacher/school_admin/govt_admin) ... i.e.
 * school infiltration."
 *
 * redeem.ts performs the SAME lookup against the SAME codes with NO throttle at
 * all — and, unlike validate, a hit does not merely reveal the code, it GRANTS
 * the role to the caller. The only gate is a valid bearer token, which any
 * self-signup account has.
 *
 * These tests characterise the current (vulnerable) behaviour so it is
 * documented executably, and lock the payoff a hit yields.
 *
 * Full write-up: docs/security-audit-2026-08-11/auth-core.md
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-key'

vi.mock('../_utils/auth', () => ({
  verifyAuthToken: vi.fn(async () => ({ valid: true, userId: 'attacker-auth-uid' })),
}))

/** Every table the handler touched, in order — the throttle-presence probe. */
let tablesTouched: string[] = []
/** Every write (insert/update/upsert) per table. */
let writes: Record<string, any[]> = {}
/** Per-table responders: (calls) => { data, error } | undefined. */
let responders: Record<string, (calls: any[][]) => any> = {}

function makeChainable(table: string) {
  tablesTouched.push(table)
  const calls: any[][] = []
  const builder: any = {
    select: (cols?: string) => { calls.push(['select', cols]); return builder },
    insert: (obj: unknown) => {
      calls.push(['insert', obj])
      ;(writes[table] = writes[table] || []).push({ op: 'insert', payload: obj })
      return builder
    },
    update: (obj: unknown) => {
      calls.push(['update', obj])
      ;(writes[table] = writes[table] || []).push({ op: 'update', payload: obj })
      return builder
    },
    upsert: (obj: unknown) => {
      calls.push(['upsert', obj])
      ;(writes[table] = writes[table] || []).push({ op: 'upsert', payload: obj })
      return builder
    },
    delete: () => { calls.push(['delete']); return builder },
    eq: (col: string, val: unknown) => { calls.push(['eq', col, val]); return builder },
    neq: (col: string, val: unknown) => { calls.push(['neq', col, val]); return builder },
    gte: (col: string, val: unknown) => { calls.push(['gte', col, val]); return builder },
    is: (col: string, val: unknown) => { calls.push(['is', col, val]); return builder },
    resolve: () => {
      const respond = responders[table]
      if (respond) {
        const r = respond(calls)
        if (r !== undefined) return r
      }
      return { data: null, error: null }
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
    rpc: (name: string, params: any) =>
      Promise.resolve(name === 'claim_invite_code_use' ? { data: params.p_id, error: null } : { data: null, error: null }),
    auth: { admin: { getUserById: () => Promise.resolve({ data: { user: { email: 'attacker@example.com' } } }) } },
  }),
}))

function makeRes() {
  const res: any = {}
  res.status = vi.fn((code: number) => { res._status = code; return res })
  res.json = vi.fn((body: unknown) => { res._json = body; return res })
  return res as VercelResponse & { _status?: number; _json?: any }
}

function makeReq(body: unknown): VercelRequest {
  return { method: 'POST', query: {}, headers: { authorization: 'Bearer attacker-token' }, body } as VercelRequest
}

let handler: typeof import('./redeem').default

beforeEach(async () => {
  vi.resetModules()
  tablesTouched = []
  writes = {}
  responders = {}
  handler = (await import('./redeem')).default
})

describe('AUTH-CORE-01 — /api/code/redeem code-guessing throttle', () => {
  // SECURITY FINDING AUTH-CORE-01: a single authenticated account can sweep the
  // whole ~13.8M ABC-123 keyspace against this endpoint. It should consult the
  // same possession_mint_attempts budget /api/code/validate does (per-IP AND
  // per-account) and answer 429 once the window is full.
  it('CHARACTERIZATION: 25 wrong-code redemptions in a row, none throttled', async () => {
    // invite_codes.select(...).single() finds nothing -> "Invalid code".
    responders.invite_codes = () => ({ data: null, error: { code: 'PGRST116' } })

    const statuses: (number | undefined)[] = []
    const bodies: any[] = []
    for (let i = 0; i < 25; i++) {
      const res = makeRes()
      await handler(makeReq({ code: `GUESS-${String(i).padStart(3, '0')}`, codeKind: 'invite' }), res)
      statuses.push(res._status)
      bodies.push(res._json)
    }

    expect(statuses.every((s) => s === 200)).toBe(true)
    expect(statuses).not.toContain(429)
    expect(bodies.every((b) => b.success === false && b.error === 'Invalid code')).toBe(true)
  })

  // SECURITY FINDING AUTH-CORE-01: the absence of any read of the throttle
  // table is the finding. /api/code/validate reads possession_mint_attempts
  // before its lookup; redeem never mentions it.
  it('CHARACTERIZATION: never consults the possession_mint_attempts rate-limit budget', async () => {
    responders.invite_codes = () => ({ data: null, error: { code: 'PGRST116' } })

    const res = makeRes()
    await handler(makeReq({ code: 'GUESS-001', codeKind: 'invite' }), res)

    expect(tablesTouched).toContain('invite_codes')
    expect(tablesTouched).not.toContain('possession_mint_attempts')
  })

  // SECURITY FINDING AUTH-CORE-01: this is the PAYOFF a single lucky guess
  // yields — full platform admin on the guesser's own account. Documented here
  // so the stakes of the missing throttle are executable, not rhetorical.
  it('CHARACTERIZATION: one guessed ssi_admin code grants the caller platform_role=ssi_admin', async () => {
    responders.invite_codes = (calls) =>
      calls.some((c) => c[0] === 'select')
        ? {
            data: {
              id: 'invite-admin',
              code: 'ZZZ-999',
              code_type: 'ssi_admin',
              grants_region: null,
              grants_school_id: null,
              grants_class_id: null,
              grants_group_id: null,
              metadata: null,
              max_uses: null,
              use_count: 0,
              expires_at: null,
              is_active: true,
            },
            error: null,
          }
        : { data: null, error: null }
    // The guesser already has a learner row, and is NOT an operator account
    // (isOperatorAccount reads platform_role off the same table).
    responders.learners = (calls) =>
      calls.some((c) => c[0] === 'select') ? { data: { id: 'learner-att', platform_role: null }, error: null } : { data: null, error: null }

    const res = makeRes()
    await handler(makeReq({ code: 'ZZZ-999', codeKind: 'invite' }), res)

    expect(res._status).toBe(200)
    expect(res._json).toMatchObject({ success: true, role: 'ssi_admin', redirectTo: '/admin' })
    const learnerUpdate = (writes.learners || []).find((w) => w.op === 'update')
    expect(learnerUpdate?.payload).toMatchObject({ platform_role: 'ssi_admin' })
  })

  it.todo('AUTH-CORE-01: /api/code/redeem answers 429 once the per-IP / per-account guess budget is spent')
  it.todo('AUTH-CORE-01: redemption codes are minted from a keyspace too large to sweep (see api/_utils/codeGen.ts)')
})
