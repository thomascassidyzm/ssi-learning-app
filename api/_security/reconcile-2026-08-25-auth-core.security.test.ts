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
import { getAppOrigin } from '../_utils/appOrigin'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '../..')
const read = (relPath: string) => readFileSync(resolve(repoRoot, relPath), 'utf8')

describe('AUTH-CORE-03: /api/try-link/validate is still unauthenticated and unthrottled', () => {
  // SECURITY FINDING AUTH-CORE-03: a 13.8M-keyspace code guards a 30-day
  // all-courses entitlement token, with no rate-limit ledger consulted at all.
  it('validate.ts never touches the possession_mint_attempts throttle ledger', () => {
    const src = read('api/try-link/validate.ts')
    expect(src).not.toContain('possession_mint_attempts')
    expect(src).not.toMatch(/status\(429\)/)
  })
  it.todo('SECURE: try-link/validate should share the per-IP throttle code/validate.ts uses')
})

describe('AUTH-CORE-04: /api/email/verify has no attempt budget on OTP guesses', () => {
  // SECURITY FINDING AUTH-CORE-04: every submitted {email, token} pair is relayed
  // to GoTrue with no local counter, so an attacker's guesses share whatever
  // budget GoTrue applies rather than being isolated per-caller.
  it('verify.ts calls verifyOtp with no local attempt counter or 429 path', () => {
    const src = read('api/email/verify.ts')
    expect(src).toContain('verifyOtp(')
    expect(src).not.toMatch(/status\(429\)/)
    expect(src).not.toContain('possession_mint_attempts')
  })
  it.todo('SECURE: verify.ts should bound OTP attempts per account and per target email')
})

