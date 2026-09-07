/**
 * SEC0905-B — the cross-origin layer (`api/_utils/cors.ts`, new this window) and
 * its sibling `api/_utils/appOrigin.ts`.
 *
 * Full analysis: docs/security-audit-2026-09-05/area-b-cors-headers.md
 *
 * SEC0905-B-01 / SEC0905-B-02 (below) are CHARACTERIZATIONS of a confirmed
 * allowlist defect: `isOwnHost()` (cors.ts) and `isTrustedHost()` (appOrigin.ts)
 * both treat any hostname of the shape `ssi-learning-app-<anything>-<anything
 * ending in "-zenjin">.vercel.app` as "our own origin". Established from
 * Vercel's own current docs that deployment URLs are
 * `<project-name>-<hash>-<scope-slug>.vercel.app` and that team slugs are
 * self-service, first-come-first-served, and NOT namespaced to any existing
 * team — so a stranger can register a team whose slug ends in "-zenjin" (e.g.
 * "evil-zenjin"), name their own project "ssi-learning-app", and Vercel will
 * mint them a hostname that satisfies both checks with zero relationship to
 * the real team. These tests document the CURRENT (vulnerable) behaviour and
 * are EXPECTED TO GO RED the day someone fixes the allowlist (e.g. by pinning
 * to VERCEL_URL/VERCEL_BRANCH_URL instead of a spoofable string pattern) —
 * that is the point of a characterization test, not a bug in the test.
 *
 * SEC0905-B-06 / SEC0905-B-08 are SECURE-ASSERTION regression guards: they
 * pin behaviour that is currently correct so a future change can't silently
 * break it without a red test.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { applyCors, matchAllowedOrigin } from '../_utils/cors'

const __dirname = dirname(fileURLToPath(import.meta.url))
const apiRoot = join(__dirname, '..')

function read(relPath: string): string {
  return readFileSync(join(apiRoot, relPath), 'utf-8')
}

function makeReq(headers: Record<string, string>, method = 'GET'): any {
  return { method, headers }
}

function makeRes() {
  const state = { headers: {} as Record<string, string>, statusCode: null as number | null, ended: false }
  const res: any = {
    setHeader(k: string, v: string) {
      state.headers[k] = v
    },
    status(code: number) {
      state.statusCode = code
      return { end: () => { state.ended = true } }
    },
  }
  return { state, res }
}

describe('SEC0905-B-01 — cors.ts isOwnHost() trusts a self-service, unaffiliated Vercel team slug', () => {
  it('CHARACTERIZATION: a stranger\'s own "ssi-learning-app" project under a "-zenjin"-suffixed team is echoed as an allowed CORS origin', () => {
    // This is exactly the shape Vercel mints for <project-name>-<hash>-<scope-slug>.vercel.app
    // when the ATTACKER (not the real team) owns both the project name and the team slug.
    const attackerOrigin = 'https://ssi-learning-app-x7k2p9q1a-evil-zenjin.vercel.app'
    expect(matchAllowedOrigin(attackerOrigin)).toBe(attackerOrigin)

    const { state, res } = makeRes()
    const handled = applyCors(
      makeReq({ host: 'saysomethingin.app', origin: attackerOrigin }, 'GET'),
      res,
      { methods: 'GET' },
    )
    expect(handled).toBe(false)
    // The attacker's own page is granted read access to this endpoint's response.
    expect(state.headers['Access-Control-Allow-Origin']).toBe(attackerOrigin)
  })

  it('the suffix match requires a literal hyphen before "zenjin" — a bare "...notzenjin" or "...xzenjin" slug does NOT satisfy it', () => {
    // Documents the exact boundary of the bug so a fix can be verified precisely:
    // the exploit needs a team slug of the form "<anything>-zenjin" (or bare "zenjin"
    // if unclaimed), not merely a slug that contains the substring "zenjin".
    expect(matchAllowedOrigin('https://ssi-learning-app-abc123-notzenjin.vercel.app')).toBeNull()
    expect(matchAllowedOrigin('https://ssi-learning-app-abc123-xzenjin.vercel.app')).toBeNull()
    // But any slug ending in a hyphen + "zenjin" does satisfy it:
    expect(matchAllowedOrigin('https://ssi-learning-app-abc123-x-zenjin.vercel.app')).toBe(
      'https://ssi-learning-app-abc123-x-zenjin.vercel.app',
    )
  })

  it('the attacker origin also clears a preflight with 204, same as a legitimate preview alias', () => {
    const attackerOrigin = 'https://ssi-learning-app-x7k2p9q1a-evil-zenjin.vercel.app'
    const { state, res } = makeRes()
    const handled = applyCors(
      makeReq({ host: 'saysomethingin.app', origin: attackerOrigin }, 'OPTIONS'),
      res,
      { methods: 'POST' },
    )
    expect(handled).toBe(true)
    expect(state.statusCode).toBe(204)
    expect(state.headers['Access-Control-Allow-Origin']).toBe(attackerOrigin)
  })
})

describe('SEC0905-B-02 — the identical pattern in appOrigin.ts (adjacent scope: minted-link construction)', () => {
  const src = read('_utils/appOrigin.ts')

  it('appOrigin.ts duplicates the exact same PREVIEW_PREFIX/PREVIEW_SUFFIX string-match logic as cors.ts', () => {
    expect(src).toMatch(/const PREVIEW_PREFIX = 'ssi-learning-app-'/)
    expect(src).toMatch(/const PREVIEW_SUFFIX = '-zenjin\.vercel\.app'/)
    expect(src).toMatch(/host\.startsWith\(PREVIEW_PREFIX\) && host\.endsWith\(PREVIEW_SUFFIX\)/)
  })

  it("CHARACTERIZATION: the file's own comment claims the pattern is unspoofable — the claim is false for the reason proven in B-01", () => {
    // The comment this test quotes is the one the fix's safety argument rests on.
    // It is asserted here verbatim so that if someone edits the reasoning without
    // fixing the underlying check, this test still documents the gap.
    expect(src).toMatch(
      /an attacker's own `\*\.vercel\.app` project cannot satisfy the\s*\n\s*\*\s*`-zenjin\.vercel\.app` suffix/,
    )
  })

  it('getAppOrigin() is wired into minted-link construction at all four known call sites', () => {
    // Regression guard: if a fifth call site appears, this test should be updated
    // to re-assess it under the same finding rather than silently missing it.
    const callers = [
      'admin/create-signin-link.ts',
      'school/staff-signin-link.ts',
      'groups/[id]/invites.ts',
      'groups/[id]/demo-mint.ts',
    ]
    for (const rel of callers) {
      expect(read(rel)).toMatch(/getAppOrigin\(req\)/)
    }
  })

  it('create-signin-link.ts feeds getAppOrigin() straight into the magic-link redirectTo with no additional check', () => {
    const signinSrc = read('admin/create-signin-link.ts')
    expect(signinSrc).toMatch(/redirectTo:\s*getAppOrigin\(req\)/)
  })
})

describe('SEC0905-B-06 — applyCors precedes auth, and declared methods match served methods, on every wired handler', () => {
  // The full 30-file list this audit checked (excludes cors.ts/cors.test.ts themselves,
  // and player-events.ts which deliberately uses its own inline wildcard CORS — SEC0905-B-03).
  const files = [
    'sw-config.ts',
    'code/validate.ts',
    'code/redeem.ts',
    'entitlement/user.ts',
    'entitlement/create.ts',
    'email/verify.ts',
    'courses/available.ts',
    'courses/[code]/round-map.ts',
    'courses/[code]/infplay-cycles.ts',
    'courses/[code]/sectors.ts',
    'courses/[code]/cycles.ts',
    'courses/[code]/bundle.ts',
    'access/claim.ts',
    'onboarding/profile.ts',
    'welcome/played.ts',
    'onboarding/provision.ts',
    'me/subscription.ts',
    'me/engaged-time.ts',
    'me/profile.ts',
    'me/phrases-spoken.ts',
    'me/threads.ts',
    'me/teaching-context.ts',
    'me/standing.ts',
    'me/legos-learnt.ts',
    'try-link/validate.ts',
    'auth/access-code-redeem.ts',
    'auth/cascade-user-id.ts',
    'auth/possession-redeem.ts',
    'auth/send-code.ts',
    'account/delete.ts',
    'account/reset-progress.ts',
  ]

  it.each(files)('%s: applyCors( ) appears before any verifyAuthToken(req)/verifyAdmin(req) call', (rel) => {
    const src = read(rel)
    const corsIdx = src.indexOf('applyCors(')
    expect(corsIdx).toBeGreaterThan(-1)
    const authIdx = (() => {
      const a = src.indexOf('verifyAuthToken(req)')
      const b = src.indexOf('verifyAdmin(req)')
      if (a === -1) return b
      if (b === -1) return a
      return Math.min(a, b)
    })()
    // No auth check in the file at all is fine (some routes are public); if there
    // IS one, it must not run before the CORS decision (would create a preflight
    // status-code oracle: 403-vs-204 leaking whether a route is auth-gated).
    if (authIdx !== -1) {
      expect(corsIdx).toBeLessThan(authIdx)
    }
  })

  it('me/threads.ts is the one multi-method route and declares both methods it serves', () => {
    const src = read('me/threads.ts')
    expect(src).toMatch(/methods:\s*'GET,\s*POST'/)
    expect(src).toMatch(/req\.method === 'GET'/)
    expect(src).toMatch(/req\.method !== 'POST'/)
  })
})

describe('SEC0905-B-08 — WEBVIEW_ALLOWED_ORIGINS="*" is inert (literal match, not a wildcard)', () => {
  const ORIGINAL_ENV = process.env.WEBVIEW_ALLOWED_ORIGINS

  it('setting the env var to the literal string "*" does not open the door to arbitrary origins', () => {
    process.env.WEBVIEW_ALLOWED_ORIGINS = '*'
    try {
      expect(matchAllowedOrigin('https://evil.example')).toBeNull()
      expect(matchAllowedOrigin('https://attacker.vercel.app')).toBeNull()
      // Note the nuance: the literal string "*" itself DOES match (it's a
      // plain array-membership check), but no real browser ever sends
      // `Origin: *` — that header's value is always a real scheme+host the
      // browser constructed. So the env-var footgun is inert against the
      // actual browser-mediated CORS threat model, even though the raw
      // function would technically accept a caller that sent it literally.
      expect(matchAllowedOrigin('*')).toBe('*')
    } finally {
      if (ORIGINAL_ENV === undefined) delete process.env.WEBVIEW_ALLOWED_ORIGINS
      else process.env.WEBVIEW_ALLOWED_ORIGINS = ORIGINAL_ENV
    }
  })
})
