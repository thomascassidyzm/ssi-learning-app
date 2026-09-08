/**
 * The staleness signal, from the shell's point of view.
 *
 * FLIPPED DELIBERATELY, 2026-09-08. This file used to prove the opposite: that
 * a bundled shell fired when it was provably behind, and asked the API origin
 * rather than its own frozen /version.json. Both were right while the APK
 * carried the web app. It is now a window onto the deployment, so the running
 * code IS the live code, `shouldDescribeStaleness()` answers NO everywhere,
 * and what this layer must not do is speak at all. The comparison machinery
 * stays proven in platform/buildStaleness.test.ts.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { configurePlatform, resetPlatform } from '../platform/capabilities'
import { appIsStale, checkAppStaleness } from './useAppStaleness'

const OLD = { buildNumber: 'local-ccbbe2f', buildTime: '2026-09-04T07:26:00.000Z' }
const LIVE = { buildNumber: 'bb0dffd8', buildTime: '2026-09-04T19:09:00.000Z' }

const stubVersion = (body: unknown) =>
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => body }))

beforeEach(() => {
  appIsStale.value = false
})

afterEach(() => {
  vi.unstubAllGlobals()
  resetPlatform()
})

describe('checkAppStaleness — inside the native shell', () => {
  it('never fetches and never fires, however stale the stamp looks', async () => {
    // The shell shows the deployment's own code. There is no second build to
    // be behind, and the update banner owns the case where a newer one is
    // waiting.
    configurePlatform({ shell: 'webview', apiOrigin: '' })
    stubVersion(LIVE)
    expect(await checkAppStaleness(OLD)).toBe(false)
    expect(appIsStale.value).toBe(false)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('stays silent on a shell that still stamps an API origin', async () => {
    configurePlatform({ shell: 'webview', apiOrigin: 'https://ssi-learning-app-git-dev-zenjin.vercel.app' })
    stubVersion(LIVE)
    expect(await checkAppStaleness(OLD)).toBe(false)
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('checkAppStaleness — on the web', () => {
  it('never fetches and never fires, however stale the stamp looks', async () => {
    configurePlatform({ shell: 'web', apiOrigin: '' })
    stubVersion(LIVE)
    expect(await checkAppStaleness(OLD)).toBe(false)
    expect(appIsStale.value).toBe(false)
    expect(fetch).not.toHaveBeenCalled()
  })
})
