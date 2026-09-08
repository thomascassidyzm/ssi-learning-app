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
 * page load. See archive/docs-retired-2026-08-24/security-headers-2026-08-11.md.
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
    // paddle.js itself pulls in public.profitwell.com — observed as the only
    // non-eruda violation of the whole live walk, on the checkout overlay.
    expect(csp).toContain('https://*.profitwell.com')
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

  it('the CSP carries a current hash for EVERY inline script in index.html', () => {
    // If an inline script is edited or a new one is added, its hash goes stale
    // or missing. Under Report-Only that is only noise — but promoting the
    // policy to enforced with a stale or absent hash would break that script
    // (white screen, or a boot shim that silently never runs), so CI catches
    // the drift here. index.html carries two: the Android WebView
    // crypto.randomUUID shim (#701) and the boot watchdog.
    const html = readFileSync(resolve(REPO_ROOT, 'packages/player-vue/index.html'), 'utf8')
    const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
    expect(inline.length).toBeGreaterThan(0)

    const csp = headerValue(broadRule(loadVercelConfig()), 'Content-Security-Policy-Report-Only')!
    for (const [, body] of inline) {
      const hash = 'sha256-' + createHash('sha256').update(body, 'utf8').digest('base64')
      expect(csp).toContain(`'${hash}'`)
    }
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
      '/embed/(.*)',
      '/api/audio/(.*)',
      '/version.json',
    ])
  })

  it('the framed marketing demo is frameable by saysomethingin.com AND BY NOTHING ELSE', () => {
    // /embed/* is the ONE surface the app lets anybody else frame: a
    // saysomethingin.com India landing page shows the real player in a slot
    // rather than a hand-written replica reading a stale JSON file.
    //
    // 'self' is in the list deliberately and is not slack: the throwaway
    // harness at /_embed-harness/ is served from this same origin, and
    // without 'self' the page we look at cannot frame the page we are
    // looking at.
    const rule = (loadVercelConfig().headers ?? []).find((r) => r.source === '/embed/(.*)')
    expect(rule).toBeDefined()

    const csp = headerValue(rule!, 'Content-Security-Policy')!
    expect(csp).toMatch(/^frame-ancestors /)
    expect(csp).toContain('https://www.saysomethingin.com')
    expect(csp).toContain('https://saysomethingin.com')
    expect(csp).toContain("'self'")
    // No wildcard, ever. An origin list that grew a `*` would let any site on
    // the internet frame the player and pass it off as their own.
    expect(csp).not.toContain('*')
    expect(csp).not.toContain('http://')
  })

  it('the app stays UNFRAMEABLE everywhere else — the posture did not loosen', () => {
    // The proof that the /embed rule above is an exception and not a shift.
    // If somebody ever relaxes the broad rule instead of adding a narrow one,
    // this is what goes red.
    const broad = broadRule(loadVercelConfig())
    expect(headerValue(broad, 'Content-Security-Policy')).toBe("frame-ancestors 'none'")
    expect(headerValue(broad, 'X-Frame-Options')).toBe('DENY')
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

  it('the embed Report-Only policy is the broad one, differing ONLY in frame-ancestors', () => {
    // TWO copies of a 1.5KB policy is exactly how two policies drift apart, so
    // this is the thing that makes the duplication safe: they must be
    // character-identical once frame-ancestors is normalised away.
    //
    // Why duplicate at all. The broad Report-Only policy says
    // frame-ancestors 'none'. Report-only does not block, so the demo worked
    // without this — it just logged a violation into the console of every
    // visitor to Aran's landing pages. And a page must satisfy EVERY enforced
    // policy it is served, so the day CLIENT-CONFIG-01 promotes Report-Only to
    // enforced, a 'none' here would kill the framed demo and the narrow
    // enforced rule could not save it. Closing it now costs one config entry;
    // discovering it after promotion costs a live demo.
    const cfg = loadVercelConfig()
    const broad = headerValue(broadRule(cfg), 'Content-Security-Policy-Report-Only')!
    const embedRule = (cfg.headers ?? []).find((r) => r.source === '/embed/(.*)')!
    const embed = headerValue(embedRule, 'Content-Security-Policy-Report-Only')!

    expect(broad).toContain("frame-ancestors 'none'")
    expect(embed).toContain('frame-ancestors https://www.saysomethingin.com https://saysomethingin.com')

    const strip = (p: string) => p.replace(/frame-ancestors[^;]*/, 'frame-ancestors <X>')
    expect(strip(embed)).toBe(strip(broad))
  })

  it.todo("CLIENT-CONFIG-01 follow-up: promote Content-Security-Policy-Report-Only to enforced once a staging soak shows zero violations across Paddle checkout, offline audio download and the schools/admin surfaces — and in the SAME change give /embed/(.*) its own copy with the marketing frame-ancestors, or the framed demo dies with it")
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
