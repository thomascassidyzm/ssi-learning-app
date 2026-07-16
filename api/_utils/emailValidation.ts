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
 * Resolves true/false on a definitive MX answer, or null if the lookup was
 * inconclusive (DNS error, timeout, or no resolver available) — null must
 * never be treated as "invalid" by the caller.
 */
export async function hasMxRecord(email: string, timeoutMs = 2000): Promise<boolean | null> {
  const domain = emailDomain(email)
  if (!domain) return null

  try {
    const records = await Promise.race([
      dns.resolveMx(domain),
      new Promise<null>((_, reject) => setTimeout(() => reject(new Error('mx lookup timeout')), timeoutMs)),
    ])
    if (records === null) return null
    return records.length > 0
  } catch (err: any) {
    // ENOTFOUND / ENODATA = domain genuinely has no mail exchanger — that's
    // a real signal. Anything else (timeout, ESERVFAIL, network hiccup) is
    // inconclusive.
    if (err?.code === 'ENOTFOUND' || err?.code === 'ENODATA') return false
    console.warn('[emailValidation] MX lookup inconclusive for domain, failing open:', domain, err?.message || err)
    return null
  }
}
