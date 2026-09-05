/**
 * cors — the ONE place that decides whether a cross-origin caller may read an
 * API response, and the ONE place that answers a preflight.
 *
 * WHY THIS EXISTS. The app is about to be loaded inside an Android WebView
 * whose own origin (`https://localhost` by Capacitor convention) serves no
 * API. `platform/apiBase.ts` already sends every `/api/...` request to a
 * configured origin instead — but the moment that origin is non-empty, every
 * authenticated call becomes a CROSS-ORIGIN call, and `Authorization` is not
 * a CORS-safelisted request header. So each one is preflighted, and a route
 * that does not answer `OPTIONS` with the right headers simply fails, with a
 * browser console message that looks nothing like the actual cause.
 *
 * THE POSTURE, and why each part of it is the narrow choice:
 *
 *  - NO CREDENTIALS, EVER. This helper never emits
 *    `Access-Control-Allow-Credentials`. Authentication in this app is a
 *    bearer token (`api/_utils/auth.ts`); nothing here sets a session cookie
 *    and no endpoint trusts a cookie as an identity. Ambient credentials are
 *    what turn a permissive CORS answer into a real vulnerability, and there
 *    are none to send. The client pins `credentials: 'omit'` to match.
 *
 *  - ECHO THE MATCHED ORIGIN, NOT THE SENT ONE. Same discipline as
 *    `appOrigin.ts` (finding AUTH-CORE-08 / INPUT-10, fixed 2026-08-25, where
 *    a caller-written `Host` was echoed into an https origin). We compare the
 *    caller's `Origin` against a CLOSED list and emit the entry that matched.
 *
 *  - SAY NOTHING WHEN NOT ASKED. If there is no `Origin` header, or the
 *    `Origin` is this deployment's own origin, this helper sets NO headers at
 *    all and returns false. That is what makes the ordinary same-origin web
 *    path byte-identical to today: every existing learner and school gets the
 *    exact response bytes they got before this file existed.
 *
 *  - SAY NOTHING TO STRANGERS. An unrecognised cross-origin caller gets no
 *    CORS headers, so the browser refuses the read — and its preflight gets a
 *    bare 403. The request itself is NOT blocked server-side: this is a
 *    browser-read policy, not an authorisation layer. Authorisation stays
 *    where it already is, in `verifyAuthToken` and the scope helpers.
 *
 *  - `Vary: Origin` whenever a decision was made on the origin, so no shared
 *    cache can serve one caller's answer to another.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'

/** Hosts we own, and this project's Vercel preview aliases. */
const PREVIEW_PREFIX = 'ssi-learning-app-'
const PREVIEW_SUFFIX = '-zenjin.vercel.app'

/**
 * Native-shell origins allowed to read API responses.
 *
 * `https://localhost` is the Capacitor Android convention and
 * `capacitor://localhost` the iOS one; both are the shell's OWN origin, not a
 * host anyone can reach over the network. Overridable per deployment with
 * `WEBVIEW_ALLOWED_ORIGINS` (comma-separated exact origins) so the Android
 * build can name whatever it actually ends up serving from without a code
 * change. Set it to an empty string to switch native-shell CORS off entirely.
 */
const DEFAULT_SHELL_ORIGINS = ['https://localhost', 'capacitor://localhost']

function shellOrigins(): string[] {
  const raw = process.env.WEBVIEW_ALLOWED_ORIGINS
  if (raw === undefined) return DEFAULT_SHELL_ORIGINS
  return raw
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, '').toLowerCase())
    .filter(Boolean)
}

/** Is this a host on a domain we own, or one of our own preview aliases? */
function isOwnHost(host: string): boolean {
  if (host === 'saysomethingin.app') return true
  if (host.endsWith('.saysomethingin.app')) return true
  if (host.startsWith(PREVIEW_PREFIX) && host.endsWith(PREVIEW_SUFFIX)) return true
  return false
}

/**
 * The allowlist decision. Returns the origin to echo, or null.
 * Exported so it can be tested directly in both directions.
 */
export function matchAllowedOrigin(origin: string | undefined | null): string | null {
  if (!origin || typeof origin !== 'string') return null
  const candidate = origin.trim().replace(/\/+$/, '')
  if (!candidate) return null

  const lower = candidate.toLowerCase()
  if (shellOrigins().includes(lower)) return candidate

  let url: URL
  try {
    url = new URL(candidate)
  } catch {
    return null
  }
  // Only real web origins past this point — no `null`, no data:, no file:.
  if (url.protocol !== 'https:') return null
  if (url.port) return null
  if (isOwnHost(url.hostname.toLowerCase())) return candidate
  return null
}

export interface CorsOptions {
  /** Methods this route serves, e.g. 'GET, POST'. `OPTIONS` is added. */
  methods?: string
}

const DEFAULT_METHODS = 'GET, POST, OPTIONS'
/** `Authorization` is the whole reason preflight happens here at all. */
const ALLOWED_HEADERS = 'Content-Type, Authorization'
const MAX_AGE = '86400'

/**
 * Apply the cross-origin policy and, if this is a preflight, answer it.
 *
 * Returns TRUE when the response has been finished and the caller must return
 * immediately (i.e. it was an `OPTIONS` request). Returns FALSE otherwise —
 * including for every same-origin request, where it has touched nothing.
 *
 * Usage at the top of a handler:
 *   if (applyCors(req, res, { methods: 'GET' })) return
 */
export function applyCors(req: VercelRequest, res: VercelResponse, opts: CorsOptions = {}): boolean {
  // `?.` because this helper now sits on ~95 routes and a request object
  // without headers (a test double, a synthetic invocation) must not throw
  // its way past authorisation that lives below it.
  const origin = (req.headers?.origin as string | undefined) || ''
  const isPreflight = req.method === 'OPTIONS'

  // No Origin at all: a same-origin navigation/GET, a server-to-server call,
  // or a cron. Nothing to decide, nothing to say.
  if (!origin) {
    if (isPreflight) {
      res.status(204).end()
      return true
    }
    return false
  }

  // Same-origin POST/PUT browsers DO send Origin. Those must stay
  // byte-identical to today, so we still say nothing.
  if (isSelfOrigin(req, origin)) {
    if (isPreflight) {
      res.status(204).end()
      return true
    }
    return false
  }

  const matched = matchAllowedOrigin(origin)
  if (!matched) {
    // Unrecognised cross-origin caller: no CORS headers, so the browser will
    // not surface the response. Vary anyway — the ANSWER depended on Origin.
    res.setHeader('Vary', 'Origin')
    if (isPreflight) {
      res.status(403).end()
      return true
    }
    return false
  }

  res.setHeader('Access-Control-Allow-Origin', matched)
  res.setHeader('Vary', 'Origin')
  res.setHeader('Access-Control-Allow-Methods', withOptions(opts.methods || DEFAULT_METHODS))
  res.setHeader('Access-Control-Allow-Headers', ALLOWED_HEADERS)
  res.setHeader('Access-Control-Max-Age', MAX_AGE)
  // Deliberately absent: Access-Control-Allow-Credentials. See the header.

  if (isPreflight) {
    res.status(204).end()
    return true
  }
  return false
}

function withOptions(methods: string): string {
  return /\bOPTIONS\b/i.test(methods) ? methods : `${methods}, OPTIONS`
}

/** Is the caller's Origin this same deployment? */
function isSelfOrigin(req: VercelRequest, origin: string): boolean {
  const host = ((req.headers?.host as string) || '').toLowerCase()
  if (!host) return false
  try {
    return new URL(origin).host.toLowerCase() === host
  } catch {
    return false
  }
}
