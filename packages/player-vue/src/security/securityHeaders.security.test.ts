/**
 * SECURITY AUDIT 2026-08-11 — area 5 (client-config), finding CLIENT-CONFIG-01.
 *
 * vercel.json ships NO security response headers. This is a CHARACTERIZATION
 * suite: the `it(...)` cases below assert the CURRENT (missing-header) state so
 * CI stays green, and each is paired with an `it.todo` naming the header that
 * should exist. When the headers are added, the characterization tests fail
 * loudly — which is the intended signal to convert them into the todo's shape.
 *
 * Why it matters here specifically:
 *  - No `Content-Security-Policy`: the app has three v-html sinks and an admin
 *    surface. CSP is the defence-in-depth layer that turns a future escaping
 *    slip from "account takeover" into "blocked script".
 *  - No `X-Frame-Options` / `frame-ancestors`: saysomethingin.app can be framed
 *    by any origin, so the schools/admin dashboards are clickjackable.
 *  - No `Strict-Transport-Security`: first-visit downgrade is possible.
 *  - No `Referrer-Policy`: full URLs (including /schools/classes/:id and
 *    /admin/users/:learnerId/progress) leak to third-party origins via Referer.
 *  - No `X-Content-Type-Options: nosniff`.
 *
 * NOTE ON THE ONE HEADER THAT IS SET: `/api/audio/(.*)` sends
 * `Access-Control-Allow-Origin: *`. That is deliberate and acceptable — the
 * audio proxy is credential-free (no Allow-Credentials, and Allow-Headers does
 * not include Authorization), so a wildcard grants no cross-origin read of
 * anything a plain <audio> tag could not already fetch.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
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

describe('vercel.json — security response headers', () => {
  const MISSING = [
    'content-security-policy',
    'x-frame-options',
    'strict-transport-security',
    'referrer-policy',
    'x-content-type-options',
    'permissions-policy',
  ]

  // SECURITY FINDING CLIENT-CONFIG-01: each of these headers SHOULD be present
  // on the app's HTML responses. They are all absent today; these assertions
  // pin that fact rather than pretending otherwise.
  it.each(MISSING)('currently does NOT set %s (finding CLIENT-CONFIG-01)', (header) => {
    expect(allHeaderKeys(loadVercelConfig())).not.toContain(header)
  })

  it('configures headers for exactly two routes today — audio CORS and version.json caching', () => {
    const cfg = loadVercelConfig()
    expect((cfg.headers ?? []).map((r) => r.source)).toEqual(['/api/audio/(.*)', '/version.json'])
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

  it.todo('CLIENT-CONFIG-01: set Content-Security-Policy on HTML responses — note index.html has an inline boot-watchdog <script>, so it needs a hash/nonce (not just script-src self)')
  it.todo("CLIENT-CONFIG-01: set X-Frame-Options: DENY (and CSP frame-ancestors 'none') so /schools and /admin cannot be framed")
  it.todo('CLIENT-CONFIG-01: set Strict-Transport-Security: max-age=63072000; includeSubDomains; preload')
  it.todo('CLIENT-CONFIG-01: set Referrer-Policy: strict-origin-when-cross-origin so learner/class ids do not leak in Referer')
  it.todo('CLIENT-CONFIG-01: set X-Content-Type-Options: nosniff')
  it.todo('CLIENT-CONFIG-01: set a restrictive Permissions-Policy (the app needs microphone only where speech features run)')
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
