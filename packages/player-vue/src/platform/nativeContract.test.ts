/**
 * THE TWO HALVES OF THE NATIVE SEAM MUST AGREE, AND THE SHELL MUST NEVER
 * DECLARE LESS THAN THE WEB REQUIRES.
 *
 * The whole mechanism is two integers in two files — SHELL_NATIVE_LEVEL in
 * capacitor.config.ts and WEB_REQUIRES_NATIVE_LEVEL here — and its only failure
 * mode is the two drifting apart. If the web starts requiring level 2 while the
 * shell in this repo still builds level 1, then the APK we ourselves build is
 * born telling its holder to go and update it, which is nonsense. That is what
 * this file exists to catch, at the moment the number is typed rather than on a
 * phone.
 *
 * It also pins the user-agent FORMAT, because that string is the entire wire
 * protocol between the two halves and it is written down in two places by
 * necessity: the shell appends it, capabilities.ts parses it.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { WEB_REQUIRES_NATIVE_LEVEL, needsStoreUpdate } from './nativeContract'
import { configurePlatform, resetPlatform, platform } from './capabilities'

const CONFIG_PATH = resolve(process.cwd(), 'capacitor.config.ts')

/** The level the Android shell in this repo builds itself as. */
function shellNativeLevel(): number {
  const src = readFileSync(CONFIG_PATH, 'utf8')
  const m = /^const SHELL_NATIVE_LEVEL = (\d+)$/m.exec(src)
  if (!m) throw new Error('capacitor.config.ts no longer declares SHELL_NATIVE_LEVEL')
  return Number(m[1])
}

describe('the native contract', () => {
  afterEach(() => { resetPlatform() })

  it('has the shell declaring at least what the web requires', () => {
    expect(shellNativeLevel()).toBeGreaterThanOrEqual(WEB_REQUIRES_NATIVE_LEVEL)
  })

  it('declares the level in the user agent, in the shape capabilities parses', () => {
    const src = readFileSync(CONFIG_PATH, 'utf8')
    // `SSiShell/android/<level>` — the os read with startsWith, so appending
    // the level could not break the APKs already installed on phones.
    expect(src).toContain('appendUserAgent: `SSiShell/android/${SHELL_NATIVE_LEVEL}`')
  })

  it('reads the level a marked shell declares', () => {
    const ua = `Mozilla/5.0 (Linux; Android 14) SSiShell/android/${shellNativeLevel()}`
    const original = Object.getOwnPropertyDescriptor(navigator, 'userAgent')
    Object.defineProperty(navigator, 'userAgent', { value: ua, configurable: true })
    try {
      resetPlatform()
      expect(platform().os).toBe('android')
      expect(platform().nativeLevel).toBe(shellNativeLevel())
    } finally {
      if (original) Object.defineProperty(navigator, 'userAgent', original)
      else delete (navigator as unknown as Record<string, unknown>).userAgent
    }
  })

  it('reads a shell built before the contract as level 0, not as unknown', () => {
    const original = Object.getOwnPropertyDescriptor(navigator, 'userAgent')
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Linux; Android 14) SSiShell/android',
      configurable: true,
    })
    try {
      resetPlatform()
      expect(platform().shell).toBe('webview')
      expect(platform().nativeLevel).toBe(0)
    } finally {
      if (original) Object.defineProperty(navigator, 'userAgent', original)
      else delete (navigator as unknown as Record<string, unknown>).userAgent
    }
  })

  it('says nothing on the web, whatever the web requires', () => {
    configurePlatform({ shell: 'web', os: '', nativeLevel: 0 })
    expect(needsStoreUpdate()).toBe(false)
  })

  it('is silent while the web requires nothing the shell lacks', () => {
    configurePlatform({ shell: 'webview', os: 'android', nativeLevel: WEB_REQUIRES_NATIVE_LEVEL })
    expect(needsStoreUpdate()).toBe(false)
  })

  it('tells a shell that is genuinely behind', () => {
    configurePlatform({ shell: 'webview', os: 'android', nativeLevel: WEB_REQUIRES_NATIVE_LEVEL - 1 })
    expect(needsStoreUpdate()).toBe(true)
  })

  it('stays quiet at rest — nothing in the web requires a native level yet', () => {
    // Not a style rule: a store-update line shown when nothing is actually
    // missing sends a learner to reinstall an app that is already right, which
    // is the exact failure the retired staleness line was retired for.
    expect(WEB_REQUIRES_NATIVE_LEVEL).toBe(0)
  })
})
