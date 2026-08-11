/**
 * Security audit 2026-08-11 — area 4 (admin-entitlement).
 * See docs/security-audit-2026-08-11/admin-entitlement.md
 *
 * Code minting and trial-burn keying:
 *   ADMIN-ENT-02 — the DB trigger generate_join_code() uses non-crypto random()
 *                  while this module was hardened to a CSPRNG.
 *   ADMIN-ENT-03 — the shared ABC-123 keyspace is only ~23.7 bits.
 *   ADMIN-ENT-08 — trial burns key on the raw address, so +tag aliases re-trial.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { generateCode, generateShareCode } from './codeGen'

const SCHEMA_SQL = join(__dirname, '..', '..', 'supabase', 'schema.sql')

describe('generateCode — ADMIN-ENT-03: keyspace size', () => {
  it('always emits the ABC-123 shape', () => {
    for (let i = 0; i < 200; i++) {
      expect(generateCode()).toMatch(/^[A-HJ-NP-Z]{3}-\d{3}$/)
    }
  })

  it('never emits the confusable letters I or O', () => {
    for (let i = 0; i < 500; i++) {
      expect(generateCode().slice(0, 3)).not.toMatch(/[IO]/)
    }
  })

  // SECURITY FINDING ADMIN-ENT-03: 24 consonants ^3 * 10^3 = 13,824,000 codes
  // (~2^23.7). This one keyspace covers staff-granting invite code types
  // (teacher / school_admin / school_admin_join / govt_admin), whose only brake
  // is the 10-per-15-min per-IP throttle at api/code/validate.ts:82-109.
  // SHOULD BE: staff-granting code types mint at 128 bits — generateShareCode
  // in this same module is the in-repo precedent.
  it('ADMIN-ENT-03: the whole code space is only ~23.7 bits', () => {
    const alphabet = 24 // A-Z minus I and O
    const keyspace = alphabet ** 3 * 10 ** 3
    expect(keyspace).toBe(13_824_000)
    expect(Math.log2(keyspace)).toBeLessThan(24)
  })

  it.todo(
    'ADMIN-ENT-03: staff-granting invite code types (teacher/school_admin/school_admin_join/govt_admin) should mint at 128 bits, not 23.7',
  )

  // The 128-bit precedent that the ADMIN-ENT-02/03 fixes should follow.
  it('CONTROL: generateShareCode is 128-bit and URL-safe', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 500; i++) {
      const c = generateShareCode()
      expect(c).toMatch(/^[A-Za-z0-9_-]{22}$/) // 16 bytes base64url, unpadded
      seen.add(c)
    }
    expect(seen.size).toBe(500) // no collisions at 128 bits
  })

  it('CONTROL: generateCode is not obviously biased across the alphabet', () => {
    // A weak sanity check on the CSPRNG path — every consonant should appear
    // across a large sample, which a stuck/constant generator would fail.
    const seen = new Set<string>()
    for (let i = 0; i < 4000; i++) {
      for (const ch of generateCode().slice(0, 3)) seen.add(ch)
    }
    expect(seen.size).toBe(24)
  })
})

describe('ADMIN-ENT-02 — the DB join-code minter is a non-CSPRNG', () => {
  const schema = readFileSync(SCHEMA_SQL, 'utf8')

  // SECURITY FINDING ADMIN-ENT-02: generate_join_code() (schema.sql:2500) mints
  // schools.teacher_join_code and schools.admin_join_code — bearer credentials
  // that api/_utils/schoolJoinCodes.ts registers as redeemable invite_codes and
  // that api/code/redeem.ts turns into staff membership of that school — using
  // Postgres random(), a seedable non-cryptographic PRNG. The application-side
  // minter in ./codeGen.ts was deliberately hardened to crypto.randomInt and
  // says so in its own comment; the trigger was not.
  // SHOULD BE: gen_random_bytes() (pgcrypto, already relied on for
  // gen_random_uuid) with rejection sampling onto the same alphabet.
  it('ADMIN-ENT-02: generate_join_code() still calls random()', () => {
    const fn = schema.slice(schema.indexOf('CREATE FUNCTION public.generate_join_code()'))
    const body = fn.slice(0, fn.indexOf('$$;') + 3)
    expect(body).toContain('random()')
    expect(body).not.toContain('gen_random_bytes')
  })

  it('ADMIN-ENT-02: those codes really are the ones that grant staff access', () => {
    // The trigger writes them...
    expect(schema).toContain('NEW.teacher_join_code := new_code')
    expect(schema).toContain('NEW.admin_join_code := new_code')
    // ...and schoolJoinCodes.ts registers them as redeemable invite codes.
    const reg = readFileSync(join(__dirname, 'schoolJoinCodes.ts'), 'utf8')
    expect(reg).toContain("code_type: 'teacher'")
    expect(reg).toContain("code_type: 'school_admin_join'")
  })

  it.todo(
    'ADMIN-ENT-02: generate_join_code() should mint from pgcrypto gen_random_bytes, matching the CSPRNG guarantee codeGen.ts already makes',
  )

  // CONTROL: the app-side minter is a CSPRNG and must stay one.
  it('CONTROL: codeGen.ts mints from crypto, not Math.random', () => {
    const src = readFileSync(join(__dirname, 'codeGen.ts'), 'utf8')
    expect(src).toContain("from 'crypto'")
    expect(src).toContain('randomInt(')
    expect(src).not.toContain('Math.random')
  })
})

describe('ADMIN-ENT-08 — trial burns key on the raw address', () => {
  const schema = readFileSync(SCHEMA_SQL, 'utf8')

  it('CONTROL: one trial per (email, track) is a real primary key', () => {
    expect(schema).toContain('trial_burns_pkey PRIMARY KEY (email, track)')
  })

  // SECURITY FINDING ADMIN-ENT-08: the key is the literal address. Callers do
  // normalise case and whitespace (api/onboarding/provision.ts:130,
  // api/code/redeem.ts:590 both .trim().toLowerCase()) and block disposable
  // domains, but sub-addressing is untouched: alice+1@ and alice+2@ are
  // distinct keys that deliver to one inbox, so the "one platform trial per
  // email FOREVER" rule is re-trialable at will.
  // SHOULD BE: canonicalise (strip +tag, and dots for dot-insensitive
  // providers) before the burn insert.
  it('ADMIN-ENT-08: the burn key does not canonicalise +tag sub-addresses', () => {
    const burnKey = (email: string) => email.trim().toLowerCase() // what callers do today
    expect(burnKey('Alice@Example.com ')).toBe(burnKey('alice@example.com')) // case/space: handled
    expect(burnKey('alice+1@example.com')).not.toBe(burnKey('alice@example.com')) // sub-address: not
    expect(burnKey('alice+2@example.com')).not.toBe(burnKey('alice+1@example.com'))
  })

  it.todo(
    'ADMIN-ENT-08: trial_burns should key on a canonicalised address so +tag aliases cannot mint repeat trials',
  )

  it('CONTROL: the burn is inserted BEFORE the trial is granted', () => {
    const src = readFileSync(join(__dirname, 'schoolPlatformTrial.ts'), 'utf8')
    const burnAt = src.indexOf('const burn = await burnTrial(supabase, email, \'school\'')
    const grantAt = src.indexOf('// Fresh burn → grant the trial on the schools row.')
    expect(burnAt).toBeGreaterThan(-1)
    expect(grantAt).toBeGreaterThan(burnAt)
  })
})

describe('CONTROL — code redemption is race-free at the database', () => {
  const schema = readFileSync(SCHEMA_SQL, 'utf8')

  // Two concurrent redemptions of a single-use code cannot both win: the guard
  // and the increment are one statement, so the second UPDATE re-evaluates the
  // WHERE after taking the row lock and matches nothing.
  it('claim_invite_code_use guards and increments in a single UPDATE', () => {
    const fn = schema.slice(schema.indexOf('CREATE FUNCTION public.claim_invite_code_use'))
    const body = fn.slice(0, fn.indexOf('$$;') + 3)
    expect(body).toContain('UPDATE invite_codes')
    expect(body).toContain('use_count = use_count + 1')
    expect(body).toContain('(max_uses IS NULL OR use_count < max_uses)')
    expect(body).toContain('(expires_at IS NULL OR expires_at > now())')
    expect(body).toContain('RETURNING id')
  })

  it('claim_entitlement_code_use has the same single-statement shape', () => {
    const fn = schema.slice(schema.indexOf('CREATE FUNCTION public.claim_entitlement_code_use'))
    const body = fn.slice(0, fn.indexOf('$$;') + 3)
    expect(body).toContain('UPDATE entitlement_codes')
    expect(body).toContain('(max_uses IS NULL OR use_count < max_uses)')
  })

  it('both claim RPCs are service-role only, with a pinned search_path', () => {
    expect(schema).toContain('REVOKE ALL ON FUNCTION public.claim_invite_code_use(p_id uuid) FROM PUBLIC')
    expect(schema).toContain('REVOKE ALL ON FUNCTION public.claim_entitlement_code_use(p_id uuid) FROM PUBLIC')
    expect(schema).not.toContain('GRANT ALL ON FUNCTION public.claim_invite_code_use(p_id uuid) TO authenticated')
    expect(schema).not.toContain('GRANT ALL ON FUNCTION public.claim_entitlement_code_use(p_id uuid) TO authenticated')
    const fn = schema.slice(schema.indexOf('CREATE FUNCTION public.claim_invite_code_use'))
    expect(fn.slice(0, 400)).toContain("SET search_path TO 'public', 'pg_temp'")
  })
})

describe('CONTROL — learners.platform_role cannot be self-escalated', () => {
  const schema = readFileSync(SCHEMA_SQL, 'utf8')

  // This is the single most load-bearing grant on the admin surface: verifyAdmin
  // (api/_utils/auth.ts:114) trusts learners.platform_role, and learners_update_own
  // would otherwise let a user UPDATE their own row freely. What closes it is
  // that `authenticated` holds NO table-level UPDATE — only a per-column list
  // that excludes platform_role and educational_role. If a migration ever
  // re-grants table-level UPDATE on learners, every admin endpoint falls at once.
  it('authenticated has no table-level UPDATE on learners', () => {
    expect(schema).toContain('GRANT SELECT,INSERT,DELETE,MAINTAIN ON TABLE public.learners TO authenticated;')
    expect(schema).not.toMatch(/GRANT[^;]*\bUPDATE\b(?![(])[^;]*ON TABLE public\.learners TO authenticated;/)
  })

  it('the per-column UPDATE allowlist excludes both role columns', () => {
    const columnGrants = [...schema.matchAll(/GRANT UPDATE\((\w+)\) ON TABLE public\.learners TO authenticated;/g)]
      .map((m) => m[1])
    expect(columnGrants.length).toBeGreaterThan(0)
    expect(columnGrants).not.toContain('platform_role')
    expect(columnGrants).not.toContain('educational_role')
    expect(columnGrants).not.toContain('dashboard_courses')
  })
})
