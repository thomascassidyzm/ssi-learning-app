/**
 * Real-email validation for unauthenticated account creation (possession-redeem).
 *
 * Three layers, in cost order:
 *   1. format (cheap, always enforced)
 *   2. disposable-domain blocklist (cheap, always enforced)
 *   3. MX lookup (a live DNS call — inherently flaky in serverless: cold
 *      resolvers, transient timeouts, IPv6-only records). Treated as a SOFT
 *      signal only: a definitive "no MX records" is a real block, but any
 *      lookup error/timeout fails OPEN (never blocks a legitimate signup on
 *      a transient DNS blip) and is logged, not enforced.
 */

import { promises as dns } from 'dns'

// Common disposable/temporary-mail providers. Not exhaustive — the goal is
// to stop the obvious mailinator-class throwaway, not build a maintained
// anti-abuse product. Extend as abuse patterns are observed.
const DISPOSABLE_DOMAINS = new Set([
  'mailinator.com',
  'guerrillamail.com',
  'guerrillamail.info',
  'guerrillamail.biz',
  'guerrillamail.de',
  'guerrillamail.net',
  'guerrillamail.org',
  'sharklasers.com',
  '10minutemail.com',
  '10minutemail.net',
  'tempmail.com',
  'temp-mail.org',
  'throwawaymail.com',
  'yopmail.com',
  'trashmail.com',
  'getnada.com',
  'dispostable.com',
  'mailnesia.com',
  'fakeinbox.com',
  'maildrop.cc',
  'moakt.com',
  'mintemail.com',
  'spamgourmet.com',
])

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function isValidEmailFormat(email: unknown): email is string {
  return typeof email === 'string' && EMAIL_RE.test(email.trim())
}

export function emailDomain(email: string): string {
  return email.trim().toLowerCase().split('@')[1] || ''
}

export function isDisposableEmailDomain(email: string): boolean {
  return DISPOSABLE_DOMAINS.has(emailDomain(email))
}

/**
 * INPUT-11 — a bound on outbound DNS driven by an unauthenticated request body.
 *
 * `hasMxRecord` is reached from api/auth/possession-redeem.ts before any
 * account exists, on a domain the CALLER chose, so without a bound it is a
 * low-bandwidth beacon: an attacker picks `<payload>.attacker-controlled.tld`
 * and the serverless egress IP resolves it, once per request, for free.
 *
 * Two cheap brakes, both in-process:
 *   1. a per-bucket window (the caller passes its already-computed IP hash),
 *      so one source cannot drive unbounded lookups;
 *   2. a short-lived per-domain answer cache, which collapses the ordinary
 *      case (a school onboarding fifty pupils on one email domain) to a single
 *      lookup and removes the repeat-the-same-name amplification shape.
 *
 * Deliberately NOT the possession_mint_attempts ledger: a DB round-trip to
 * decide whether to make a DNS round-trip costs more than the thing it is
 * protecting. The trade is honest and worth stating — this state is per warm
 * lambda instance, so a fleet of cold starts dilutes it. It bounds the cheap,
 * high-volume version of the abuse, which is the version that exists.
 *
 * Over the limit returns `null` — "inconclusive" — which is exactly the
 * fail-open semantics the module already promises, so a throttled legitimate
 * signup proceeds rather than being blocked.
 */
const MX_WINDOW_MS = 15 * 60 * 1000
const MX_LOOKUPS_PER_BUCKET = 30
const MX_CACHE_TTL_MS = 10 * 60 * 1000
/** Hard ceiling on retained state, so neither map can be grown without bound. */
const MX_MAX_TRACKED = 5000

const mxBuckets = new Map<string, number[]>()
const mxCache = new Map<string, { answer: boolean | null; at: number }>()

function mxBucketOverLimit(bucketKey: string): boolean {
  const now = Date.now()
  const recent = (mxBuckets.get(bucketKey) || []).filter((t) => now - t < MX_WINDOW_MS)
  if (recent.length >= MX_LOOKUPS_PER_BUCKET) {
    mxBuckets.set(bucketKey, recent)
    return true
  }
  recent.push(now)
  // Evict wholesale rather than LRU — the map is a rate window, not a cache, so
  // dropping it costs at most one window's worth of accounting.
  if (mxBuckets.size > MX_MAX_TRACKED) mxBuckets.clear()
  mxBuckets.set(bucketKey, recent)
  return false
}

/**
 * Resolves true/false on a definitive MX answer, or null if the lookup was
 * inconclusive (DNS error, timeout, no resolver available, or the caller's
 * lookup budget is spent) — null must never be treated as "invalid" by the
 * caller.
 *
 * `bucketKey` is the rate-limit bucket; callers pass the same platform-attested
 * IP hash they use for the code throttle. Omitting it puts the call in one
 * shared bucket, which is more restrictive, never less.
 */
export async function hasMxRecord(
  email: string,
  timeoutMs = 2000,
  bucketKey = 'shared'
): Promise<boolean | null> {
  const domain = emailDomain(email)
  if (!domain) return null

  const cached = mxCache.get(domain)
  if (cached && Date.now() - cached.at < MX_CACHE_TTL_MS) return cached.answer

  if (mxBucketOverLimit(bucketKey)) {
    console.warn('[emailValidation] MX lookup budget spent for this caller, failing open')
    return null
  }

  const remember = (answer: boolean | null): boolean | null => {
    if (mxCache.size > MX_MAX_TRACKED) mxCache.clear()
    mxCache.set(domain, { answer, at: Date.now() })
    return answer
  }

  try {
    const records = await Promise.race([
      dns.resolveMx(domain),
      new Promise<null>((_, reject) => setTimeout(() => reject(new Error('mx lookup timeout')), timeoutMs)),
    ])
    if (records === null) return remember(null)
    return remember(records.length > 0)
  } catch (err: any) {
    // ENOTFOUND / ENODATA = domain genuinely has no mail exchanger — that's
    // a real signal. Anything else (timeout, ESERVFAIL, network hiccup) is
    // inconclusive.
    if (err?.code === 'ENOTFOUND' || err?.code === 'ENODATA') return remember(false)
    console.warn('[emailValidation] MX lookup inconclusive for domain, failing open:', domain, err?.message || err)
    // Deliberately NOT cached: a transient failure must not pin a real domain
    // as unresolvable for ten minutes.
    return null
  }
}
