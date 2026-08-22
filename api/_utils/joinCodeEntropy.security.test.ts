/**
 * SEC22-01 — the join-code minter's entropy asymmetry, and who may watch it.
 *
 * Audit 2026-08-22 (branch security/audit-2026-08-22). Escalates ADMIN-ENT-02
 * from the 2026-08-11 audit, which found that the code-entropy hardening pass
 * migrated the APPLICATION minter to `crypto.randomInt` and missed the DATABASE
 * one. This suite adds the half that makes it exploitable rather than merely
 * untidy: `public.generate_join_code()` is granted EXECUTE to `anon`, so the
 * output stream of the weak PRNG is directly samplable by an unauthenticated
 * caller — verified live against production on 2026-08-22 (eight anonymous
 * calls, eight HTTP 200s, eight well-formed codes).
 *
 * WHY THE GRANT IS THE FINDING. `random()` is PostgreSQL's non-cryptographic
 * PRNG, seeded per backend session, not `pgcrypto`'s `gen_random_bytes`. Its
 * output is a deterministic function of internal state, so observed outputs
 * carry information about neighbouring outputs. The application minter's own
 * docstring already states the threat model correctly — these codes "gate
 * elevated educational_role grants (teacher/school_admin/govt_admin)… so their
 * minting must not be predictable from observed samples". The DB minter mints
 * the same class of credential under the same threat model with a PRNG that is
 * predictable from observed samples, and hands anyone the sampling port.
 *
 * The DB minter is live, not vestigial: two triggers call it
 * (`set_class_join_code`, `set_school_join_code`), so it is what actually
 * stamps `classes.join_code` and `schools.join_code`.
 *
 * TEST CONVENTION (inherited from docs/security-audit-2026-08-11/README.md):
 * a real vulnerability is recorded as a CHARACTERIZATION test that asserts
 * today's insecure behaviour and therefore PASSES today, with a paired
 * `it.todo()` naming the secure behaviour. When someone fixes the finding these
 * go red on purpose — that redness is the signal the finding is closed, and the
 * fixer should flip them to the assertions in the `it.todo` names.
 *
 * Nothing here touches a database or a network. Every assertion reads
 * supabase/schema.sql, which is the committed dump of the live schema.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

// Resolved from this file rather than cwd, so the suite runs from the repo root
// or from api/ alike.
const here = dirname(fileURLToPath(import.meta.url))
const schemaPath = resolve(here, '../../supabase/schema.sql')
const schema = readFileSync(schemaPath, 'utf8')

/** The body of a named CREATE FUNCTION, up to its `$$;` terminator. */
function functionBody(name: string): string {
  const start = schema.indexOf(`CREATE FUNCTION public.${name}(`)
  expect(start, `expected ${name}() to exist in schema.sql`).toBeGreaterThan(-1)
  const end = schema.indexOf('$$;', start)
  expect(end, `expected a terminated body for ${name}()`).toBeGreaterThan(start)
  return schema.slice(start, end)
}

describe('SEC22-01: generate_join_code() entropy and exposure', () => {
  // ── The characterization: today's behaviour, asserted so a fix turns it red ──

  // SECURITY FINDING SEC22-01 (a): the DB minter uses a non-cryptographic PRNG.
  it('CHARACTERIZATION: generate_join_code() mints from random(), not a CSPRNG', () => {
    const body = functionBody('generate_join_code')

    expect(body).toContain('random()')
    // Not any of the cryptographic sources that would make this safe.
    expect(body).not.toContain('gen_random_bytes')
    expect(body).not.toContain('gen_random_uuid')
  })

  it.todo(
    'SECURE: generate_join_code() draws from gen_random_bytes()/pgcrypto so codes are not predictable from observed samples',
  )

  // SECURITY FINDING SEC22-01 (b): and anyone may sample that PRNG's stream.
  // This is the half that is new in this audit. Verified live 2026-08-22:
  // POST /rest/v1/rpc/generate_join_code with only the anon key returned
  // 200 "LUB-157", "MXY-755", "DPH-844", "VSM-001", … on production.
  it('CHARACTERIZATION: EXECUTE on the minter is granted to anon and authenticated', () => {
    expect(schema).toContain('GRANT ALL ON FUNCTION public.generate_join_code() TO anon;')
    expect(schema).toContain('GRANT ALL ON FUNCTION public.generate_join_code() TO authenticated;')
  })

  it.todo(
    'SECURE: EXECUTE on generate_join_code() is service_role only — a browser never needs to mint a join code',
  )

  // ── The controls that DO hold, locked as ordinary passing tests ──

  // Why this matters to the finding: it establishes that the secure pattern is
  // already understood and implemented here. The DB path is a missed caller of
  // a completed pass, not an unsolved problem — so the fix is a port, not a
  // design. If this ever regresses, the asymmetry stops being one-sided.
  it('the application minter uses the CSPRNG (crypto.randomInt), not Math.random', () => {
    const codeGen = readFileSync(resolve(here, 'codeGen.ts'), 'utf8')

    expect(codeGen).toContain("from 'crypto'")
    expect(codeGen).toContain('randomInt(')
    expect(codeGen).not.toContain('Math.random')
  })

  it('the board share-code minter uses 128 bits of CSPRNG (the capability-URL model)', () => {
    const codeGen = readFileSync(resolve(here, 'codeGen.ts'), 'utf8')

    expect(codeGen).toContain('randomBytes(16)')
    expect(codeGen).not.toContain('Math.random')
  })

  // The blast radius, pinned: this is not a dormant helper. Two triggers stamp
  // real credentials with it, which is why (a) and (b) are a finding at all.
  it('the weak minter is live — class and school join codes are stamped by it', () => {
    expect(functionBody('set_class_join_code')).toContain('generate_join_code()')
    expect(functionBody('set_school_join_code')).toContain('generate_join_code()')
  })

  // Keyspace, stated rather than assumed, so severity is arguable from evidence
  // rather than from adjectives. 24 consonants ^3 × 10^3 = 13,824,000.
  // That is small enough that unmetered online guessing matters on its own —
  // the 2026-08-11 audit's systemic finding was that api/** has no rate
  // limiting — and predictability shrinks it further.
  it('the code keyspace is 13.8M, small enough that predictability compounds an already-weak space', () => {
    const body = functionBody('generate_join_code')
    const letters = body.match(/letters TEXT := '([A-Z]+)'/)?.[1] ?? ''
    const numbers = body.match(/numbers TEXT := '([0-9]+)'/)?.[1] ?? ''

    expect(letters.length).toBe(24)
    expect(numbers.length).toBe(10)
    expect(letters.length ** 3 * numbers.length ** 3).toBe(13_824_000)
  })
})
