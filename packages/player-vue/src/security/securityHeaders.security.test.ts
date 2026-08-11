/**
 * SECURITY AUDIT 2026-08-11 — area 5 (client-config), finding CLIENT-CONFIG-01.
 *
 * FIXED 2026-08-11: vercel.json now ships the security response headers. This
 * suite flipped from characterization (asserting the headers were ABSENT) to
 * regression locks (asserting they are PRESENT and correctly valued), per the
 * `it.todo`s the audit left behind.
 *
 * One header is deliberately NOT enforced yet: the full `Content-Security-Policy`
 * ships as `Content-Security-Policy-Report-Only` while the origin inventory is
 * proven against real traffic (Paddle checkout and presigned-S3 audio could not
 * be exercised end-to-end before shipping). The ENFORCED CSP carries
 * `frame-ancestors 'none'` only — the clickjacking half, which cannot break a
 * page load. See docs/security-headers-2026-08-11.md.
 *
 * Why it matters here specifically:
 *  - `Content-Security-Policy`: the app has three v-html sinks and an admin
 *    surface. CSP is the defence-in-depth layer that turns a future escaping
 *    slip from "account takeover" into "blocked script".
 *  - `X-Frame-Options` / `frame-ancestors`: without them saysomethingin.app can
 *    be framed by any origin, so the schools/admin dashboards are clickjackable.
 *  - `Strict-Transport-Security`: first-visit downgrade is possible without it.
 *  - `Referrer-Policy`: full URLs (including /schools/classes/:id and
 *    /admin/users/:learnerId/progress) leak to third-party origins via Referer.
 *  - `X-Content-Type-Options: nosniff`.
 *
 * NOTE ON THE ONE HEADER THAT IS SET: `/api/audio/(.*)` sends
 * `Access-Control-Allow-Origin: *`. That is deliberate and acceptable — the
 * audio proxy is credential-free (no Allow-Credentials, and Allow-Headers does
 * not include Authorization), so a wildcard grants no cross-origin read of
 * anything a plain <audio> tag could not already fetch.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'

const REPO_ROOT = resolve(__dirname, '../../../..')

interface VercelHeaderRule { source: string; headers: { key: string; value: string }[] }
interface VercelConfig { headers?: VercelHeaderRule[] }

function loadVercelConfig(): VercelConfig {
  return JSON.parse(readFileSync(resolve(REPO_ROOT, 'vercel.json'), 'utf8'))
}

/** Every header key configured for any route, lower-cased. */
function allHeaderKeys(cfg: VercelConfig): string[] {
  return (cfg.headers ?? []).flatMap((r) => r.headers.map((h) => h.key.toLowerCase()))
}

/** The catch-all rule that carries the security headers for every route. */
function broadRule(cfg: VercelConfig): VercelHeaderRule {
  const rule = (cfg.headers ?? []).find((r) => r.source === '/(.*)')
  expect(rule, 'vercel.json must carry a /(.*) rule with the security headers').toBeDefined()
  return rule!
}

function headerValue(rule: VercelHeaderRule, key: string): string | undefined {
  return rule.headers.find((h) => h.key.toLowerCase() === key.toLowerCase())?.value
}

