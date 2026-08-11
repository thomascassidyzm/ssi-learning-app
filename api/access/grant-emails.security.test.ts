/**
 * SECURITY AUDIT 2026-08-11 — area 1 (auth & identity core).
 *
 * AUTH-CORE-02: an email-allowlist grant is delivered to whichever learner row
 * CLAIMS the address in `learners.verified_emails` — and that column is
 * directly writable by the browser.
 *
 * Evidence chain:
 *   1. supabase/schema.sql:16570 —
 *        GRANT UPDATE(verified_emails) ON TABLE public.learners TO authenticated;
 *      The learners_update_own RLS policy (secfix_16) constrains WHICH ROW you
 *      may write (your own), never the array's CONTENTS.
 *   2. packages/player-vue/src/composables/useAuth.ts:255-261 exercises exactly
 *      that grant from the browser with the anon key, so the grant is live, not
 *      vestigial.
 *   3. api/access/grant-emails.ts:159-176 resolves an admin's grant to accounts
 *      by `.contains('verified_emails', [normalizedEmail])` — treating a
 *      self-writable array as proof of mailbox ownership.
 *   4. api/_utils/entitlementGrant.ts:74-90 then writes
 *      `learners.platform_role = grant.grants_platform_role` verbatim, and
 *      api/_utils/auth.ts:114 admits `platform_role === 'ssi_admin'`.
 *   5. api/access/claim.ts:183-187 stamps redeemed_at, so the intended
 *      recipient's own later claim finds nothing — theft AND denial.
 *
 * api/email/verify.ts is meant to be the only path that puts an address in that
 * array, behind an OTP. The column grant routes around it entirely.
 *
 * Full write-up: docs/security-audit-2026-08-11/auth-core.md
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-key'

vi.mock('../_utils/auth', () => ({
  verifyAdmin: vi.fn(async () => ({ userId: 'ssi-admin-uid' })),
}))

/** The grant row the admin is creating, once inserted. */
const GRANT_ROW = {
  id: 'grant-1',
  access_type: 'full',
  granted_courses: null,
  duration_type: 'lifetime',
  duration_days: null,
  grants_platform_role: 'ssi_admin',
  grants_dashboard_courses: null,
  label: 'Staff comp',
}

/**
 * Who `.contains('verified_emails', [email])` matches. The whole point of the
 * finding: this is the browser-writable array, so the attacker's own learner
 * row can appear here for an address they have never proved.
 */
let learnersClaimingEmail: any[] = []
/** Every write, per table. */
let writes: Record<string, any[]> = {}

function makeChainable(table: string) {
  const calls: any[][] = []
  const rec = (op: string, payload: unknown) => {
    ;(writes[table] = writes[table] || []).push({ op, payload })
  }
  const has = (m: string) => calls.some((c) => c[0] === m)

  const resolve = (): any => {
    if (table === 'email_access_grants') {
      if (has('insert')) return { data: { id: GRANT_ROW.id }, error: null }
      if (has('update')) return { data: null, error: null }
      // The dedupe probe (grant-emails) and the grant list (claim.ts) share
      // this shape; both want the live grant rows for the email.
      return { data: writes.email_access_grants?.some((w) => w.op === 'insert') ? [GRANT_ROW] : [], error: null }
    }
    if (table === 'learners') {
      if (has('contains')) return { data: learnersClaimingEmail, error: null }
      if (has('update')) return { data: null, error: null }
      return { data: { platform_role: null }, error: null }
    }
    if (table === 'user_entitlements') {
      if (has('insert')) return { data: null, error: null }
      return { data: null, error: null } // idempotency probe: not yet applied
    }
    return { data: null, error: null }
  }

  const builder: any = {
    select: (cols?: string) => { calls.push(['select', cols]); return builder },
    insert: (obj: unknown) => { calls.push(['insert', obj]); rec('insert', obj); return builder },
    update: (obj: unknown) => { calls.push(['update', obj]); rec('update', obj); return builder },
    eq: (col: string, val: unknown) => { calls.push(['eq', col, val]); return builder },
    is: (col: string, val: unknown) => { calls.push(['is', col, val]); return builder },
    contains: (col: string, val: unknown) => { calls.push(['contains', col, val]); return builder },
    maybeSingle() { return Promise.resolve(resolve()) },
    single() { return Promise.resolve(resolve()) },
    then(onF: any, onR: any) { return Promise.resolve(resolve()).then(onF, onR) },
  }
  return builder
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: (table: string) => makeChainable(table) }),
}))

function makeRes() {
  const res: any = {}
  res.status = vi.fn((code: number) => { res._status = code; return res })
  res.json = vi.fn((body: unknown) => { res._json = body; return res })
  return res as VercelResponse & { _status?: number; _json?: any }
}

