/**
 * SEC25-A-01 — codeAttemptThrottle.ts's bucket key. FIXED 2026-08-25.
 *
 * WHAT WAS WRONG. The shared limiter derived its bucket from
 * `x-forwarded-for.split(',')[0]` with an `x-real-ip` fallback. Both are
 * written by the original client, so an attacker rotating a header bought a
 * fresh window on every request and REDEEM_PER_IP_LIMIT never bound anything.
 * That mattered more than an ordinary limiter bypass because api/code/redeem.ts
 * — the endpoint this limiter fronts — grants `platform_role = 'ssi_admin'`
 * (SEC25-X-03), and the limiter was the only anti-enumeration control on it.
 * This was SEC-AUDIT-2026-08-18 Finding 5, carried forward when the shared
 * module was written.
 *
 * HOW IT WAS FIXED. `getClientIp()` now reads platform-attested sources ONLY,
 * in order: `x-vercel-forwarded-for` (set by the Vercel edge, which overwrites
 * rather than appends), then `req.socket.remoteAddress` (transport truth), then
 * the literal 'unknown'. `x-forwarded-for` and `x-real-ip` are not consulted at
 * all — not even as a last resort, since a fallback the attacker reaches by
 * omitting the headers above is the same hole one step down. All three
 * endpoints that used to carry byte-equivalent inline copies (api/code/validate.ts,
 * api/auth/possession-redeem.ts, api/try-link/validate.ts) now import from here,
 * so there is exactly one definition to get right.
 *
 * These are the assertions the paired `it.todo()` named, flipped from the
 * characterizations that recorded the vulnerable behaviour. They are regression
 * guards now: if the client-set headers come back, these go red.
 *
 * No network, no database — pure function under test.
 */
import { describe, it, expect } from 'vitest'
import { getClientIp, hashIp } from './codeAttemptThrottle'

function reqWith(headers: Record<string, string>, socketAddr?: string) {
  return { headers, ...(socketAddr ? { socket: { remoteAddress: socketAddr } } : {}) } as any
}

describe('SEC25-A-01 — codeAttemptThrottle bucket key is platform-attested', () => {
  it('keeps one machine in one bucket regardless of the X-Forwarded-For it declares', () => {
    // One physical machine, three different declared identities.
    const hashes = new Set(
      ['198.51.100.1', '198.51.100.2', '198.51.100.3'].map((ip) =>
        hashIp(getClientIp(reqWith({ 'x-forwarded-for': `${ip}, 203.0.113.9` }, '203.0.113.9')))
      )
    )
    expect(hashes.size).toBe(1)
    expect(getClientIp(reqWith({ 'x-forwarded-for': '198.51.100.1' }, '203.0.113.9'))).toBe('203.0.113.9')
  })

  it('does not let X-Real-IP pick the bucket either', () => {
    const a = hashIp(getClientIp(reqWith({ 'x-real-ip': '198.51.100.10' }, '203.0.113.9')))
    const b = hashIp(getClientIp(reqWith({ 'x-real-ip': '198.51.100.11' }, '203.0.113.9')))
    expect(a).toBe(b)
  })

  it('prefers the platform-attested x-vercel-forwarded-for over anything the caller sent', () => {
    const req = reqWith(
      { 'x-forwarded-for': '198.51.100.99', 'x-vercel-forwarded-for': '203.0.113.9' },
      '10.0.0.5'
    )
    expect(getClientIp(req)).toBe('203.0.113.9')
  })

  it('falls back to the socket address — transport truth — when the edge header is absent', () => {
    expect(getClientIp(reqWith({ 'x-forwarded-for': '198.51.100.99' }, '203.0.113.9'))).toBe('203.0.113.9')
  })

  it("falls back to a single shared 'unknown' bucket, never to a client-set header", () => {
    // The key property: with no attested source, everything lands in ONE
    // bucket. That is strictly MORE restrictive than a per-IP window — a
    // missing platform header must never buy an unlimited allowance.
    const a = getClientIp(reqWith({ 'x-forwarded-for': '198.51.100.1', 'x-real-ip': '198.51.100.2' }))
    const b = getClientIp(reqWith({ 'x-forwarded-for': '203.0.113.7', 'x-real-ip': '203.0.113.8' }))
    expect(a).toBe('unknown')
    expect(b).toBe('unknown')
  })

  it('produces a bucket rather than throwing on a malformed request with no headers', () => {
    // This runs before everything else on an unauthenticated path: a throw
    // here would skip the throttle entirely, which is worse than no limiter.
    expect(getClientIp({} as any)).toBe('unknown')
  })
})
