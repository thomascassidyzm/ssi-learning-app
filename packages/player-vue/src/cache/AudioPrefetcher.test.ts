import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createAudioPrefetcher, type PrefetcherRound } from './AudioPrefetcher'
import type {
  CourseBundle,
  BundleLego,
  BundlePhrase,
  BundleAudioRef,
} from '../types/courseBundle'
import type { AudioCache } from './AudioCache.types'

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

function ephRef(id: string): BundleAudioRef {
  return { id, lifecycle: 'ephemeral' }
}

function persRef(id: string): BundleAudioRef {
  return { id, lifecycle: 'persistent' }
}

function makeLego(legoId: string): BundleLego {
  return {
    legoId,
    seedNumber: Number(legoId.slice(1, 5)),
    legoIndex: Number(legoId.slice(6)),
    seedId: legoId.slice(0, 5),
    type: 'A',
    knownText: `known-${legoId}`,
    targetText: `target-${legoId}`,
    isNew: true,
    ephemeralAudio: {
      known: ephRef(`${legoId}-known`),
      target1: ephRef(`${legoId}-t1`),
      target2: ephRef(`${legoId}-t2`),
      presentation: ephRef(`${legoId}-pres`),
    },
  }
}

function makeBuildPhrase(legoId: string, position: number): BundlePhrase {
  return {
    phraseId: `${legoId}_build_${position}`,
    legoId,
    position,
    role: 'build',
    knownText: `build-known-${position}`,
    targetText: `build-target-${position}`,
    audio: {
      known: ephRef(`${legoId}-build${position}-k`),
      target1: ephRef(`${legoId}-build${position}-t1`),
      target2: ephRef(`${legoId}-build${position}-t2`),
    },
  }
}

function makeUsePhrase(legoId: string, position: number): BundlePhrase {
  return {
    phraseId: `${legoId}_use_${position}`,
    legoId,
    position,
    role: 'use',
    knownText: `use-known-${position}`,
    targetText: `use-target-${position}`,
    audio: {
      known: persRef(`${legoId}-use${position}-k`),
      target1: persRef(`${legoId}-use${position}-t1`),
      target2: persRef(`${legoId}-use${position}-t2`),
    },
  }
}

function makeBundle(): CourseBundle {
  const legoIds = ['S0001L01', 'S0001L02', 'S0001L03', 'S0001L04', 'S0001L05']
  const legos = legoIds.map(makeLego)
  const phrases: BundlePhrase[] = []
  for (const legoId of legoIds) {
    // 2 build phrases per LEGO
    phrases.push(makeBuildPhrase(legoId, 1))
    phrases.push(makeBuildPhrase(legoId, 2))
    // 2 use phrases per LEGO (should NOT appear in ephemeral acquires)
    phrases.push(makeUsePhrase(legoId, 1))
    phrases.push(makeUsePhrase(legoId, 2))
  }
  return {
    courseCode: 'test-course',
    version: 1,
    mainLoopCount: legoIds.length,
    legos,
    phrases,
    seeds: [{ seedId: 'S0001', seedNumber: 1 }],
    roundMap: legoIds.map((legoId, i) => ({
      roundIndex: i + 1,
      legoId,
      seedNumber: 1,
    })),
    pods: [],
  }
}

// ---------------------------------------------------------------------------
// Mock cache
// ---------------------------------------------------------------------------

function makeMockCache() {
  const acquireForLego = vi.fn().mockResolvedValue(undefined)
  const releaseForLego = vi.fn().mockResolvedValue(3)
  const ephemeralHas = vi.fn().mockReturnValue(false)
  const ephemeralGetBlobUrl = vi.fn().mockResolvedValue(null)

  const ensure = vi.fn().mockResolvedValue(undefined)
  const persistentHas = vi.fn().mockReturnValue(false)
  const getBlobUrl = vi.fn().mockResolvedValue(null)
  const getWavBlobUrl = vi.fn().mockResolvedValue(null)
  const evictToTarget = vi.fn().mockResolvedValue(undefined)

  const has = vi.fn().mockReturnValue(false)
  const quotaPressure = vi.fn().mockResolvedValue(0)
  const stats = vi.fn()
  const clearCourse = vi.fn().mockResolvedValue(undefined)

  const cache: AudioCache = {
    ephemeral: {
      acquireForLego,
      releaseForLego,
      has: ephemeralHas,
      getBlobUrl: ephemeralGetBlobUrl,
    },
    persistent: {
      ensure,
      has: persistentHas,
      getBlobUrl,
      evictToTarget,
    },
    has,
    getBlobUrl,
    getWavBlobUrl,
    quotaPressure,
    stats,
    clearCourse,
  }

  return { cache, acquireForLego, releaseForLego, ensure }
}

