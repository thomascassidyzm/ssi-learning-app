import { describe, it, expect } from 'vitest'
import { isPlatformActive, isUnstampedTrialLapsed, PLATFORM_TRIAL_GRACE_MS } from './platformStatus'

const FUTURE = new Date(Date.now() + 1000 * 60 * 60).toISOString()
const PAST = new Date(Date.now() - 1000 * 60 * 60).toISOString()
const JUST_NOW = new Date(Date.now() - 1000 * 60).toISOString()
const INSIDE_GRACE = new Date(Date.now() - (PLATFORM_TRIAL_GRACE_MS - 60_000)).toISOString()
const PAST_GRACE = new Date(Date.now() - (PLATFORM_TRIAL_GRACE_MS + 60_000)).toISOString()
const NINE_DAYS_AGO = new Date(Date.now() - 9 * 24 * 60 * 60 * 1000).toISOString()

describe('isPlatformActive', () => {
  it('fails open on a null/absent status (legacy / pre-migration)', () => {
    expect(isPlatformActive(null, null)).toBe(true)
    expect(isPlatformActive(undefined, undefined)).toBe(true)
  })

  it('treats active as always active regardless of expiry', () => {
    expect(isPlatformActive('active', null)).toBe(true)
    expect(isPlatformActive('active', PAST)).toBe(true)
  })

  it('treats an unexpired trial as active', () => {
    expect(isPlatformActive('trial', FUTURE)).toBe(true)
  })

  it('locks an elapsed trial', () => {
    expect(isPlatformActive('trial', PAST)).toBe(false)
  })

  it('locks past_due, expired, and cancelled', () => {
    expect(isPlatformActive('past_due', null)).toBe(false)
    expect(isPlatformActive('expired', null)).toBe(false)
    expect(isPlatformActive('cancelled', null)).toBe(false)
  })

  // A TRIAL WITH NO END DATE MUST NOT MEAN FOREVER (2026-09-09). These four
  // are the fix: before it, every one of them answered `true`.
  describe('a trial with no end date', () => {
    it('is ACTIVE while the row is still inside its provisioning grace', () => {
      expect(isPlatformActive('trial', null, JUST_NOW)).toBe(true)
      expect(isPlatformActive('trial', null, INSIDE_GRACE)).toBe(true)
    })

    it('is INACTIVE once the grace has passed', () => {
      expect(isPlatformActive('trial', null, PAST_GRACE)).toBe(false)
      // The live shape this closed: "My school", created nine days before the
      // measurement, unstamped, still serving its members for free.
      expect(isPlatformActive('trial', null, NINE_DAYS_AGO)).toBe(false)
    })

    it('is INACTIVE when the row age is unknown — no end date never grants', () => {
      expect(isPlatformActive('trial', null)).toBe(false)
      expect(isPlatformActive('trial', null, null)).toBe(false)
      expect(isPlatformActive('trial', null, 'not-a-date')).toBe(false)
    })

    it('never touches a row that HAS an expiry, however old the row', () => {
      expect(isPlatformActive('trial', FUTURE, NINE_DAYS_AGO)).toBe(true)
      expect(isPlatformActive('trial', PAST, JUST_NOW)).toBe(false)
    })
  })
})

describe('isUnstampedTrialLapsed', () => {
  it('names exactly the state that must be shown on screen', () => {
    expect(isUnstampedTrialLapsed('trial', null, NINE_DAYS_AGO)).toBe(true)
    expect(isUnstampedTrialLapsed('trial', null, JUST_NOW)).toBe(false)
    expect(isUnstampedTrialLapsed('trial', FUTURE, NINE_DAYS_AGO)).toBe(false)
    expect(isUnstampedTrialLapsed('active', null, NINE_DAYS_AGO)).toBe(false)
    expect(isUnstampedTrialLapsed(null, null, NINE_DAYS_AGO)).toBe(false)
  })
})
