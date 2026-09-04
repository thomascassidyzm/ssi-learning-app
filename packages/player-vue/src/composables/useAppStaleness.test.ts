/**
 * The staleness signal, from the shell's point of view. The comparison itself
 * is proven in platform/buildStaleness.test.ts; what is tested here is the two
 * things only this layer can get wrong — firing on the WEB, where the sentence
 * it drives would be false, and reading the wrong origin's version.json, which
 * is the whole defect.
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
  beforeEach(() => {
    configurePlatform({ shell: 'webview', apiOrigin: 'https://ssi-learning-app-git-dev-zenjin.vercel.app' })
  })

  it('asks the API ORIGIN for version.json, not its own frozen copy', async () => {
    stubVersion(LIVE)
    await checkAppStaleness(OLD)
    expect(fetch).toHaveBeenCalledWith(
      'https://ssi-learning-app-git-dev-zenjin.vercel.app/version.json',
      { cache: 'no-store' },
    )
  })

  it('fires when the bundled build is provably behind the live one', async () => {
    stubVersion(LIVE)
    expect(await checkAppStaleness(OLD)).toBe(true)
    expect(appIsStale.value).toBe(true)
  })

  it('stays quiet on the build that is live', async () => {
    stubVersion(LIVE)
    expect(await checkAppStaleness({ buildNumber: 'local-bb0dffd', buildTime: LIVE.buildTime })).toBe(false)
    expect(appIsStale.value).toBe(false)
  })

  it('stays quiet when the network is gone', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    expect(await checkAppStaleness(OLD)).toBe(false)
    expect(appIsStale.value).toBe(false)
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
