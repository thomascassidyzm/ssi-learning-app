/**
 * offlineLease pure-logic tests — the 30-day handshake's testable core.
 *
 * Focus on the cardinal-sin guards: the lease window, clock-tamper detection,
 * and the entitlement-code clamp. (The renew/lock orchestration in
 * useOfflineLease.ts is integration-shaped and exercised by hand on the device;
 * the pure decisions live here and must never regress.)
 */

import { describe, expect, it } from 'vitest'
import {
  LEASE_DAYS,
  LEASE_DURATION_MS,
  RENEW_AHEAD_MS,
  STALE_AFTER_MS,
  computeExpiry,
  isClockTrustworthy,
  isLeaseValid,
  leaseStatus,
  leaseShouldRevalidate,
  leaseDaysRemaining,
  leaseExpiryLabel,
  type OfflineLease,
} from './offlineLease'

const DAY = 24 * 60 * 60 * 1000
const NOW = 1_700_000_000_000 // fixed anchor

function makeLease(over: Partial<OfflineLease> = {}): OfflineLease {
  return {
    grantedAt: NOW,
    expiresAt: NOW + LEASE_DURATION_MS,
    lastValidatedAt: NOW,
    ...over,
  }
}

describe('computeExpiry', () => {
  it('grants a full 30-day window with no entitlement clamp', () => {
    expect(computeExpiry(NOW)).toBe(NOW + LEASE_DAYS * DAY)
    expect(computeExpiry(NOW, null)).toBe(NOW + LEASE_DAYS * DAY)
  })

  it('clamps to an entitlement-code expiry that lands inside the window', () => {
    const codeExpiry = NOW + 10 * DAY
    expect(computeExpiry(NOW, codeExpiry)).toBe(codeExpiry)
  })

  it('does NOT extend beyond the standard window when the code outlives it', () => {
    const codeExpiry = NOW + 100 * DAY
    expect(computeExpiry(NOW, codeExpiry)).toBe(NOW + LEASE_DAYS * DAY)
  })
})

describe('isClockTrustworthy', () => {
  it('trusts a forward-running clock', () => {
    expect(isClockTrustworthy(makeLease(), NOW + 5 * DAY)).toBe(true)
  })

  it('tolerates a small benign backward skew (NTP)', () => {
    expect(isClockTrustworthy(makeLease(), NOW - 30 * 60 * 1000)).toBe(true)
  })

  it('distrusts a clock wound back well before the last validation (tamper)', () => {
    expect(isClockTrustworthy(makeLease(), NOW - 5 * DAY)).toBe(false)
  })

  it('trusts when there is no validation timestamp to compare against', () => {
    expect(isClockTrustworthy({ lastValidatedAt: 0 }, NOW - 5 * DAY)).toBe(true)
  })
})

describe('leaseStatus / isLeaseValid', () => {
  it('valid inside the window with a trustworthy clock', () => {
    expect(leaseStatus(makeLease(), NOW + 5 * DAY)).toBe('valid')
    expect(isLeaseValid(makeLease(), NOW + 5 * DAY)).toBe(true)
  })

  it('none for a missing lease (free / pre-leasing download)', () => {
    expect(leaseStatus(null, NOW)).toBe('none')
    expect(isLeaseValid(null, NOW)).toBe(false)
    expect(isLeaseValid(undefined, NOW)).toBe(false)
  })

  it('expired once the window has elapsed', () => {
    expect(leaseStatus(makeLease(), NOW + 31 * DAY)).toBe('expired')
    expect(isLeaseValid(makeLease(), NOW + 31 * DAY)).toBe(false)
  })

  it('clock-untrusted beats expired (a wound-back clock locks)', () => {
    // Even though by the (tampered) clock we are "before" expiry, the regression
    // is detected first → locked.
    const lease = makeLease({ lastValidatedAt: NOW + 20 * DAY })
    expect(leaseStatus(lease, NOW)).toBe('clock-untrusted')
    expect(isLeaseValid(lease, NOW)).toBe(false)
  })

  it('FAIL-SAFE: a graceful lapsed lease keeps playing until its day runs out', () => {
    // Sub lapsed → renewals stop, but expiresAt is untouched. The remaining days
    // run out rather than instant-cutting.
    const lease = makeLease({ expiresAt: NOW + 3 * DAY })
    expect(isLeaseValid(lease, NOW + 2 * DAY)).toBe(true) // day 2: still plays
    expect(isLeaseValid(lease, NOW + 4 * DAY)).toBe(false) // day 4: locked
  })

  it('revoked locks regardless of a future expiry (chargeback kill-switch)', () => {
    const lease = makeLease({ revoked: true }) // expiry still ~30d out
    expect(leaseStatus(lease, NOW + 5 * DAY)).toBe('revoked')
    expect(isLeaseValid(lease, NOW + 5 * DAY)).toBe(false)
  })
})

describe('leaseShouldRevalidate', () => {
  it('skips the network when there is plenty of runway (the quiet common case)', () => {
    // 30d lease, validated now, checked "today" → no reason to phone home.
    expect(leaseShouldRevalidate(makeLease(), NOW)).toBe(false)
  })

  it('revalidates when within the near-expiry window', () => {
    const nearEdge = NOW + (LEASE_DURATION_MS - RENEW_AHEAD_MS) + DAY
    expect(leaseShouldRevalidate(makeLease(), nearEdge)).toBe(true)
  })

  it('revalidates when already expired', () => {
    expect(leaseShouldRevalidate(makeLease({ expiresAt: NOW - DAY }), NOW)).toBe(true)
  })

  it('revalidates ~daily even with runway, to catch a revocation', () => {
    // Long lease but last validated > a day ago → due a check.
    const lease = makeLease({ expiresAt: NOW + 60 * DAY, lastValidatedAt: NOW })
    expect(leaseShouldRevalidate(lease, NOW + STALE_AFTER_MS + 1000)).toBe(true)
  })

  it('never revalidates a missing lease (nothing downloaded)', () => {
    expect(leaseShouldRevalidate(null, NOW)).toBe(false)
    expect(leaseShouldRevalidate(undefined, NOW)).toBe(false)
  })
})

describe('leaseDaysRemaining', () => {
  it('floors and never goes negative', () => {
    expect(leaseDaysRemaining(makeLease(), NOW)).toBe(LEASE_DAYS)
    expect(leaseDaysRemaining(makeLease({ expiresAt: NOW + 2.9 * DAY }), NOW)).toBe(2)
    expect(leaseDaysRemaining(makeLease({ expiresAt: NOW - DAY }), NOW)).toBe(0)
    expect(leaseDaysRemaining(null, NOW)).toBe(0)
  })
})

describe('leaseExpiryLabel', () => {
  it('returns a date string for a real lease and null for none', () => {
    expect(typeof leaseExpiryLabel(makeLease())).toBe('string')
    expect(leaseExpiryLabel(null)).toBeNull()
  })
})
