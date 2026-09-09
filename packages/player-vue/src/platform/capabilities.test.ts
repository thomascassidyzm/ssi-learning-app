import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  shouldRunServiceWorker,
  shouldOfferAppInstall,
  shouldDescribeStaleness,
  configurePlatform,
  hasServiceWorkerApi,
  isNativeShell,
  platform,
  resetPlatform,
  SHELL_UA_MARKER,
} from './capabilities'

afterEach(() => resetPlatform())

/** Run `fn` with a pretend user agent, then put the real one back. */
function withUserAgent(ua: string, fn: () => void): void {
  const original = Object.getOwnPropertyDescriptor(navigator, 'userAgent')
  Object.defineProperty(navigator, 'userAgent', { value: ua, configurable: true })
  try {
    fn()
  } finally {
    if (original) Object.defineProperty(navigator, 'userAgent', original)
    else delete (navigator as any).userAgent
  }
}

describe('platform capabilities', () => {
  it('defaults to the web with no API origin — today, unchanged', () => {
    expect(platform()).toEqual({ shell: 'web', apiOrigin: '', os: '' })
    expect(isNativeShell()).toBe(false)
  })

  it('runs a service worker on the web unconditionally — as today', () => {
    expect(shouldRunServiceWorker()).toBe(true)
  })

  it('RUNS a service worker inside the native shell — the offline story, 2026-09-08', () => {
    // Flipped deliberately. While the APK bundled its web assets this was
    // false, and rightly: the shell owned the code and a precache under it was
    // a frozen copy of a frozen copy. The shell is now a window onto the
    // deployment, so the shell the service worker precaches is the
    // deployment's own, and it is the only thing that makes the app open and
    // play with no network.
    configurePlatform({ shell: 'webview' })
    expect(isNativeShell()).toBe(true)
    expect(shouldRunServiceWorker()).toBe(true)
  })

  it('offers the install banner on the web — as today', () => {
    expect(shouldOfferAppInstall()).toBe(true)
  })

  it('never offers "install this app" inside a native shell', () => {
    // The learner installed the app to get here. Note the banner's own gate was
    // `display-mode: standalone`, which is FALSE in a WebView — which is why
    // this question has to be asked here rather than left to the display mode.
    configurePlatform({ shell: 'webview' })
    expect(shouldOfferAppInstall()).toBe(false)
  })

  it('still reports whether an SW API exists, so diagnostics can no-op safely', () => {
    configurePlatform({ shell: 'webview' })
    expect(typeof hasServiceWorkerApi()).toBe('boolean')
  })

  it('reads an injected config from the shell', () => {
    window.__SSI_PLATFORM__ = { shell: 'webview', apiOrigin: 'https://api.example.test/' }
    resetPlatform()
    expect(platform()).toEqual({ shell: 'webview', apiOrigin: 'https://api.example.test', os: '' })
    delete window.__SSI_PLATFORM__
  })

  it('says NOTHING about staleness in a shell, on any OS — 2026-09-08', () => {
    // Flipped deliberately. The 2026-09-04 line existed because a bundled APK
    // could not notice new code and the only remedy was installing a new app.
    // A window onto the deployment IS the live code, and where a newer build
    // is waiting the update banner owns it and a reload resolves it.
    for (const os of ['android', 'ios', ''] as const) {
      configurePlatform({ shell: 'webview', os })
      expect(shouldDescribeStaleness()).toBe(false)
    }
  })

  it('never describes staleness on the web, whatever the os claims', () => {
    configurePlatform({ shell: 'web', os: 'android' })
    expect(shouldDescribeStaleness()).toBe(false)
  })

  it('reads the shell out of the user agent when nothing is injected', () => {
    // The remote shell has no index.html of ours to stamp, so it says who it
    // is in the UA. SHELL_UA_MARKER must stay in step with appendUserAgent in
    // capacitor.config.ts.
    expect(SHELL_UA_MARKER).toBe('SSiShell/')
    withUserAgent('Mozilla/5.0 (Linux; Android 14) Chrome/120 SSiShell/android', () => {
      resetPlatform()
      expect(platform()).toEqual({ shell: 'webview', apiOrigin: '', os: 'android' })
    })
  })

  it('reads an iOS shell marker, and an unmarked UA stays the web', () => {
    withUserAgent('Mozilla/5.0 (iPhone) SSiShell/ios', () => {
      resetPlatform()
      expect(platform().os).toBe('ios')
      expect(isNativeShell()).toBe(true)
    })
    withUserAgent('Mozilla/5.0 (Macintosh) Safari/605', () => {
      resetPlatform()
      expect(platform()).toEqual({ shell: 'web', apiOrigin: '', os: '' })
    })
  })

  it('leaves apiOrigin empty in the remote shell — every /api path is same-origin again', () => {
    withUserAgent('Mozilla/5.0 (Linux; Android 14) SSiShell/android', () => {
      resetPlatform()
      expect(platform().apiOrigin).toBe('')
    })
  })

  it('reads an injected os and rejects junk values', () => {
    window.__SSI_PLATFORM__ = { shell: 'webview', apiOrigin: 'https://api.example.test', os: 'ios' }
    resetPlatform()
    expect(platform().os).toBe('ios')
    window.__SSI_PLATFORM__ = { shell: 'webview', apiOrigin: 'https://api.example.test', os: 'windows' as any }
    resetPlatform()
    expect(platform().os).toBe('')
    delete window.__SSI_PLATFORM__
  })
})

/**
 * The comment in capacitor.config.ts says "keep this string in step with
 * SHELL_UA_MARKER"; a comment is not a gate. This is. Both shells say who they
 * are ONLY in the user agent — the remote deployment's index.html is not ours
 * to stamp — so a marker that drifts by one character turns every native build
 * into an ordinary web page silently: the service worker rule, the install
 * prompt and the staleness line all flip, and nothing throws.
 */
describe('the shell markers in capacitor.config.ts', () => {
  // vitest's root is the package directory, so the config sits at the top of it.
  const config = readFileSync(resolve(process.cwd(), 'capacitor.config.ts'), 'utf8')

  it('appends a marker for each platform that capabilities.ts can read back', () => {
    for (const os of ['android', 'ios'] as const) {
      const match = config.match(new RegExp(`appendUserAgent:\\s*'([^']*${os})'`))
      expect(match, `no appendUserAgent for ${os} in capacitor.config.ts`).toBeTruthy()
      const marker = match![1]
      expect(marker).toBe(`${SHELL_UA_MARKER}${os}`)

      withUserAgent(`Mozilla/5.0 (probe) ${marker}`, () => {
        resetPlatform()
        expect(platform()).toEqual({ shell: 'webview', apiOrigin: '', os })
      })
    }
  })
})