describe('vercel.json — security response headers', () => {
  const REQUIRED = [
    'content-security-policy',
    'content-security-policy-report-only',
    'x-frame-options',
    'strict-transport-security',
    'referrer-policy',
    'x-content-type-options',
    'permissions-policy',
  ]

  // SECURITY FINDING CLIENT-CONFIG-01 (fixed): each of these headers is served
  // on every route by the /(.*) rule. These are regression locks — deleting one
  // silently re-opens the finding.
  it.each(REQUIRED)('sets %s on every route (finding CLIENT-CONFIG-01)', (header) => {
    expect(broadRule(loadVercelConfig()).headers.map((h) => h.key.toLowerCase())).toContain(header)
    expect(allHeaderKeys(loadVercelConfig())).toContain(header)
  })

  it('denies framing outright — X-Frame-Options: DENY plus CSP frame-ancestors', () => {
    const rule = broadRule(loadVercelConfig())
    expect(headerValue(rule, 'X-Frame-Options')).toBe('DENY')
    // The ENFORCED policy is frame-ancestors-only on purpose: it is the one
    // directive that cannot break a page load, so it ships ahead of the rest.
    expect(headerValue(rule, 'Content-Security-Policy')).toBe("frame-ancestors 'none'")
  })

  it('sets the safe Referrer-Policy and nosniff', () => {
    const rule = broadRule(loadVercelConfig())
    expect(headerValue(rule, 'Referrer-Policy')).toBe('strict-origin-when-cross-origin')
    expect(headerValue(rule, 'X-Content-Type-Options')).toBe('nosniff')
  })

  it('keeps HSTS at two years and adds includeSubDomains (no preload — that is a one-way door)', () => {
    const hsts = headerValue(broadRule(loadVercelConfig()), 'Strict-Transport-Security')!
    expect(hsts).toContain('max-age=63072000')
    expect(hsts).toContain('includeSubDomains')
    expect(hsts).not.toContain('preload')
  })

  it('leaves the microphone available to self — PronunciationOverlay calls getUserMedia', () => {
    const pp = headerValue(broadRule(loadVercelConfig()), 'Permissions-Policy')!
    expect(pp).toContain('microphone=(self)')
    expect(pp).toContain('camera=()')
    expect(pp).toContain('geolocation=()')
    // `payment` is deliberately UNLISTED: Paddle's checkout iframe needs the
    // browser default, and listing it wrong would break real card payments.
    expect(pp).not.toContain('payment')
  })

  it('the report-only CSP covers every origin the app actually loads from', () => {
    const csp = headerValue(broadRule(loadVercelConfig()), 'Content-Security-Policy-Report-Only')!
    // Origins inventoried from the built bundle + index.html on 2026-08-11.
    expect(csp).toContain("default-src 'self'")
    expect(csp).toContain('https://fonts.googleapis.com') // schools dashboard fonts
    expect(csp).toContain('https://fonts.gstatic.com')
    expect(csp).toContain('https://*.paddle.com') // Paddle.js + checkout iframe
    expect(csp).toContain('amazonaws.com') // presigned S3 audio (bulk offline download)
    expect(csp).toContain('supabase.co') // auth + data
    expect(csp).toMatch(/media-src[^;]*blob:/) // AudioCache blobs
    expect(csp).toMatch(/media-src[^;]*data:/) // silentWav data: URIs
    expect(csp).toMatch(/worker-src[^;]*blob:/) // service worker / workbox
    // Inline scripts are hashed, never blanket-allowed — that is the whole
    // point of the policy for the v-html sinks.
    expect(csp).not.toContain("'unsafe-inline'; script-src")
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/)
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-eval'/)
  })

  it("the CSP script hash still matches index.html's inline boot watchdog", () => {
    // If the boot-watchdog script is edited, this hash goes stale. Under
    // Report-Only that is only noise — but promoting the policy to enforced
    // with a stale hash would white-screen the app, so CI catches the drift here.
    const html = readFileSync(resolve(REPO_ROOT, 'packages/player-vue/index.html'), 'utf8')
    const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
    expect(inline).toHaveLength(1)

    const hash = 'sha256-' + createHash('sha256').update(inline[0][1], 'utf8').digest('base64')
    const csp = headerValue(broadRule(loadVercelConfig()), 'Content-Security-Policy-Report-Only')!
    expect(csp).toContain(`'${hash}'`)
  })

  it('the internal schools mockups keep same-origin framing (they iframe each other)', () => {
    // public/_schools-mockups/flows/*.html frame sibling mockup pages, so the
    // global DENY is relaxed to SAMEORIGIN for that prefix only — cross-origin
    // framing stays blocked there too.
    const rule = (loadVercelConfig().headers ?? []).find((r) => r.source === '/_schools-mockups/(.*)')
    expect(rule).toBeDefined()
    expect(headerValue(rule!, 'X-Frame-Options')).toBe('SAMEORIGIN')
    expect(headerValue(rule!, 'Content-Security-Policy')).toBe("frame-ancestors 'self'")
  })

  it('still configures the two original route rules — audio CORS and version.json caching', () => {
    const cfg = loadVercelConfig()
    expect((cfg.headers ?? []).map((r) => r.source)).toEqual([
      '/(.*)',
      '/_schools-mockups/(.*)',
      '/api/audio/(.*)',
      '/version.json',
    ])
  })

  it('the audio CORS wildcard stays credential-free (this control must HOLD)', () => {
    const cfg = loadVercelConfig()
    const audio = (cfg.headers ?? []).find((r) => r.source === '/api/audio/(.*)')
    expect(audio).toBeDefined()

    const keys = audio!.headers.map((h) => h.key.toLowerCase())
    expect(keys).toContain('access-control-allow-origin')

    // A wildcard origin is only safe while credentials are NOT allowed.
    // If someone ever adds Allow-Credentials here, `*` becomes a real
    // cross-origin data leak and this test must fail.
    expect(keys).not.toContain('access-control-allow-credentials')
  })

  it.todo('CLIENT-CONFIG-01 follow-up: promote Content-Security-Policy-Report-Only to enforced once a staging soak shows zero violations across Paddle checkout, offline audio download and the schools/admin surfaces')
})

describe('vite build config — production source maps', () => {
  // SECURITY FINDING CLIENT-CONFIG-05: `sourcemap: true` publishes .map files
  // alongside the production bundle, exposing full original TypeScript/Vue
  // source (including comments documenting auth and gating logic) to anyone.
  // Not a vulnerability by itself — no secrets are in client source, verified
  // by clientSecrets.security.test.ts — but it hands an attacker the map.
  it('currently emits production source maps (finding CLIENT-CONFIG-05)', () => {
    const cfg = readFileSync(resolve(REPO_ROOT, 'packages/player-vue/vite.config.js'), 'utf8')
    expect(cfg).toMatch(/sourcemap:\s*true/)
  })

  it.todo("CLIENT-CONFIG-05: use sourcemap: 'hidden' so maps are built for error reporting but not referenced/served publicly")
})
