/**
 * SEC22-01 — the join-code minter's entropy, and who may reach it. CLOSED.
 *
 * Found by the 2026-08-22 audit (branch security/audit-2026-08-22), which
 * escalated ADMIN-ENT-02 from 2026-08-11: the code-entropy hardening pass had
 * migrated the APPLICATION minter to `crypto.randomInt` and missed the
 * DATABASE one. `public.generate_join_code()` minted from `random()` — a
 * non-cryptographic PRNG whose output is a deterministic function of internal
 * state — and EXECUTE was granted to `anon`, so the stream was directly
 * samplable by an unauthenticated caller. Verified live against production on
 * 2026-08-22: eight anonymous calls, eight HTTP 200s, eight well-formed codes.
 *
 * FIXED 2026-08-22 by supabase/migrations/20260822_join_code_csprng_and_grant_lockdown.sql
 * (canary supabase/secfix-toolkit/canary_join_code_csprng.cjs, 15/15 green,
 * applied live). The minter now draws from pgcrypto's `gen_random_bytes` with
 * rejection sampling, and EXECUTE is service_role only. The same eight-call
 * anonymous probe now returns eight 401s carrying
 * `permission denied for function generate_join_code`.
 *
 * The characterization tests that recorded the vulnerable behaviour have been
 * flipped to the assertions their paired `it.todo()`s named, per the test
 * convention in docs/security-audit-2026-08-11/README.md. They are now
 * regression guards: if either half comes back, these go red.
 *
 * WHY THE TRIGGER FUNCTIONS ARE SECURITY DEFINER (guarded below). `authenticated`
 * holds INSERT on public.classes — a signed-in teacher creates a class straight
 * from the browser — so the BEFORE-INSERT trigger `set_class_join_code` used to
 * reach the minter as the teacher. Revoking EXECUTE from `authenticated` would
 * have killed that legitimate path outright. Marking the two trigger functions
 * SECURITY DEFINER moves the mint inside the owner's rights instead. Neither
 * trigger function touches a table — each only assigns a generated string onto
 * NEW — so the definer surface is nil. Flip one back to INVOKER and real class
 * creation breaks; that is what the guard here protects.
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
  // ── The fix, locked as regression guards ──

  // SEC22-01 (a), closed: the DB minter draws from a CSPRNG.
  it('SECURE: generate_join_code() draws from gen_random_bytes()/pgcrypto so codes are not predictable from observed samples', () => {
    const body = functionBody('generate_join_code')

    // pgcrypto lives in the `extensions` schema on this database, so the call
    // is schema-qualified rather than search_path-dependent.
    expect(body).toContain('extensions.gen_random_bytes(1)')
    // The weak PRNG is gone. `random()` as a whole call, not the substring —
    // `gen_random_bytes` legitimately contains the word.
    expect(body).not.toMatch(/(?<!gen_)random\(\)/)
  })

  // The bytes→character mapping must be uniform. A bare `byte % 24` would make
  // the first 16 consonants ~1.5x likelier than the last 8, quietly shrinking
  // the effective keyspace — a CSPRNG sampled with bias is not a fix.
  it('SECURE: the byte→character mapping is rejection-sampled, so no modulo bias', () => {
    const body = functionBody('generate_join_code')

    expect(body).toContain('EXIT WHEN b < 240') // 24 * 10, the unbiased cut for %24
    expect(body).toContain('EXIT WHEN b < 250') // 25 * 10, the unbiased cut for %10
  })

  // SEC22-01 (b), closed: the RPC sampling port. Verified live 2026-08-22 —
  // the audit's own eight-call anon probe went from eight 200s carrying
  // "LUB-157", "MXY-755", … to eight 401 "permission denied for function
  // generate_join_code".
  it('SECURE: EXECUTE on generate_join_code() is service_role only — a browser never needs to mint a join code', () => {
    expect(schema).toContain('REVOKE ALL ON FUNCTION public.generate_join_code() FROM PUBLIC;')
    expect(schema).toContain('GRANT ALL ON FUNCTION public.generate_join_code() TO service_role;')
    expect(schema).not.toContain('GRANT ALL ON FUNCTION public.generate_join_code() TO anon;')
    expect(schema).not.toContain('GRANT ALL ON FUNCTION public.generate_join_code() TO authenticated;')
  })

  // The half that keeps the revoke from being a regression: see the file
  // docstring. `authenticated` inserts classes from the browser, so the
  // triggers must reach the minter as the owner, not as the teacher.
  it('the class/school triggers reach the minter as SECURITY DEFINER, so signed-in creation still mints', () => {
    expect(functionBody('set_class_join_code')).toContain('SECURITY DEFINER')
    expect(functionBody('set_school_join_code')).toContain('SECURITY DEFINER')
  })

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
  // real credentials with it, which is why (a) and (b) were a finding at all —
  // and why the fix had to keep those two callers working.
  it('the minter is live — class and school join codes are stamped by it', () => {
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
