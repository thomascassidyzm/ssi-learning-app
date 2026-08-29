/**
 * SECURITY AUDIT 2026-08-25 — Area B (client), finding SEC25-B-01.
 *
 * usePublishedExplainers.ts (NEW since the 2026-08-11 client-config audit,
 * which built the CSP's origin inventory) fetches from `https://popty.app`
 * by default, overridable via `VITE_POPTY_BASE_URL`. Nobody added that host
 * to the CSP the 2026-08-11 audit shipped.
 *
 * IMPACT TODAY: none. The policy is `Content-Security-Policy-Report-Only`,
 * which reports violations but never blocks — so the fetch keeps working.
 *
 * IMPACT ONCE ENFORCED (CLIENT-CONFIG-01's own follow-up `it.todo`: "promote
 * ... to enforced once a staging soak shows zero violations"): a bare
 * `connect-src` with no `popty.app` will SILENTLY BLOCK the published-copy
 * fetch. `usePublishedExplainers.ts` fails closed by design (the hardcoded
 * prose stays on screen, `fetchPublished` swallows the error) — so this is
 * not a break, but it is a silent, permanent regression of a real feature
 * dressed up as "nothing happened."
 *
 * WHY THE SOAK WOULDN'T CATCH IT EITHER: the policy carries no `report-to`/
 * `report-uri` directive, so Report-Only violations are only ever visible in
 * a browser's own devtools console — nobody is collecting them. The 08-11
 * plan ("start Report-Only, promote once a staging soak shows zero
 * violations") has no instrument that would actually surface this gap before
 * someone promotes the policy and the feature quietly goes dark.
 *
 * FIXED 2026-08-25 (origin half): `https://popty.app` is now listed in the
 * report-only `connect-src` in vercel.json, so promoting the policy to
 * enforced no longer silently kills the published-copy fetch. The origin is
 * ours, exact-host, no wildcard.
 *
 * STILL OPEN (collector half): the policy still carries no `report-to`/
 * `report-uri`, because a directive with no endpoint behind it reports
 * nothing. Kept as a characterization + `it.todo` so the gap stays visible.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const REPO_ROOT = resolve(__dirname, '../../../..')

function loadVercelConfig(): { headers?: { source: string; headers: { key: string; value: string }[] }[] } {
  return JSON.parse(readFileSync(resolve(REPO_ROOT, 'vercel.json'), 'utf8'))
}

function reportOnlyCsp(): string {
  const cfg = loadVercelConfig()
  const rule = (cfg.headers ?? []).find((r) => r.source === '/(.*)')
  const header = rule?.headers.find((h) => h.key.toLowerCase() === 'content-security-policy-report-only')
  expect(header, 'the /(.*) rule must carry a Content-Security-Policy-Report-Only header').toBeDefined()
  return header!.value
}

describe('SEC25-B-01 — CSP origin inventory is stale against usePublishedExplainers.ts', () => {
  it('usePublishedExplainers.ts fetches from popty.app by default', () => {
    const src = readFileSync(resolve(__dirname, '../explainer/usePublishedExplainers.ts'), 'utf8')
    expect(src).toMatch(/popty\.app/)
    expect(src).toMatch(/VITE_POPTY_BASE_URL/)
  })

  // SECURITY FINDING SEC25-B-01 — FIXED 2026-08-25 by adding
  // `https://popty.app` to the report-only CSP's connect-src (vercel.json).
  // The origin is genuinely ours — Popty is the SSi content dashboard, the
  // same team's product — and the fetch is a shipped, editor-facing feature,
  // so the reconciliation goes in the CSP rather than in the fetch. Whoever
  // promotes the policy to enforced no longer walks into a silent regression.
  it('SEC25-B-01 FIXED: the report-only connect-src lists popty.app', () => {
    const csp = reportOnlyCsp()
    const connectSrc = csp.match(/connect-src[^;]*/)?.[0] ?? ''
    expect(connectSrc).toContain('https://popty.app')
    // Exactly the host the composable defaults to — no wildcard.
    expect(connectSrc).not.toContain('*.popty.app')
  })

  // SECURITY FINDING SEC25-B-01 (compounding): no report collector is
  // configured, so the gap above produces no signal anyone would see before
  // promoting the policy to enforced.
  it('the CSP carries no report-to/report-uri directive to catch drift like this before enforcement (finding SEC25-B-01)', () => {
    const csp = reportOnlyCsp()
    expect(csp).not.toMatch(/report-to/)
    expect(csp).not.toMatch(/report-uri/)
  })

  it('today the fetch is unaffected — the header is Report-Only, not enforced', () => {
    const cfg = loadVercelConfig()
    const rule = (cfg.headers ?? []).find((r) => r.source === '/(.*)')
    const keys = rule!.headers.map((h) => h.key.toLowerCase())
    // The enforced CSP exists too (frame-ancestors only, per CLIENT-CONFIG-01's
    // staged rollout) — assert it stays narrow and does NOT carry connect-src,
    // which would break the fetch today rather than only on promotion.
    const enforced = rule!.headers.find((h) => h.key.toLowerCase() === 'content-security-policy')!.value
    expect(enforced).toBe("frame-ancestors 'none'")
    expect(keys).toContain('content-security-policy-report-only')
  })

  // The origin half of SEC25-B-01 is closed. The COLLECTOR half is not, and is
  // deliberately left as a characterization above: adding `report-to` without
  // standing up an endpoint to receive the reports would be a directive that
  // does nothing, and choosing/hosting that collector is a product decision,
  // not a code fix. Left visible rather than assumed away.
  it.todo('SEC25-B-01 remainder: stand up a CSP report collector and add report-to/report-uri, so a future origin drift is caught by the staging soak rather than discovered as a silent feature regression after promotion')
})