function makeReq(body: unknown): VercelRequest {
  return { method: 'POST', query: {}, headers: { authorization: 'Bearer admin-tok' }, body } as VercelRequest
}

let handler: typeof import('./grant-emails').default

beforeEach(async () => {
  vi.resetModules()
  writes = {}
  learnersClaimingEmail = []
  handler = (await import('./grant-emails')).default
})

describe('AUTH-CORE-02 — email-allowlist grants trust a browser-writable column', () => {
  // SECURITY FINDING AUTH-CORE-02: recipient resolution must not key on
  // learners.verified_emails while `authenticated` holds UPDATE on that column.
  // Either revoke the column grant (routing every write through
  // api/email/verify.ts's OTP), or resolve recipients from a
  // server-attested source (auth.users.email / an OTP-stamped
  // learner_emails row).
  it('CHARACTERIZATION: the grant lands on whichever learner row claims the address', async () => {
    // The attacker's OWN learner row, carrying an address they never proved.
    learnersClaimingEmail = [{ id: 'learner-attacker', verified_emails: ['victim@ssi.example'] }]

    const res = makeRes()
    await handler(
      makeReq({ emails: ['victim@ssi.example'], access_type: 'full', duration_type: 'lifetime', grants_platform_role: 'ssi_admin' }),
      res,
    )

    expect(res._status).toBe(200)
    expect(res._json).toMatchObject({ created: 1, applied_now: 1 })

    // The entitlement went to the claiming row…
    const entitlement = (writes.user_entitlements || []).find((w) => w.op === 'insert')
    expect(entitlement?.payload).toMatchObject({ learner_id: 'learner-attacker', email_access_grant_id: 'grant-1' })

    // …and so did the platform role the grant carried.
    const roleWrite = (writes.learners || []).find((w) => w.op === 'update')
    expect(roleWrite?.payload).toMatchObject({ platform_role: 'ssi_admin' })
  })

  // SECURITY FINDING AUTH-CORE-02: theft is also denial — the grant is stamped
  // redeemed, so the intended recipient's own /api/access/claim finds nothing
  // (claim.ts filters `.is('redeemed_at', null)`).
  it('CHARACTERIZATION: the stolen grant is stamped redeemed, denying the real recipient', async () => {
    learnersClaimingEmail = [{ id: 'learner-attacker', verified_emails: ['victim@ssi.example'] }]

    const res = makeRes()
    await handler(makeReq({ emails: ['victim@ssi.example'], grants_platform_role: 'ssi_admin' }), res)

    const redeemStamp = (writes.email_access_grants || []).find((w) => w.op === 'update')
    expect(redeemStamp?.payload).toHaveProperty('redeemed_at')
    expect(redeemStamp?.payload).toMatchObject({ redeemed_by_learner_id: 'learner-attacker' })
  })

  // Control that HOLDS: with nobody claiming the address, the grant is created
  // and applied to nobody — the admin door itself is sound, and the sibling
  // /api/access/claim path (which derives the email from the VERIFIED token,
  // claim.ts:53-60) is not affected by this finding.
  it('CONTROL: no claimant means the grant is created but applied to nobody', async () => {
    learnersClaimingEmail = []

    const res = makeRes()
    await handler(makeReq({ emails: ['nobody@ssi.example'] }), res)

    expect(res._json).toMatchObject({ created: 1, applied_now: 0 })
    expect(writes.user_entitlements).toBeUndefined()
    expect((writes.learners || []).filter((w) => w.op === 'update')).toHaveLength(0)
  })

  // Control that HOLDS: the endpoint is admin-gated via verifyAdmin, and a
  // non-admin's 403 (which verifyAdmin returns WITH the verified uid — a shape
  // a careless caller could misread as success) is propagated, not swallowed.
  it('CONTROL: a non-admin caller is rejected with verifyAdmin\'s own status', async () => {
    vi.resetModules()
    vi.doMock('../_utils/auth', () => ({
      verifyAdmin: vi.fn(async () => ({ error: 'Requires SSi admin access', status: 403, userId: 'plain-user' })),
    }))
    const guarded = (await import('./grant-emails')).default

    const res = makeRes()
    await guarded(makeReq({ emails: ['victim@ssi.example'], grants_platform_role: 'ssi_admin' }), res)

    expect(res._status).toBe(403)
    expect(writes.email_access_grants).toBeUndefined()
    vi.doUnmock('../_utils/auth')
  })

  it.todo('AUTH-CORE-02: revoke UPDATE(verified_emails) from authenticated so api/email/verify.ts is the only writer')
  it.todo('AUTH-CORE-02: resolve allowlist recipients from a server-attested email, not learners.verified_emails')
})
