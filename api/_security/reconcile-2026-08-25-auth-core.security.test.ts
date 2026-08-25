/**
 * AREA C RECONCILIATION (2026-08-25) — auth-core.md findings still live on `dev`.
 *
 * The 2026-08-11 audit (branch `sec/audit-2026-08-11`, docs/security-audit-2026-08-11/auth-core.md)
 * was never merged, so these findings carry no tripwire on `dev`. Two of the area's twelve findings
 * (AUTH-CORE-01, -02) are independently confirmed fixed and are NOT re-asserted here — see
 * docs/security-audit-2026-08-25/area-c-reconciliation.md for the fix commits. The rest are
 * re-verified against today's source and characterized below, per the test convention in
 * docs/security-audit-2026-08-11/README.md: a real vulnerability is a passing characterization
 * test with a `// SECURITY FINDING <ID>:` comment plus a paired `it.todo()` naming the fix.
 *
 * Every assertion here reads source text only — no network, no live DB.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '../..')
const read = (relPath: string) => readFileSync(resolve(repoRoot, relPath), 'utf8')

describe('AUTH-CORE-03: /api/try-link/validate is throttled — FIXED 2026-08-25', () => {
  // FIXED 2026-08-25 by putting the endpoint behind the shared per-IP limiter
  // (api/_utils/codeAttemptThrottle.ts) that code/validate.ts and code/redeem.ts
  // already use: same possession_mint_attempts ledger, same window, so a sweep
  // spread across all three accumulates in ONE bucket instead of getting three
  // budgets. It uses the WIDER REDEEM_PER_IP_LIMIT because a try link is a
  // marketing link handed round a room — many distinct people through one NAT
  // is the legitimate shape here, and the narrow limit would refuse the
  // eleventh prospect.
  it('SECURE: try-link/validate shares the per-IP throttle code/validate.ts uses', () => {
    const src = read('api/try-link/validate.ts')
    expect(src).toContain("from '../_utils/codeAttemptThrottle'")
    expect(src).toContain('isIpOverLimit')
    expect(src).toMatch(/status\(429\)/)
    // The attempt is logged whether or not it is refused, so abuse is observable.
    expect(src).toMatch(/logAttempt\([\s\S]{0,120}rate_limited_ip/)
    expect(src).toMatch(/logAttempt\([\s\S]{0,120}try_link_attempt/)
  })
})

describe('AUTH-CORE-04: /api/email/verify bounds OTP guesses — FIXED 2026-08-25', () => {
  // FIXED 2026-08-25 with a local budget counted on BOTH axes named by the
  // paired todo, because they defeat different attacks: per target email stops
  // one mailbox being ground down from many sessions; per auth_user_id stops
  // one signed-in account grinding many mailboxes, which is the shape that
  // matters since this endpoint attaches a verified email to the CALLER's
  // learner row. Logged before the guess is relayed, so abandoning a request
  // mid-verify cannot drain the budget.
  it('SECURE: verify.ts bounds OTP attempts per account and per target email', () => {
    const src = read('api/email/verify.ts')
    expect(src).toContain('verifyOtp(')
    expect(src).toMatch(/status\(429\)/)
    expect(src).toContain('possession_mint_attempts')
    expect(src).toMatch(/otpAttemptsOverLimit\(admin, 'email', normalizedEmail\)/)
    expect(src).toMatch(/otpAttemptsOverLimit\(admin, 'auth_user_id', userId\)/)
    // The 429 is decided BEFORE verifyOtp is called.
    expect(src.indexOf('status(429)')).toBeLessThan(src.indexOf('verifyOtp('))
  })
})

describe('AUTH-CORE-05 / ADMIN-ENT-06 / SEC-AUDIT-2026-08-18 Finding 5: throttle IP — FIXED 2026-08-25', () => {
  // FIXED 2026-08-25. The three endpoints no longer carry byte-equivalent
  // inline copies of getClientIp at all — they import the ONE definition in
  // api/_utils/codeAttemptThrottle.ts, which reads platform-attested sources
  // only (x-vercel-forwarded-for, then socket.remoteAddress, then a single
  // shared 'unknown' bucket). Behavioural coverage of the fixed function is in
  // api/_utils/codeAttemptThrottle.security.test.ts; this asserts the shape —
  // that no call site has quietly grown its own copy back.
  it('SECURE: getClientIp prefers x-vercel-forwarded-for (platform-attested) over x-forwarded-for', () => {
    const throttle = read('api/_utils/codeAttemptThrottle.ts')
    expect(throttle).toContain("headers['x-vercel-forwarded-for']")
    expect(throttle).toMatch(/socket\s*\n?\s*\?\.remoteAddress/)
    // The client-set headers are not read anywhere in the derivation.
    expect(throttle).not.toMatch(/x-forwarded-for'\]\s*as string\)\?\.split\(','\)\[0\]/)
    expect(throttle).not.toMatch(/return[^\n]*x-real-ip/)

    for (const file of ['api/code/validate.ts', 'api/auth/possession-redeem.ts', 'api/try-link/validate.ts']) {
      const src = read(file)
      expect(src, file).toContain("from '../_utils/codeAttemptThrottle'")
      expect(src, file).not.toMatch(/x-forwarded-for'\]\s*as string\)\?\.split\(','\)\[0\]/)
      expect(src, file).not.toContain('function getClientIp')
    }
  })
})

describe('AUTH-CORE-06: the email cross-account collision guard — FIXED 2026-08-25', () => {
  // FIXED 2026-08-25. `.single()` errors on zero rows AND on two-or-more, and
  // the error was discarded — so once two learners already held an address the
  // probe returned no data and the "already linked" guard silently stopped
  // firing for a third, i.e. it failed open in exactly the case it exists for.
  // `.limit(1).maybeSingle()` returns the first colliding row instead of
  // erroring, and a read error now refuses with a 503 rather than being read
  // as "no collision".
  it('SECURE: the collision probe uses .limit(1).maybeSingle() and fails closed on a read error', () => {
    const src = read('api/email/verify.ts')
    expect(src).toMatch(/contains\('verified_emails', \[normalizedEmail\]\)\s*\n\s*\.limit\(1\)\s*\n\s*\.maybeSingle\(\)/)
    expect(src).toContain('error: collisionError')
    expect(src).toMatch(/if \(collisionError\) \{[\s\S]{0,200}status\(503\)/)
  })
})

describe('AUTH-CORE-07: the sign-in-link mint quota — FIXED 2026-08-25', () => {
  // FIXED 2026-08-25. An unreadable player_events (an RLS change, an outage, a
  // permission regression) used to remove the ONLY volume bound on an endpoint
  // that mints a session-granting magic link for any learner. A quota that
  // evaporates exactly when the database misbehaves is not a quota.
  it('SECURE: create-signin-link.ts fails closed (503) when the quota cannot be evaluated', () => {
    const src = read('api/admin/create-signin-link.ts')
    expect(src).not.toContain('failing open')
    expect(src).toMatch(/if \(rateErr\) \{[\s\S]{0,600}status\(503\)/)
  })
})

describe('AUTH-CORE-08 / INPUT-10: the app origin still echoes an unrecognised Host header', () => {
  // SECURITY FINDING AUTH-CORE-08 / INPUT-10: getAppOrigin() pins the two
  // canonical hosts but echoes any other Host verbatim into an https:// origin,
  // which feeds magic-link redirectTo and join/redeem URLs.
  it('getAppOrigin falls through to `https://${host}` for any unrecognised host', () => {
    const src = read('api/_utils/appOrigin.ts')
    expect(src).toContain('if (host) return `https://${host}`')
  })
  it.todo('SECURE: getAppOrigin should allow-list known app origins and fall back to production otherwise')
})

describe('AUTH-CORE-09: invite/entitlement codes in logs — FIXED 2026-08-25', () => {
  // FIXED 2026-08-25 with redactCode() (api/_utils/codeGen.ts) — a truncated
  // sha256 rendered as `code#xxxxxxxx`. An invite code is a bearer credential
  // (possession-redeem turns one into a session with no other proof), so a code
  // in stdout is a credential in whatever reads stdout. The operational reason
  // these lines exist is correlation — "is THIS the code that keeps failing?" —
  // which a stable digest serves exactly as well as the value, and which cannot
  // be walked back to a code.
  it('SECURE: the mint/validate/redeem log lines carry a digest, never the code value', () => {
    for (const [file, tag] of [
      ['api/code/validate.ts', 'CodeValidate'],
      ['api/code/redeem.ts', 'CodeRedeem'],
      ['api/try-link/create.ts', 'TryLinkCreate'],
    ] as const) {
      const src = read(file)
      expect(src, file).toContain('redactCode')
      // No console line anywhere in these files passes a raw code value.
      for (const m of src.match(/console\.(log|error|warn)\([^\n]*/g) || []) {
        expect(m, `${file}: ${m}`).not.toMatch(/\b(inviteRow|entitlementRow)\.code\b(?!\))/)
        expect(m, `${file}: ${m}`).not.toMatch(/,\s*newCode\b/)
        expect(m, `${file}: ${m}`).not.toMatch(/,\s*stripped\b/)
      }
      expect(src, file).toContain(`[${tag}]`)
    }
  })
})

