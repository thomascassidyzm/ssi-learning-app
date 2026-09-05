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
} from './capabilities'

afterEach(() => resetPlatform())

describe('platform capabilities', () => {
  it('defaults to the web with no API origin — today, unchanged', () => {
    expect(platform()).toEqual({ shell: 'web', apiOrigin: '', os: '' })
    expect(isNativeShell()).toBe(false)
  })

  it('runs a service worker on the web unconditionally — as today', () => {
    expect(shouldRunServiceWorker()).toBe(true)
  })

  it('never registers a service worker inside a native shell', () => {
    configurePlatform({ shell: 'webview' })
    expect(isNativeShell()).toBe(true)
    expect(shouldRunServiceWorker()).toBe(false)
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

  it('describes staleness in an Android shell — the 2026-09-04 cure, unchanged', () => {
    configurePlatform({ shell: 'webview', os: 'android' })
    expect(shouldDescribeStaleness()).toBe(true)
  })

  it('stays LOUD in a shell that never said its OS — today\'s Android stamp', () => {
    // The stamps in the field carry no `os`. Going quiet on '' would silently
    // revert the staleness cure on every one of them.
    configurePlatform({ shell: 'webview' })
    expect(platform().os).toBe('')
    expect(shouldDescribeStaleness()).toBe(true)
  })

  it('says NOTHING about staleness on iOS — TestFlight owns update delivery', () => {
    // The Android line promises "install it from popty.app/builds", which is a
    // real resolution on Android and a lie on iOS: no sideload exists, and a
    // newer web deployment does not imply any newer TestFlight build to
    // install. Silence, per buildStaleness.ts rule 2.
    configurePlatform({ shell: 'webview', os: 'ios' })
    expect(shouldDescribeStaleness()).toBe(false)
  })

  it('never describes staleness on the web, whatever the os claims', () => {
    configurePlatform({ shell: 'web', os: 'android' })
    expect(shouldDescribeStaleness()).toBe(false)
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
