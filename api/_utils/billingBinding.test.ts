/**
 * The access-preservation predicates (A-123, 2026-08-16).
 *
 * Tom cleared A-123 with one binding condition — "making sure no-one's access
 * is removed" — and these two predicates are that condition made mechanical.
 * Each case below is a way somebody could have lost access, asserted shut.
 */
import { describe, it, expect } from 'vitest'
import { holdsLivePlatformEntitlement, wouldStealLiveBinding } from './billingBinding'

const FUTURE = '2099-01-01T00:00:00Z'
const PAST = '2020-01-01T00:00:00Z'

describe('holdsLivePlatformEntitlement', () => {
  it('counts an active node as holding something', () => {
    expect(holdsLivePlatformEntitlement('active', FUTURE)).toBe(true)
  })

  it('counts a running trial as holding something — a trial is access too', () => {
    expect(holdsLivePlatformEntitlement('trial', FUTURE)).toBe(true)
    expect(holdsLivePlatformEntitlement('trial', null)).toBe(true) // bare DEFAULT 'trial', pre-provision
  })

  // Broader than isPlatformActive by exactly this state, and deliberately so:
  // a past-due node is a live paying customer whose card is being retried.
  it('counts past_due as holding something, unlike the dashboard gate', () => {
    expect(holdsLivePlatformEntitlement('past_due', FUTURE)).toBe(true)
  })

  it('counts a legacy NULL status as holding something (fails open)', () => {
    expect(holdsLivePlatformEntitlement(null, null)).toBe(true)
    expect(holdsLivePlatformEntitlement(undefined, undefined)).toBe(true)
  })

  it('counts an elapsed trial and a cancelled node as holding nothing', () => {
    expect(holdsLivePlatformEntitlement('trial', PAST)).toBe(false)
    expect(holdsLivePlatformEntitlement('cancelled', FUTURE)).toBe(false)
    expect(holdsLivePlatformEntitlement('expired', null)).toBe(false)
  })
})

describe('wouldStealLiveBinding', () => {
  // The SEC15-01 payoff, and the reason the attack no longer pays.
  it('refuses one subscription overwriting a node live under another', () => {
    expect(
      wouldStealLiveBinding({
        existingSubscriptionId: 'sub_VICTIM',
        incomingSubscriptionId: 'sub_ATTACKER',
        status: 'active',
        expiresAt: FUTURE,
      }),
    ).toBe(true)
  })

  it('refuses it for a past_due node too — mid-retry is not abandoned', () => {
    expect(
      wouldStealLiveBinding({
        existingSubscriptionId: 'sub_VICTIM',
        incomingSubscriptionId: 'sub_ATTACKER',
        status: 'past_due',
        expiresAt: FUTURE,
      }),
    ).toBe(true)
  })

  // ACCESS: the normal paths must stay open, or the guard costs the very thing
  // it was written to protect.
  it('allows a node its OWN subscription is writing to (every renewal and cancellation)', () => {
    expect(
      wouldStealLiveBinding({
        existingSubscriptionId: 'sub_MINE',
        incomingSubscriptionId: 'sub_MINE',
        status: 'active',
        expiresAt: FUTURE,
      }),
    ).toBe(false)
  })

  it('allows an unbound node to take out its first subscription (the trial upgrade)', () => {
    expect(
      wouldStealLiveBinding({
        existingSubscriptionId: null,
        incomingSubscriptionId: 'sub_NEW',
        status: 'trial',
        expiresAt: FUTURE,
      }),
    ).toBe(false)
  })

  it('allows re-subscribing after a lapse — the old binding grants nothing', () => {
    expect(
      wouldStealLiveBinding({
        existingSubscriptionId: 'sub_OLD_CANCELLED',
        incomingSubscriptionId: 'sub_NEW',
        status: 'cancelled',
        expiresAt: PAST,
      }),
    ).toBe(false)
  })
})
