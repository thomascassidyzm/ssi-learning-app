/**
 * createAudioCacheSource tests
 *
 * Verifies the Wave 3 AudioCache → AudioSource adapter:
 *  - returns blob URLs from AudioCache.getWavBlobUrl when present
 *  - falls through to audioRef.url on cache miss
 *  - revokes every URL it ever handed out, exactly once
 *  - does NOT memoise internally (trusts the cache on every call)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { AudioRef } from '@ssi/core'
import { createAudioCacheSource } from './createAudioCacheSource'
import type { AudioCache } from './AudioCache.types'

const mockAudioRef: AudioRef = {
  id: 'audio-001',
  url: 'https://example.com/audio/001.mp3',
  duration_ms: 2000,
}

const mockAudioRef2: AudioRef = {
  id: 'audio-002',
  url: 'https://example.com/audio/002.mp3',
  duration_ms: 3000,
}

/**
 * Minimal AudioCache stub — the adapter only ever calls getWavBlobUrl().
 * Cast through unknown so TS accepts the partial shape.
 */
function createMockCache(): { audioCache: AudioCache; getWavBlobUrl: ReturnType<typeof vi.fn> } {
  const getWavBlobUrl = vi.fn()
  const audioCache = { getWavBlobUrl } as unknown as AudioCache
  return { audioCache, getWavBlobUrl }
}

describe('createAudioCacheSource', () => {
  let revokeSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    // URL.revokeObjectURL doesn't exist by default in jsdom — define a no-op
    // we can spy on. createObjectURL is not needed here: AudioCache produces
    // the blob URLs itself, we just shuttle them.
    if (typeof URL.revokeObjectURL !== 'function') {
      ;(URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = () => {}
    }
    revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  })

  it('returns the blob URL from audioCache.getWavBlobUrl when present', async () => {
    const { audioCache, getWavBlobUrl } = createMockCache()
    getWavBlobUrl.mockResolvedValueOnce('blob:fake-001')
    const source = createAudioCacheSource(audioCache, 'spa_for_eng_v2', () => true)

    const url = await source.getAudioUrl(mockAudioRef)

    expect(url).toBe('blob:fake-001')
    expect(getWavBlobUrl).toHaveBeenCalledWith('audio-001')
  })

  it('falls through to audioRef.url when audioCache.getWavBlobUrl returns null', async () => {
    const { audioCache, getWavBlobUrl } = createMockCache()
    getWavBlobUrl.mockResolvedValueOnce(null)
    const source = createAudioCacheSource(audioCache, 'spa_for_eng_v2', () => true)

    const url = await source.getAudioUrl(mockAudioRef)

    expect(url).toBe(mockAudioRef.url)
    expect(getWavBlobUrl).toHaveBeenCalledWith('audio-001')
  })

  it('revokeAllBlobUrls() revokes every URL it issued, exactly once each', async () => {
    const { audioCache, getWavBlobUrl } = createMockCache()
    getWavBlobUrl
      .mockResolvedValueOnce('blob:fake-001')
      .mockResolvedValueOnce('blob:fake-002')
    const source = createAudioCacheSource(audioCache, 'spa_for_eng_v2', () => true)

    await source.getAudioUrl(mockAudioRef)
    await source.getAudioUrl(mockAudioRef2)

    source.revokeAllBlobUrls()

    expect(revokeSpy).toHaveBeenCalledTimes(2)
    expect(revokeSpy).toHaveBeenCalledWith('blob:fake-001')
    expect(revokeSpy).toHaveBeenCalledWith('blob:fake-002')
  })

  it('does not revoke URLs that came from audioRef.url (cache miss fallthrough)', async () => {
    const { audioCache, getWavBlobUrl } = createMockCache()
    getWavBlobUrl.mockResolvedValueOnce(null)
    const source = createAudioCacheSource(audioCache, 'spa_for_eng_v2', () => true)

    await source.getAudioUrl(mockAudioRef)
    source.revokeAllBlobUrls()

    expect(revokeSpy).not.toHaveBeenCalled()
  })

  it('a second revokeAllBlobUrls() is a no-op (internal set was cleared)', async () => {
    const { audioCache, getWavBlobUrl } = createMockCache()
    getWavBlobUrl.mockResolvedValueOnce('blob:fake-001')
    const source = createAudioCacheSource(audioCache, 'spa_for_eng_v2', () => true)

    await source.getAudioUrl(mockAudioRef)

    source.revokeAllBlobUrls()
    source.revokeAllBlobUrls()

    expect(revokeSpy).toHaveBeenCalledTimes(1)
    expect(revokeSpy).toHaveBeenCalledWith('blob:fake-001')
  })

  it('does not memoise: each getAudioUrl call hits audioCache.getWavBlobUrl', async () => {
    // Same id queried twice: returns whatever the cache returns each call.
    // First call hit, second call miss (e.g. eviction between calls).
    const { audioCache, getWavBlobUrl } = createMockCache()
    getWavBlobUrl.mockResolvedValueOnce('blob:fake-001').mockResolvedValueOnce(null)
    const source = createAudioCacheSource(audioCache, 'spa_for_eng_v2', () => true)

    const first = await source.getAudioUrl(mockAudioRef)
    const second = await source.getAudioUrl(mockAudioRef)

    expect(first).toBe('blob:fake-001')
    expect(second).toBe(mockAudioRef.url)
    expect(getWavBlobUrl).toHaveBeenCalledTimes(2)
  })

  it('ignores courseId (kept for API parity with legacy createAudioSource)', async () => {
    const { audioCache, getWavBlobUrl } = createMockCache()
    getWavBlobUrl.mockResolvedValueOnce('blob:fake-001')
    const source = createAudioCacheSource(audioCache, 'any-course-id-here', () => true)

    const url = await source.getAudioUrl(mockAudioRef)

    expect(url).toBe('blob:fake-001')
    // getWavBlobUrl was called with the audio id only — never the course id.
    expect(getWavBlobUrl).toHaveBeenCalledWith('audio-001')
    expect(getWavBlobUrl).not.toHaveBeenCalledWith('any-course-id-here')
  })

  it('gate off (default): never touches the cache, always returns the network URL', async () => {
    // Online / streaming-first default — shouldServeBlobs omitted. The
    // blob path must stay dormant so the stabilised online path is untouched.
    const { audioCache, getWavBlobUrl } = createMockCache()
    getWavBlobUrl.mockResolvedValue('blob:fake-001')
    const source = createAudioCacheSource(audioCache, 'spa_for_eng_v2')

    const url = await source.getAudioUrl(mockAudioRef)

    expect(url).toBe(mockAudioRef.url)
    expect(getWavBlobUrl).not.toHaveBeenCalled()
  })
})