describe('AUTH-CORE-10: raw DB error strings in response bodies — FIXED 2026-08-25', () => {
  // FIXED 2026-08-25 at the two sites the reconciliation named (try-link/validate,
  // account/reset-progress) and at api/teacher/by-code.ts, the third
  // unauthenticated endpoint in the same shard. Postgres messages name
  // relations and constraints; handing them to an anonymous caller is
  // reconnaissance. The detail stays in console.error, where it is useful.
  it('SECURE: the client gets a fixed string; the detail goes to console.error', () => {
    const trylink = read('api/try-link/validate.ts')
    expect(trylink).not.toMatch(/status\(500\)\.json\(\{ error: error\?\.message/)
    expect(trylink).toMatch(/console\.error\('\[TryLinkValidate\] Error:', error\)/)
    expect(trylink).toMatch(/status\(500\)\.json\(\{ error: 'Internal server error' \}\)/)

    const reset = read('api/account/reset-progress.ts')
    expect(reset).not.toContain('detail: error.message')

    const byCode = read('api/teacher/by-code.ts')
    expect(byCode).not.toMatch(/status\(500\)\.json\(\{ error: \w+Error\.message/)
    expect(byCode).not.toMatch(/status\(500\)\.json\(\{ error: error\?\.message/)
  })
})
