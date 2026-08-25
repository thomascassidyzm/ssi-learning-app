/**
 * SEC25-A-01 — codeAttemptThrottle.ts (new 2026-08-25) carries forward the
 * SEC-AUDIT-2026-08-18 Finding 5 shape into its own bucket key.
 *
 * This is a CHARACTERISATION test: it PASSES, and what it pins down is that
 * the new shared module did not fix Finding 5 while it had the chance — it
 * reused getClientIp()'s exact shape (leftmost X-Forwarded-For entry, or
 * X-Real-IP, both client-set) as its own bucket key, for BOTH callers that
 * adopted it: api/code/redeem.ts (this file) and, by the same construction,
 * any future caller of isIpOverLimit/logAttempt.
 *
 * The module's own docstring says this is deliberate ("Findings 1 and 2 only,
 * ... Finding 5 stays red on purpose") — so this is not reporting something
 * the author didn't know. It is the requested comparison, executable: does
 * the new throttle repeat the old mistake, or fix it? It repeats it.
 *
 * Consequence for redeem.ts specifically (the highest-value target: a hit
 * REDEEMS an elevated-role invite, not merely reports one): an attacker who
 * rotates the X-Forwarded-For value they send on every request gets a fresh
 * ip_hash bucket every time, so REDEEM_PER_IP_LIMIT (120 / 15 min) never
 * actually bounds them — the real constraint against the ~13.8M ABC-123
 * keyspace is however wide the bucket key attacker rotation can spread it,
 * which is unbounded here.
 *
 * No production behaviour is changed by this file.
 */
import { describe, it, expect } from 'vitest'
import { getClientIp, hashIp } from './codeAttemptThrottle'

function reqWith(headers: Record<string, string>) {
  return { headers } as any
}

describe('SEC25-A-01 — codeAttemptThrottle bucket key is attacker-controlled', () => {
  it('derives the bucket purely from X-Forwarded-For, which the caller writes', () => {
    // One physical machine, three different declared identities.
    const hashes = new Set(
      ['198.51.100.1', '198.51.100.2', '198.51.100.3'].map((ip) =>
        hashIp(getClientIp(reqWith({ 'x-forwarded-for': `${ip}, 203.0.113.9` })))
      )
    )
    // The insecure property, asserted as fact: each declared IP buys a fresh
    // bucket, even though every one of these requests came from the same
    // downstream hop (203.0.113.9, the rightmost/true entry in each case).
    expect(hashes.size).toBe(3)
  })

  it('accepts X-Real-IP too — a second client-set header, same effect', () => {
    const a = hashIp(getClientIp(reqWith({ 'x-real-ip': '198.51.100.10' })))
    const b = hashIp(getClientIp(reqWith({ 'x-real-ip': '198.51.100.11' })))
    expect(a).not.toBe(b)
  })

  it('has no platform-attested fallback (e.g. x-vercel-forwarded-for, socket.remoteAddress)', () => {
    // getClientIp ignores everything except the two client-set headers, even
    // when a platform-attested value is present on the same request — proving
    // the omission is total, not just "checked first".
    const req = {
      headers: { 'x-forwarded-for': '198.51.100.99', 'x-vercel-forwarded-for': '203.0.113.9' },
      socket: { remoteAddress: '203.0.113.9' },
    } as any
    expect(getClientIp(req)).toBe('198.51.100.99')
  })
})
