/**
 * apiBase — the ONE place that turns an app-relative `/api/...` path into the
 * URL that actually goes on the wire.
 *
 * The problem it solves: there are 402 quoted `/api/...` paths across 125
 * files in this package (counted 2026-09-03). Inside a browser tab served
 * from saysomethingin.app a relative path resolves against the right origin
 * and everything works. Inside a WebView whose origin is `https://localhost`
 * every one of those resolves against an origin that serves no API, and the
 * whole app 404s.
 *
 * The mechanism is deliberately NOT a 402-site rewrite. Rewriting a hundred
 * files by script risks exactly the failure we are trying to avoid — a silent
 * behaviour change for real learners and schools on the web — and it leaves
 * the seam open, because the 403rd `fetch('/api/…')` someone writes next
 * month reopens the hole. Instead there is one rewrite point:
 *
 *   1. `installApiOriginRewrite()` wraps `fetch` once at boot. Every request
 *      whose URL is an app-relative path starting `/api/` gets the configured
 *      origin, whatever code built the string and however it built it.
 *   2. `apiUrl()` is for the handful of places that produce a URL for
 *      something that is NOT fetch — an <audio> src, `sendBeacon` — which the
 *      wrapper cannot see.
 *
 * ON THE WEB THIS IS INERT. The configured origin is the empty string, the
 * wrapper installs nothing, and every request is the identical relative path
 * it is today.
 *
 * CREDENTIALS: the rewritten requests are deliberately CREDENTIAL-FREE.
 * Authentication in this app rides an `Authorization: Bearer <supabase jwt>`
 * header (see `api/_utils/auth.ts`) — nothing server-side sets a session
 * cookie, and no endpoint trusts a cookie as an identity. So a cross-origin
 * WebView needs no ambient credentials at all, and asking for them would be
 * a real cost rather than a nicety: any request carrying credentials makes
 * `Access-Control-Allow-Origin: *` illegal, and `/api/audio/(.*)` ships
 * exactly that wildcard on purpose (see securityHeaders.security.test.ts —
 * the audio proxy is credential-free, so the wildcard grants no cross-origin
 * read that a plain <audio> tag could not already do).
 *
 * We therefore pin `credentials: 'omit'` on rewritten string/URL requests so
 * the posture is explicit rather than inherited, and the server side never
 * emits `Access-Control-Allow-Credentials` (see `api/_utils/cors.ts`). A
 * `Request` object built by app code already defaults to `'same-origin'`,
 * which sends nothing cross-origin — that default is asserted in the tests
 * rather than overridden here, because there is no way to re-init a Request's
 * credentials without pulling its body apart.
 */
import { platform } from './capabilities'

/** The configured API origin. Empty string on the web = same origin. */
export function apiOrigin(): string {
  return platform().apiOrigin
}

/**
 * Absolute URL for an app API path. Returns `path` unchanged when no origin
 * is configured, so web output is byte-identical to the literal in the source.
 * Non-`/api/` and already-absolute inputs are returned untouched.
 */
export function apiUrl(path: string): string {
  const origin = apiOrigin()
  if (!origin) return path
  if (typeof path !== 'string' || !path.startsWith('/')) return path
  return origin + path
}

/** Does this URL string need the API origin bolted on? */
function needsRewrite(url: string): boolean {
  // Only app-relative paths. An absolute URL (S3, Supabase, a presigned link,
  // or something already pointing at the API origin) is left alone.
  return url.startsWith('/api/') || url === '/api'
}

const MARK = '__ssiApiOriginRewrite'

/**
 * Wrap `fetch` so app-relative `/api/...` requests go to the configured
 * origin. Idempotent, and a no-op when no origin is configured (i.e. always,
 * on the web). Returns true if a wrapper was installed.
 */
export function installApiOriginRewrite(scope: { fetch?: typeof fetch } = globalThis): boolean {
  const origin = apiOrigin()
  if (!origin) return false

  const original = scope.fetch
  if (typeof original !== 'function') return false
  if ((original as any)[MARK]) return false

  const wrapped: typeof fetch = (input, init) => {
    try {
      if (typeof input === 'string' && needsRewrite(input)) {
        return original(origin + input, credentialFree(init))
      }
      if (input instanceof URL && needsRewrite(input.pathname) && input.origin === locationOrigin()) {
        return original(origin + input.pathname + input.search + input.hash, credentialFree(init))
      }
      if (isRequest(input)) {
        const rel = relativePathOf(input.url)
        if (rel && needsRewrite(rel)) {
          return original(new Request(origin + rel, input), init)
        }
      }
    } catch {
      // Never let URL bookkeeping break a request — fall through to the
      // original call. Audio must never stop.
    }
    return original(input, init)
  }

  ;(wrapped as any)[MARK] = true
  scope.fetch = wrapped
  return true
}

/**
 * Pin the cross-origin request to `credentials: 'omit'`. A caller that has
 * deliberately asked for a credentials mode keeps it — nothing in this app
 * does, and silently overriding an explicit choice would be its own bug.
 */
function credentialFree(init?: RequestInit): RequestInit {
  if (init && init.credentials) return init
  return { ...(init || {}), credentials: 'omit' }
}

function locationOrigin(): string {
  try {
    return typeof location !== 'undefined' ? location.origin : ''
  } catch {
    return ''
  }
}

function isRequest(x: unknown): x is Request {
  return typeof Request !== 'undefined' && x instanceof Request
}

/** `https://host/api/x?y` → `/api/x?y`, but only when it is OUR origin. */
function relativePathOf(url: string): string | null {
  const here = locationOrigin()
  if (here && url.startsWith(here)) return url.slice(here.length)
  if (url.startsWith('/')) return url
  return null
}
