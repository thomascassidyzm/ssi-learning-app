/**
 * SECURITY AUDIT 2026-08-11 — area 1 (auth & identity core).
 *
 * POST /api/admin/create-signin-link mints a real Supabase magic link for an
 * arbitrary learner and hands the URL back over the wire. Whoever clicks it
 * becomes that user — so this is the most powerful endpoint in this area, and
 * its two bounds (verifyAdmin, plus a per-admin mint quota) are all there is.
 *
 * AUTH-CORE-07 (finding): the quota FAILS OPEN — if the counting query errors,
 *   the handler logs a warning and mints anyway (create-signin-link.ts:78-79).
 *   Everything else in this file is deliberately fail-closed; this is the one
 *   bound that isn't, on the one endpoint where a bound matters most.
 *
 * AUTH-CORE-08 (finding, low): the magic link's `redirectTo` is derived from
 *   the unvalidated `Host` header for any non-canonical host
 *   (create-signin-link.ts:31-37, `return https://${host}`), and the same value
 *   picks the audit row's `env` label.
 *
 * Full write-up: docs/security-audit-2026-08-11/auth-core.md
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-key'

let verifyAdminResult: any
vi.mock('../_utils/auth', () => ({
  verifyAdmin: vi.fn(async () => verifyAdminResult),
}))

/** What the per-admin quota count query resolves to. */
let rateResult: { count: number | null; error: any }
let generateLinkArg: any
let generateLinkResult: any
let auditInserts: any[]

function makeChainable(table: string) {
  const calls: any[][] = []
  const builder: any = {
    select: (cols?: string, opts?: any) => { calls.push(['select', cols, opts]); return builder },
    insert: (obj: any) => { if (table === 'player_events') auditInserts.push(obj); return Promise.resolve({ error: null }) },
    eq: (c: string, v: unknown) => { calls.push(['eq', c, v]); return builder },
    gte: (c: string, v: unknown) => { calls.push(['gte', c, v]); return builder },
    order: () => builder,
    limit: () => builder,
    contains: (c: string, v: unknown) => { calls.push(['contains', c, v]); return Promise.resolve(rateResult) },
    single: () =>
      Promise.resolve(
        table === 'learners'
          ? { data: { id: 'learner-target', user_id: 'target-auth-uid', display_name: 'Target' }, error: null }
          : { data: null, error: null },
      ),
    maybeSingle: () =>
      Promise.resolve(table === 'learner_emails' ? { data: { email: 'target@school.example' }, error: null } : { data: null, error: null }),
  }
  return builder
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => makeChainable(table),
    auth: { admin: { generateLink: (arg: any) => { generateLinkArg = arg; return Promise.resolve(generateLinkResult) } } },
  }),
}))

function makeRes() {
  const res: any = {}
  res.status = vi.fn((code: number) => { res._status = code; return res })
  res.json = vi.fn((body: unknown) => { res._json = body; return res })
  return res as VercelResponse & { _status?: number; _json?: any }
}

function makeReq(body: unknown, headers: Record<string, string> = {}): VercelRequest {
  return { method: 'POST', query: {}, headers: { authorization: 'Bearer admin-tok', ...headers }, body } as VercelRequest
}

let handler: typeof import('./create-signin-link').default

beforeEach(async () => {
  vi.resetModules()
  verifyAdminResult = { userId: 'ssi-admin-uid' }
  rateResult = { count: 0, error: null }
  generateLinkArg = undefined
  generateLinkResult = { data: { properties: { action_link: 'https://example.supabase.co/auth/v1/verify?token=abc' } }, error: null }
  auditInserts = []
  handler = (await import('./create-signin-link')).default
})

describe('AUTH-CORE-07 — per-admin mint quota', () => {
  // Control that HOLDS: admin gate first. A non-admin gets verifyAdmin's own
  // status and no link is minted.
  it('CONTROL: a non-admin caller is refused before any link is minted', async () => {
    verifyAdminResult = { error: 'Requires SSi admin access', status: 403, userId: 'plain-user' }
    const res = makeRes()
    await handler(makeReq({ learner_id: 'learner-target' }), res)

    expect(res._status).toBe(403)
    expect(generateLinkArg).toBeUndefined()
  })

  // Control that HOLDS: when the quota query works, the limit bites.
  it('CONTROL: 429s once the admin is over the recent-mint limit', async () => {
    rateResult = { count: 15, error: null }
    const res = makeRes()
    await handler(makeReq({ learner_id: 'learner-target' }), res)

    expect(res._status).toBe(429)
    expect(generateLinkArg).toBeUndefined()
  })

  // SECURITY FINDING AUTH-CORE-07: the quota should fail CLOSED (503/500) when
  // it cannot be evaluated — an unreadable player_events currently means an
  // unlimited mint rate on the endpoint that hands out other people's sessions.
  it('CHARACTERIZATION: an unreadable quota table lets the mint through anyway', async () => {
    rateResult = { count: null, error: { message: 'permission denied for relation player_events' } }
    const res = makeRes()
    await handler(makeReq({ learner_id: 'learner-target' }), res)

    expect(res._status).toBe(200)
    expect(res._json.action_link).toContain('token=abc')
    expect(generateLinkArg).toMatchObject({ type: 'magiclink', email: 'target@school.example' })
  })

  it.todo('AUTH-CORE-07: the per-admin mint quota fails CLOSED when player_events cannot be counted')
})

describe('AUTH-CORE-08 — magic-link redirect target from the Host header', () => {
  // Control that HOLDS: the two canonical hosts are pinned to literals, and
  // no client-supplied body field can influence the redirect.
  it('CONTROL: canonical hosts map to their own hard-coded origins', async () => {
    const res = makeRes()
    await handler(makeReq({ learner_id: 'learner-target', redirectTo: 'https://evil.example' }, { host: 'www.saysomethingin.app' }), res)
    expect(generateLinkArg.options).toEqual({ redirectTo: 'https://saysomethingin.app' })
  })

  // SECURITY FINDING AUTH-CORE-08: any other Host value is echoed straight into
  // the magic link's redirectTo. In practice Supabase's own redirect allowlist
  // is the backstop (off-repo, UNVERIFIED here) — the endpoint itself does not
  // constrain the value. It should use an allowlist of known app origins and
  // fall back to the production origin.
  it('CHARACTERIZATION: an arbitrary Host header becomes the link\'s redirectTo', async () => {
    const res = makeRes()
    await handler(makeReq({ learner_id: 'learner-target' }, { host: 'attacker.example:443' }), res)

    expect(res._status).toBe(200)
    expect(generateLinkArg.options).toEqual({ redirectTo: 'https://attacker.example' })
    // …and the same value picks the audit row's environment label.
    expect(auditInserts[0]).toMatchObject({ env: 'dev', payload: { actor_user_id: 'ssi-admin-uid', target_user_id: 'target-auth-uid' } })
  })

  it.todo('AUTH-CORE-08: redirectTo is chosen from an allowlist of app origins, never from the raw Host header')
})
