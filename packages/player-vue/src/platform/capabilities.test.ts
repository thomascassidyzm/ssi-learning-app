import { afterEach, describe, expect, it } from 'vitest'
import {
  shouldRunServiceWorker,
  configurePlatform,
  hasServiceWorkerApi,
  isNativeShell,
  platform,
  resetPlatform,
} from './capabilities'

afterEach(() => resetPlatform())

describe('platform capabilities', () => {
  it('defaults to the web with no API origin — today, unchanged', () => {
    expect(platform()).toEqual({ shell: 'web', apiOrigin: '' })
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

  it('still reports whether an SW API exists, so diagnostics can no-op safely', () => {
    configurePlatform({ shell: 'webview' })
    expect(typeof hasServiceWorkerApi()).toBe('boolean')
  })

  it('reads an injected config from the shell', () => {
    window.__SSI_PLATFORM__ = { shell: 'webview', apiOrigin: 'https://api.example.test/' }
    resetPlatform()
    expect(platform()).toEqual({ shell: 'webview', apiOrigin: 'https://api.example.test' })
    delete window.__SSI_PLATFORM__
  })
})
