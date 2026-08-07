/**
 * Context-awareness of the install nudge — Tom's ruling was that a desktop is
 * "likely to be a chrome app" and a phone is a home screen. Pin the words, so
 * a copy tidy-up can't silently tell a desktop user to add to their home
 * screen.
 */
import { describe, it, expect } from 'vitest'
import { detectInstallPlatform, installFraming } from './installPlatform'

const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
const ANDROID_CHROME =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'
const DESKTOP_CHROME =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
const DESKTOP_FIREFOX =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0'
const DESKTOP_EDGE =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0'

describe('detectInstallPlatform', () => {
  it('reads an iPhone as ios', () => {
    const p = detectInstallPlatform({ ua: IPHONE_SAFARI, standalone: false })
    expect(p.surface).toBe('ios')
    expect(p.isIOS).toBe(true)
    expect(p.isSafari).toBe(true)
  })

  it('reads an Android phone as android', () => {
    const p = detectInstallPlatform({ ua: ANDROID_CHROME, standalone: false })
    expect(p.surface).toBe('android')
    expect(p.isChrome).toBe(true)
  })

  it('reads a laptop as desktop', () => {
    expect(detectInstallPlatform({ ua: DESKTOP_CHROME, standalone: false }).surface).toBe('desktop')
    expect(detectInstallPlatform({ ua: DESKTOP_FIREFOX, standalone: false }).surface).toBe('desktop')
  })

  it('does not mistake Edge for Chrome', () => {
    expect(detectInstallPlatform({ ua: DESKTOP_EDGE, standalone: false }).isChrome).toBe(false)
  })

  it('carries the standalone flag through', () => {
    expect(detectInstallPlatform({ ua: DESKTOP_CHROME, standalone: true }).isStandalone).toBe(true)
  })
})

describe('installFraming', () => {
  it('says CHROME APP on desktop Chrome — Tom\'s framing', () => {
    const f = installFraming(detectInstallPlatform({ ua: DESKTOP_CHROME, standalone: false }))
    expect(f.title).toContain('Chrome app')
    expect(f.cta).toContain('Chrome app')
    expect(f.title).not.toContain('home screen')
  })

  it('says APP, not Chrome app, on a non-Chrome desktop', () => {
    const f = installFraming(detectInstallPlatform({ ua: DESKTOP_FIREFOX, standalone: false }))
    expect(f.title).not.toContain('Chrome')
    expect(f.title).toContain('app')
  })

  it('says HOME SCREEN on mobile, both platforms', () => {
    for (const ua of [IPHONE_SAFARI, ANDROID_CHROME]) {
      const f = installFraming(detectInstallPlatform({ ua, standalone: false }))
      expect(f.title).toContain('home screen')
      expect(f.title).not.toContain('Chrome app')
    }
  })
})