// ---------------------------------------------------------------------------
// Round queue builder
// ---------------------------------------------------------------------------

function makeCycle(prefix: string): PrefetcherRound['cycles'][number] {
  return {
    known: { audioUrl: `/api/audio/${prefix}-k` },
    target: {
      voice1Url: `/api/audio/${prefix}-t1`,
      voice2Url: `/api/audio/${prefix}-t2`,
    },
  }
}

function makeRound(legoId: string | undefined, cycleCount = 2): PrefetcherRound {
  const cycles: PrefetcherRound['cycles'][number][] = []
  for (let i = 0; i < cycleCount; i++) {
    cycles.push(makeCycle(`${legoId ?? 'X'}-c${i}`))
  }
  return { legoId, cycles }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AudioPrefetcher', () => {
  let mock: ReturnType<typeof makeMockCache>
  let bundle: CourseBundle

  beforeEach(() => {
    mock = makeMockCache()
    bundle = makeBundle()
  })

  it('onRoundChanged is a no-op — no proactive ephemeral acquire (2026-05-23 streaming-first)', async () => {
    const prefetcher = createAudioPrefetcher({ audioCache: mock.cache })
    prefetcher.setBundle(bundle)

    const queue: PrefetcherRound[] = [
      makeRound('S0001L01'),
      makeRound('S0001L02'),
      makeRound('S0001L03'),
    ]
    await expect(prefetcher.onRoundChanged(queue, 0)).resolves.toBeUndefined()

    // Proactive prefetch was disabled 2026-05-23: persistent.ensure /
    // ephemeral.acquireForLego poisoned the SW CacheFirst layer with 200s that
    // iOS Safari couldn't reconcile with its own Range/206 media requests
    // (audio stalled, 'ended' never fired). onRoundChanged is kept as a no-op
    // grep-handle. Nothing is acquired.
    expect(mock.acquireForLego).not.toHaveBeenCalled()
    expect(mock.ensure).not.toHaveBeenCalled()
  })

  it('onRoundChanged is a no-op regardless of the lookahead option', async () => {
    const prefetcher = createAudioPrefetcher({ audioCache: mock.cache, lookahead: 2 })
    prefetcher.setBundle(bundle)

    const queue: PrefetcherRound[] = [
      makeRound('S0001L01'),
      makeRound('S0001L02'),
      makeRound('S0001L03'),
      makeRound('S0001L04'),
      makeRound('S0001L05'),
    ]
    await expect(prefetcher.onRoundChanged(queue, 0)).resolves.toBeUndefined()

    // lookahead now only governs onRoundCompleted's release window, not any
    // proactive acquire — onRoundChanged acquires nothing.
    expect(mock.acquireForLego).not.toHaveBeenCalled()
  })

  it('onRoundChanged does not touch the persistent (USE-phrase) layer', async () => {
    const prefetcher = createAudioPrefetcher({ audioCache: mock.cache, lookahead: 1 })
    prefetcher.setBundle(bundle)

    const queue: PrefetcherRound[] = [makeRound('S0001L01'), makeRound('S0001L02')]
    await expect(prefetcher.onRoundChanged(queue, 0)).resolves.toBeUndefined()

    // The ephemeral + persistent backstops were both disabled 2026-05-23.
    expect(mock.acquireForLego).not.toHaveBeenCalled()
    expect(mock.ensure).not.toHaveBeenCalled()
  })

  it('onRoundChanged runs no persistent backstop (disabled 2026-05-23)', async () => {
    const prefetcher = createAudioPrefetcher({
      audioCache: mock.cache,
      lookahead: 1,
      persistentLookaheadCycles: 5,
    })
    prefetcher.setBundle(bundle)

    const queue: PrefetcherRound[] = [
      makeRound('S0001L01', 3),
      makeRound('S0001L02', 3),
      makeRound('S0001L03', 3),
    ]
    await prefetcher.onRoundChanged(queue, 0)

    // Wait two microtasks in case any fire-and-forget work were scheduled.
    await Promise.resolve()
    await Promise.resolve()

    expect(mock.ensure).not.toHaveBeenCalled()
  })

  it('onRoundCompleted releases LEGO not in lookahead window', async () => {
    const prefetcher = createAudioPrefetcher({ audioCache: mock.cache, lookahead: 2 })
    prefetcher.setBundle(bundle)

    const queue = [
      { legoId: 'S0001L01' },
      { legoId: 'S0001L02' },
      { legoId: 'S0001L03' },
    ]
    await prefetcher.onRoundCompleted(queue, 0)

    expect(mock.releaseForLego).toHaveBeenCalledTimes(1)
    expect(mock.releaseForLego).toHaveBeenCalledWith('S0001L01')
  })

  it('onRoundCompleted KEEPS LEGO that reappears within lookahead', async () => {
    const prefetcher = createAudioPrefetcher({ audioCache: mock.cache, lookahead: 2 })
    prefetcher.setBundle(bundle)

    // L01 appears again at index 2, within lookahead 2.
    const queue = [
      { legoId: 'S0001L01' },
      { legoId: 'S0001L02' },
      { legoId: 'S0001L01' },
    ]
    await prefetcher.onRoundCompleted(queue, 0)

    expect(mock.releaseForLego).not.toHaveBeenCalled()
  })

  it('onRoundChanged cannot surface cache errors — it never touches the cache', async () => {
    mock.acquireForLego.mockRejectedValueOnce(new Error('cache exploded'))
    const prefetcher = createAudioPrefetcher({ audioCache: mock.cache, lookahead: 2 })
    prefetcher.setBundle(bundle)

    const queue: PrefetcherRound[] = [makeRound('S0001L01'), makeRound('S0001L02')]
    // No-op: nothing is acquired, so the rejection setup never fires and the
    // call resolves cleanly regardless.
    await expect(prefetcher.onRoundChanged(queue, 0)).resolves.toBeUndefined()
    expect(mock.acquireForLego).not.toHaveBeenCalled()
  })

  it('handles empty roundQueue and out-of-bounds index without throwing', async () => {
    const prefetcher = createAudioPrefetcher({ audioCache: mock.cache })
    prefetcher.setBundle(bundle)

    await expect(prefetcher.onRoundChanged([], 0)).resolves.toBeUndefined()
    await expect(prefetcher.onRoundChanged([makeRound('S0001L01')], 5)).resolves.toBeUndefined()
    await expect(prefetcher.onRoundChanged([makeRound('S0001L01')], -1)).resolves.toBeUndefined()

    await expect(prefetcher.onRoundCompleted([], 0)).resolves.toBeUndefined()
    await expect(prefetcher.onRoundCompleted([{ legoId: 'X' }], 5)).resolves.toBeUndefined()
    await expect(prefetcher.onRoundCompleted([{ legoId: 'X' }], -1)).resolves.toBeUndefined()

    expect(mock.acquireForLego).not.toHaveBeenCalled()
    expect(mock.releaseForLego).not.toHaveBeenCalled()
  })

  it('onRoundChanged no-ops on malformed/empty cycle audio without throwing', async () => {
    const prefetcher = createAudioPrefetcher({
      audioCache: mock.cache,
      lookahead: 1,
      persistentLookaheadCycles: 10,
    })
    prefetcher.setBundle(bundle)

    const queue: PrefetcherRound[] = [
      {
        legoId: 'S0001L01',
        cycles: [
          // Missing audioUrls
          {
            known: { audioUrl: '' },
            target: { voice1Url: '', voice2Url: '' },
          },
          // Malformed URLs
          {
            known: { audioUrl: 'not-a-real-url' },
            target: { voice1Url: 'nope', voice2Url: '/api/audio/' },
          },
          // One valid
          {
            known: { audioUrl: '/api/audio/good-k' },
            target: { voice1Url: '/api/audio/good-t1', voice2Url: '/api/audio/good-t2' },
          },
        ],
      },
    ]

    // The no-op never walks cycles, so malformed/empty URLs can't throw and
    // nothing reaches persistent.ensure.
    await expect(prefetcher.onRoundChanged(queue, 0)).resolves.toBeUndefined()
    await Promise.resolve()
    await Promise.resolve()
    expect(mock.ensure).not.toHaveBeenCalled()
  })

  it('reset() clears state so subsequent onRoundChanged is a no-op', async () => {
    const prefetcher = createAudioPrefetcher({ audioCache: mock.cache })
    prefetcher.setBundle(bundle)
    prefetcher.reset()

    const queue: PrefetcherRound[] = [makeRound('S0001L01'), makeRound('S0001L02')]
    await prefetcher.onRoundChanged(queue, 0)

    expect(mock.acquireForLego).not.toHaveBeenCalled()
    expect(mock.ensure).not.toHaveBeenCalled()
  })
})
