/**
 * The clearance floor is the one judgement CSS cannot make on its own: a
 * measured bottom inset of zero means "Capacitor already padded the WebView
 * out of the system bars" OR "nothing is measuring and the controls are inside
 * the navigation bar", and those look identical. These tests pin which way the
 * ambiguity is resolved, and pin that an iOS shell and the web keep the
 * convention they have always had.
 */
import { describe, it, expect } from 'vitest'
import {
  chooseNavFloor,
  isAndroidUserAgent,
  shouldApplyAndroidClearance,
  NAV_FLOOR_MEASURED,
  NAV_FLOOR_UNMEASURED,
} from './shellSafeArea'

const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36'
const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'

describe('chooseNavFloor', () => {
  it('trusts a reporting shell — zero may legitimately mean "already padded"', () => {
    expect(chooseNavFloor(true)).toBe(NAV_FLOOR_MEASURED)
  })

  it('goes conservative when NOTHING is reporting — the silent-zero failure mode', () => {
    expect(chooseNavFloor(false)).toBe(NAV_FLOOR_UNMEASURED)
  })

  it('the conservative floor clears a three-button navigation bar (48dp) with a touch margin', () => {
    expect(parseFloat(NAV_FLOOR_UNMEASURED)).toBeGreaterThanOrEqual(48 + 16)
  })

  it('the measured floor is a comfortable gap, not a bar-sized one', () => {
    expect(parseFloat(NAV_FLOOR_MEASURED)).toBeGreaterThanOrEqual(16)
    expect(parseFloat(NAV_FLOOR_MEASURED)).toBeLessThan(48)
  })
})

describe('shouldApplyAndroidClearance', () => {
  it('applies in the Android native shell — the case Deborah reported', () => {
    expect(shouldApplyAndroidClearance(true, ANDROID_UA)).toBe(true)
  })

  it('does NOT apply on the web, even on an Android phone', () => {
    // Android Chrome as a browser/PWA keeps today's rendering exactly.
    expect(shouldApplyAndroidClearance(false, ANDROID_UA)).toBe(false)
  })

  it('does NOT apply in an iOS shell — the half-inset convention is right there', () => {
    expect(shouldApplyAndroidClearance(true, IPHONE_UA)).toBe(false)
  })

  it('does not apply with no user agent at all', () => {
    expect(shouldApplyAndroidClearance(true, '')).toBe(false)
  })
})

describe('isAndroidUserAgent', () => {
  it('matches Android, case-insensitively', () => {
    expect(isAndroidUserAgent(ANDROID_UA)).toBe(true)
    expect(isAndroidUserAgent('android')).toBe(true)
  })

  it('does not match iOS or desktop', () => {
    expect(isAndroidUserAgent(IPHONE_UA)).toBe(false)
    expect(isAndroidUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')).toBe(false)
  })
})
