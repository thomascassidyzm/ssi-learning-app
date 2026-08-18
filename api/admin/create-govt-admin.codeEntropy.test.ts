/**
 * SEC-AUDIT-2026-08-18 · Finding 1 — govt_admin invite codes must be minted
 * from a CSPRNG, not Math.random(). FIXED 2026-08-18; this spec graduated out
 * of the `*.security-audit.ts` suite into the CI-gated `pnpm run test:api`
 * glob, per the audit's own convention, so the fix cannot silently regress.
 *
 * `api/_utils/codeGen.ts` already states the rule for this exact class of
 * secret, in its own words: these codes "gate elevated educational_role grants
 * (teacher/school_admin/govt_admin) into a school/group on redemption, so
 * their minting must not be predictable from observed samples" — which is why
 * generateCode() uses crypto.randomInt.
 *
 * api/admin/create-govt-admin.ts used to NOT use that helper: it carried its
 * own private generateInviteCode() built on Math.random(). The code it mints
 * is the highest-privilege invite in the system: redemption
 * (api/code/redeem.ts, the codeType === 'govt_admin' branch) writes
 * educational_role and creates a govt_admins row, i.e. leadership over a whole
 * region/group subtree.
 *
 * Math.random() in V8 is xorshift128+ — not a CSPRNG. Its internal state is
 * recoverable from a modest run of observed outputs, after which every
 * subsequent (and, by running the generator backwards, every prior) value is
 * derivable. Anyone who can observe a handful of Math.random()-derived values
 * minted by the same serverless instance can predict the next govt_admin code
 * without ever guessing.
 *
 * The endpoint now mints through the shared crypto.randomInt-based
 * generateCode() in api/_utils/codeGen.ts, behind the same unique-code retry
 * loop every other invite mint uses. These two assertions are the property,
 * kept executable: no Math.random() draw, and no determinism even when
 * Math.random() is fully known to an attacker.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-key'
process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'anon-key'

const ADMIN_UID = 'admin-uid'

/** Every invite_codes row the handler tried to insert, in order. */
let inserted: Record<string, unknown>[] = []

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => ({
      insert: (values: Record<string, unknown>) => {
        if (table === 'invite_codes') inserted.push(values)
        return Promise.resolve({ error: null })
      },
      select: () => ({
        // eq().maybeSingle() is the unique-code collision probe; nothing
        // matches, so the first candidate is always accepted.
        eq: () => ({
          single: async () => ({ data: null }),
          maybeSingle: async () => ({ data: null }),
        }),
        ilike: () => ({ maybeSingle: async () => ({ data: null }) }),
      }),
    }),
  }),
}))

vi.mock('../_utils/auth', () => ({
  verifyAdmin: async () => ({ userId: ADMIN_UID }),
}))

function makeReq() {
  return {
    method: 'POST',
    headers: { authorization: 'Bearer admin-token' },
    body: { display_name: 'A Leader', organization_name: 'A Region' },
  } as any
}

function makeRes() {
  const out: { status: number; body: any } = { status: 0, body: null }
  const res: any = {
    status(code: number) { out.status = code; return res },
    json(body: any) { out.body = body; return res },
  }
  return { res, out }
}

describe('SEC-AUDIT Finding 1 — govt_admin invite code entropy', () => {
  beforeEach(() => { inserted = [] })
  afterEach(() => { vi.restoreAllMocks() })

  it('mints the code without consuming Math.random()', async () => {
    const spy = vi.spyOn(Math, 'random')
    const { default: handler } = await import('./create-govt-admin')

    const { res, out } = makeRes()
    await handler(makeReq(), res)

    expect(out.status).toBe(200)
    expect(typeof out.body.invite_code).toBe('string')

    // The assertion IS the finding: a secret that gates govt_admin must not be
    // drawn from a non-cryptographic PRNG.
    expect(spy).not.toHaveBeenCalled()
  })

  it('does not produce a predictable code when Math.random() is predictable', async () => {
    // Stand in for an attacker who has recovered the xorshift128+ state: from
    // that point, Math.random() is a known sequence. A CSPRNG-minted code is
    // unaffected by this; a Math.random()-minted one becomes fully determined.
    const scripted = [0.123456789, 0.234567891, 0.345678912, 0.456789123, 0.56789123, 0.6789123]
    let i = 0
    vi.spyOn(Math, 'random').mockImplementation(() => scripted[i++ % scripted.length])

    const { default: handler } = await import('./create-govt-admin')

    const a = makeRes()
    await handler(makeReq(), a.res)
    i = 0 // rewind the "known sequence" — an attacker replays from the same state
    const b = makeRes()
    await handler(makeReq(), b.res)

    expect(a.out.status).toBe(200)
    expect(b.out.status).toBe(200)
    expect(inserted).toHaveLength(2)
    expect(inserted[0].code_type).toBe('govt_admin')

    // Two independent mints from the same PRNG state produced the same secret.
    // Under a CSPRNG this comparison can never hold, so asserting they DIFFER
    // is the property we want the endpoint to have.
    expect(b.out.body.invite_code).not.toBe(a.out.body.invite_code)
  })

  it('mints in the shared generator\'s alphabet and shape, not a private one', async () => {
    const { default: handler } = await import('./create-govt-admin')
    const { res, out } = makeRes()
    await handler(makeReq(), res)

    // codeGen.generateCode(): 3 consonants (I and O excluded as confusable)
    // + hyphen + 3 digits. The old private generator produced two base36
    // triples (e.g. 'K7Q-3ZB'), which this pattern rejects — so this is a
    // positive check that the endpoint is on the shared generator, not merely
    // off Math.random().
    expect(out.body.invite_code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ]{3}-[0-9]{3}$/)
    expect(inserted[0].code).toBe(out.body.invite_code)
  })
})
