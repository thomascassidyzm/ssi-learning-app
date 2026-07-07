import { describe, it, expect, vi, afterEach } from 'vitest'
import { isDifferentBuild, fetchLatestBuildNumber } from './usePwaUpdate'

describe('isDifferentBuild — build-identity check behind the PWA update banner', () => {
  it('is false when the running build matches the live build (same-build → no banner)', () => {
    expect(isDifferentBuild('abc1234', 'abc1234')).toBe(false)
  })

  it('is true when the running build differs from the live build (genuinely-new build → banner)', () => {
    expect(isDifferentBuild('abc1234', 'def5678')).toBe(true)
  })

  it('fails open (true) when the live build could not be determined', () => {
    expect(isDifferentBuild('abc1234', null)).toBe(true)
    expect(isDifferentBuild('abc1234', undefined)).toBe(true)
  })

  it('always reports true for local dev builds (no stable id to compare)', () => {
    expect(isDifferentBuild('dev', 'dev')).toBe(true)
  })
})

describe('fetchLatestBuildNumber — reads the live build id, bypassing every cache layer', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns the buildNumber from /version.json on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ buildNumber: 'def5678' }),
    }))
    expect(await fetchLatestBuildNumber()).toBe('def5678')
    expect(fetch).toHaveBeenCalledWith('/version.json', { cache: 'no-store' })
  })

  it('returns null on a non-OK response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))
    expect(await fetchLatestBuildNumber()).toBeNull()
  })

  it('returns null when the fetch throws (offline)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    expect(await fetchLatestBuildNumber()).toBeNull()
  })

  it('returns null when the payload has no string buildNumber', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    }))
    expect(await fetchLatestBuildNumber()).toBeNull()
  })
})