describe('AUTH-CORE-05 / ADMIN-ENT-06 / SEC-AUDIT-2026-08-18 Finding 5: throttle IP is client-supplied', () => {
  // SECURITY FINDING AUTH-CORE-05: three throttled endpoints derive the rate-limit
  // bucket from the LEFTMOST X-Forwarded-For entry, which is the value the
  // original client wrote — attacker-controlled on any proxy that appends rather
  // than replaces. This is also the still-red spec api/code/validate.ipSpoof.security-audit.ts.
  it('getClientIp reads split(",")[0] of x-forwarded-for, never x-vercel-forwarded-for', () => {
    for (const file of ['api/code/validate.ts', 'api/auth/possession-redeem.ts', 'api/try-link/validate.ts']) {
      const src = read(file)
      expect(src, file).toMatch(/x-forwarded-for'\]\s*as string\)\?\.split\(','\)\[0\]/)
      expect(src, file).not.toContain('x-vercel-forwarded-for')
    }
  })
  it.todo('SECURE: getClientIp should prefer x-vercel-forwarded-for (platform-attested) over x-forwarded-for')
})

describe('AUTH-CORE-06: the email cross-account collision guard fails open on 2+ matches', () => {
  // SECURITY FINDING AUTH-CORE-06: `.single()` errors on zero OR multiple rows,
  // and the error is discarded — so once two learners already hold an address,
  // the "already linked" guard silently stops firing for a third.
  it('verify.ts still uses .single() (not .maybeSingle()) on the collision probe', () => {
    const src = read('api/email/verify.ts')
    const singleCalls = src.match(/\.single\(\)/g) || []
    expect(singleCalls.length).toBeGreaterThanOrEqual(1)
    expect(src).not.toContain('.maybeSingle()')
  })
  it.todo('SECURE: the collision probe should use .limit(1).maybeSingle() and fail closed on a read error')
})

describe('AUTH-CORE-07: the sign-in-link mint quota still fails open on a query error', () => {
  // SECURITY FINDING AUTH-CORE-07: an unreadable player_events (RLS change,
  // outage, permission regression) silently removes the only volume bound on
  // an admin endpoint that mints a session-granting magic link.
  it('create-signin-link.ts warns and proceeds on a rate-check error rather than refusing', () => {
    const src = read('api/admin/create-signin-link.ts')
    expect(src).toContain('failing open')
    expect(src).not.toMatch(/rateErr[\s\S]{0,80}status\(503\)/)
  })
  it.todo('SECURE: create-signin-link.ts should fail closed (503) when the quota cannot be evaluated')
})

describe('AUTH-CORE-08 / INPUT-10: the app origin allow-lists known hosts', () => {
  // SECURITY FINDING AUTH-CORE-08 / INPUT-10 — FIXED 2026-08-25. getAppOrigin()
  // pinned the two canonical hosts and then echoed any other caller-written
  // Host verbatim into an https:// origin, which feeds join/redeem URLs (and,
  // in the two handlers carrying their own copy of this function, magic-link
  // redirectTo). It is now an allowlist — every `*.saysomethingin.app` host we
  // own, plus this project's own Vercel preview aliases
  // (`ssi-learning-app-…-zenjin.vercel.app`) — with production as the fallback
  // for anything unrecognised. Behavioural, not source-text: the real function
  // is called with real Host headers.
  const origin = (host: string) =>
    getAppOrigin({ headers: { host } } as unknown as Parameters<typeof getAppOrigin>[0])

  it('SECURE: a poisoned Host falls back to production instead of being echoed', () => {
    for (const evil of [
      'evil.example',
      'saysomethingin.app.evil.example',
      'notsaysomethingin.app',
      'ssi-learning-app-git-dev-zenjin.vercel.app.evil.example',
      'attacker-zenjin.vercel.app',
      'ssi-learning-app-evil.vercel.app',
      'localhost',
      '',
    ]) {
      expect(origin(evil), `Host: ${evil} must not reach the minted link`).toBe(
        'https://saysomethingin.app'
      )
    }
    const src = read('api/_utils/appOrigin.ts')
    expect(src).not.toContain('if (host) return `https://${host}`')
  })

  it('the hosts the team actually uses still work', () => {
    expect(origin('saysomethingin.app')).toBe('https://saysomethingin.app')
    expect(origin('www.saysomethingin.app')).toBe('https://saysomethingin.app')
    expect(origin('SaySomethingIn.app:443')).toBe('https://saysomethingin.app')
    expect(origin('staging.saysomethingin.app')).toBe('https://staging.saysomethingin.app')
    expect(origin('ssi-learning-app-git-dev-zenjin.vercel.app')).toBe(
      'https://ssi-learning-app-git-dev-zenjin.vercel.app'
    )
    expect(origin('ssi-learning-app-abc1234-zenjin.vercel.app')).toBe(
      'https://ssi-learning-app-abc1234-zenjin.vercel.app'
    )
  })
})

describe('AUTH-CORE-09: live invite/entitlement codes are still logged in plaintext', () => {
  // SECURITY FINDING AUTH-CORE-09: an invite code is a bearer credential
  // (possession-redeem turns one into a session with no other proof), and
  // both mint and redeem paths log the raw code value to stdout.
  it('code/validate.ts, code/redeem.ts and try-link/create.ts still console.log the raw code', () => {
    expect(read('api/code/validate.ts')).toMatch(/console\.log\('\[CodeValidate\][\s\S]{0,40}inviteRow\.code/)
    expect(read('api/code/redeem.ts')).toMatch(/console\.log\('\[CodeRedeem\][\s\S]{0,40}inviteRow\.code/)
    expect(read('api/try-link/create.ts')).toMatch(/console\.log\('\[TryLinkCreate\][\s\S]{0,20}newCode/)
  })
  it.todo('SECURE: log the code row id, never the code value, or a truncated hash')
})

describe('AUTH-CORE-10: raw DB error strings still reach an unauthenticated caller', () => {
  // SECURITY FINDING AUTH-CORE-10: try-link/validate is public (no auth helper)
  // and its 500 body relays `error?.message` verbatim — Postgres constraint
  // and relation names can leak to an anonymous caller.
  it('try-link/validate.ts 500 body still forwards error?.message', () => {
    const src = read('api/try-link/validate.ts')
    expect(src).toMatch(/status\(500\)\.json\(\{ error: error\?\.message/)
  })
  it.todo('SECURE: return a generic message to the client; keep the detail in console.error')
})
