/**
 * Tests for BundleDownloader.
 *
 * The downloader is a thin coordinator over AudioCache, so the cache
 * itself is mocked end-to-end. We assert on call sequences, queue
 * de-duplication, resume-cursor behaviour, concurrency and quota
 * back-off.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AudioCache } from './AudioCache.types'
import type { CourseBundle, BundleLego, BundlePhrase, BundleRoundMapEntry } from '../types/courseBundle'
import { createBundleDownloader } from './BundleDownloader'

// ---------------------------------------------------------------------------
// localStorage shim (matches the project's existing pattern)
// ---------------------------------------------------------------------------

const lsStore: Record<string, string> = {}
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: vi.fn((key: string) => lsStore[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      lsStore[key] = value
    }),
    removeItem: vi.fn((key: string) => {
      delete lsStore[key]
    }),
    clear: vi.fn(() => {
      Object.keys(lsStore).forEach((k) => delete lsStore[k])
    }),
  },
  writable: true,
})

// ---------------------------------------------------------------------------
// Mock AudioCache helpers
// ---------------------------------------------------------------------------

interface MockCache {
  audioCache: AudioCache
  // Test-side state
  cachedSet: Set<string>
  ensureCalls: string[]
  /** Promises in-flight, keyed by id — tests can resolve to control timing. */
  pendingEnsures: Map<string, { resolve: () => void; reject: (err: Error) => void }>
  /** Concurrent ensures observed at peak. */
  peakInFlight: number
  /** Current in-flight count. */
  currentInFlight: number
  /** Quota pressure value the cache will report. */
  pressure: number
}

function makeMockCache(opts: {
  /** Mode: 'auto' resolves immediately, 'manual' waits for test to call resolveEnsure. */
  mode?: 'auto' | 'manual'
  /** Ids to fail (throws on ensure). */
  failIds?: Set<string>
  /** Initial pressure. */
  pressure?: number
  /** Pre-cached ids (has() returns true). */
  preCached?: string[]
} = {}): MockCache {
  const mode = opts.mode ?? 'auto'
  const failIds = opts.failIds ?? new Set<string>()
  const cachedSet = new Set<string>(opts.preCached ?? [])
  const ensureCalls: string[] = []
  const pendingEnsures = new Map<
    string,
    { resolve: () => void; reject: (err: Error) => void }
  >()
  const state = { peakInFlight: 0, currentInFlight: 0, pressure: opts.pressure ?? 0 }

  const ensure = vi.fn(async (id: string): Promise<void> => {
    ensureCalls.push(id)
    state.currentInFlight += 1
    state.peakInFlight = Math.max(state.peakInFlight, state.currentInFlight)
    try {
      if (failIds.has(id)) {
        throw new Error(`fail-${id}`)
      }
      if (mode === 'auto') {
        cachedSet.add(id)
        return
      }
      // manual mode: wait for the test to resolve us
      await new Promise<void>((resolve, reject) => {
        pendingEnsures.set(id, {
          resolve: () => {
            cachedSet.add(id)
            pendingEnsures.delete(id)
            resolve()
          },
          reject: (err: Error) => {
            pendingEnsures.delete(id)
            reject(err)
          },
        })
      })
    } finally {
      state.currentInFlight -= 1
    }
  })

  const audioCache: AudioCache = {
    persistent: {
      ensure,
      has: (id: string) => cachedSet.has(id),
      getBlobUrl: vi.fn(async () => null),
      evictToTarget: vi.fn(async () => undefined),
    },
    ephemeral: {
      acquireForLego: vi.fn(async () => undefined),
      releaseForLego: vi.fn(async () => 0),
      has: vi.fn(() => false),
      getBlobUrl: vi.fn(async () => null),
    },
    has: (id: string) => cachedSet.has(id),
    getBlobUrl: vi.fn(async () => null),
    quotaPressure: vi.fn(async () => state.pressure),
    stats: vi.fn(async () => ({
      persistent: { count: cachedSet.size, bytes: 0 },
      ephemeral: { count: 0, bytes: 0 },
      quotaBytes: undefined,
      usageBytes: undefined,
    })),
    clearCourse: vi.fn(async () => undefined),
  }

  return {
    audioCache,
    cachedSet,
    ensureCalls,
    pendingEnsures,
    get peakInFlight() {
      return state.peakInFlight
    },
    get currentInFlight() {
      return state.currentInFlight
    },
    get pressure() {
      return state.pressure
    },
    set pressure(v: number) {
      state.pressure = v
    },
  } as MockCache
}

// ---------------------------------------------------------------------------
// Bundle fixture: 5 LEGOs × 1 USE phrase × {k, t1, t2} = 15 persistent ids
// ---------------------------------------------------------------------------

function buildBundle(courseCode = 'spa', version = 1): CourseBundle {
  const legos: BundleLego[] = []
  const phrases: BundlePhrase[] = []
  const roundMap: BundleRoundMapEntry[] = []

  for (let i = 1; i <= 5; i++) {
    const legoId = `L${i}`
    legos.push({
      legoId,
      seedNumber: i,
      legoIndex: 1,
      seedId: `S${i}`,
      type: 'A',
      knownText: `known-${i}`,
      targetText: `target-${i}`,
      isNew: true,
      ephemeralAudio: {},
    })
    phrases.push({
      phraseId: `${legoId}_use_01`,
      legoId,
      position: 1,
      role: 'use',
      knownText: `k-${i}`,
      targetText: `t-${i}`,
      audio: {
        known: { id: `${legoId}-k`, lifecycle: 'persistent' },
        target1: { id: `${legoId}-t1`, lifecycle: 'persistent' },
        target2: { id: `${legoId}-t2`, lifecycle: 'persistent' },
      },
    })
    roundMap.push({ roundIndex: i, legoId, seedNumber: i })
  }

  return {
    courseCode,
    version,
    mainLoopCount: 5,
    legos,
    phrases,
    seeds: [],
    roundMap,
  }
}

const ALL_15_IDS = [
  'L1-k', 'L1-t1', 'L1-t2',
  'L2-k', 'L2-t1', 'L2-t2',
  'L3-k', 'L3-t1', 'L3-t2',
  'L4-k', 'L4-t1', 'L4-t2',
  'L5-k', 'L5-t1', 'L5-t2',
]

/** Drain microtasks until predicate returns true or maxTicks elapses. */
async function tickUntil(predicate: () => boolean, maxTicks = 50): Promise<void> {
  for (let i = 0; i < maxTicks; i++) {
    if (predicate()) return
    await Promise.resolve()
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  // Wipe localStorage between tests so cursors don't leak.
  Object.keys(lsStore).forEach((k) => delete lsStore[k])
})

describe('BundleDownloader', () => {
  it('walks persistent audio in roundMap order', async () => {
    const mock = makeMockCache({ mode: 'auto' })
    const dl = createBundleDownloader({ audioCache: mock.audioCache })
    const bundle = buildBundle()
    await dl.start(bundle)
    expect(mock.ensureCalls).toEqual(ALL_15_IDS)
  })

  it('skips ids already present in cache', async () => {
    const preCached = ['L1-k', 'L2-t1', 'L3-t2']
    const mock = makeMockCache({ mode: 'auto', preCached })
    const dl = createBundleDownloader({ audioCache: mock.audioCache })
    const bundle = buildBundle()
    await dl.start(bundle)
    // None of the pre-cached ids should be ensure()'d.
    for (const id of preCached) {
      expect(mock.ensureCalls).not.toContain(id)
    }
    expect(mock.ensureCalls).toHaveLength(15 - preCached.length)
    // Final progress: all 15 counted as cached.
    expect(dl.getProgress().cached).toBe(15)
    expect(dl.getProgress().total).toBe(15)
  })

  it('honours a resume cursor with matching version', async () => {
    const bundle = buildBundle('spa', 7)
    lsStore['ssi-bundle-download-spa'] = JSON.stringify({
      version: 7,
      cachedIds: ['L1-k', 'L1-t1', 'L1-t2', 'L2-k'],
    })
    const mock = makeMockCache({ mode: 'auto' })
    const dl = createBundleDownloader({ audioCache: mock.audioCache })
    await dl.start(bundle)
    // First 4 ids should be skipped; remaining 11 attempted.
    expect(mock.ensureCalls).not.toContain('L1-k')
    expect(mock.ensureCalls).not.toContain('L1-t1')
    expect(mock.ensureCalls).not.toContain('L1-t2')
    expect(mock.ensureCalls).not.toContain('L2-k')
    expect(mock.ensureCalls).toHaveLength(11)
  })

  it('wipes the cursor on version mismatch and attempts every id', async () => {
    const bundle = buildBundle('spa', 8)
    lsStore['ssi-bundle-download-spa'] = JSON.stringify({
      version: 7, // stale
      cachedIds: ['L1-k', 'L1-t1', 'L1-t2'],
    })
    const mock = makeMockCache({ mode: 'auto' })
    const dl = createBundleDownloader({ audioCache: mock.audioCache })
    await dl.start(bundle)
    expect(mock.ensureCalls).toEqual(ALL_15_IDS)
  })

  it('respects the concurrency cap (no more than N in-flight at once)', async () => {
    const mock = makeMockCache({ mode: 'manual' })
    const dl = createBundleDownloader({ audioCache: mock.audioCache, concurrency: 2 })
    const bundle = buildBundle()
    const runPromise = dl.start(bundle)

    // Wait until first batch is in-flight.
    await tickUntil(() => mock.ensureCalls.length >= 2)

    // First batch: 2 in-flight, 2 ensure calls.
    expect(mock.ensureCalls).toHaveLength(2)
    expect(mock.currentInFlight).toBe(2)

    // Drain the entire queue, two at a time.
    while (mock.pendingEnsures.size > 0 || mock.ensureCalls.length < 15) {
      const pending = Array.from(mock.pendingEnsures.values())
      for (const p of pending) p.resolve()
      const before = mock.ensureCalls.length
      // Wait for either new ensures to start or the queue to settle.
      await tickUntil(
        () => mock.ensureCalls.length > before || mock.ensureCalls.length >= 15,
      )
    }

    await runPromise
    expect(mock.peakInFlight).toBeLessThanOrEqual(2)
    expect(mock.ensureCalls).toHaveLength(15)
  })

  it('continues past an ensure() error and records lastError', async () => {
    const failIds = new Set(['L2-t1', 'L4-k'])
    const mock = makeMockCache({ mode: 'auto', failIds })
    const dl = createBundleDownloader({ audioCache: mock.audioCache })
    const bundle = buildBundle()
    await dl.start(bundle)
    // Every id was attempted, even the failing ones.
    expect(mock.ensureCalls).toEqual(ALL_15_IDS)
    // 13 cached (15 minus the 2 failures).
    expect(dl.getProgress().cached).toBe(13)
    // lastError reflects one of the failures (the last one chronologically).
    expect(dl.getProgress().lastError).toMatch(/fail-(L2-t1|L4-k)/)
  })

  it('halts and emits haltedForQuota when pressure exceeds ceiling', async () => {
    const mock = makeMockCache({ mode: 'auto', pressure: 0.9 })
    const dl = createBundleDownloader({
      audioCache: mock.audioCache,
      quotaPressureCeiling: 0.85,
    })
    const bundle = buildBundle()
    await dl.start(bundle)
    expect(dl.getProgress().haltedForQuota).toBe(true)
    expect(dl.getProgress().isRunning).toBe(false)
    // No ensures fired — first quota check rejected the very first batch.
    expect(mock.ensureCalls).toHaveLength(0)
  })

  it('emits monotonically increasing `cached` counts to subscribers', async () => {
    const mock = makeMockCache({ mode: 'auto' })
    const dl = createBundleDownloader({ audioCache: mock.audioCache })
    const cachedSeries: number[] = []
    dl.onProgress((p) => cachedSeries.push(p.cached))
    await dl.start(buildBundle())
    // Strictly non-decreasing.
    for (let i = 1; i < cachedSeries.length; i++) {
      expect(cachedSeries[i]).toBeGreaterThanOrEqual(cachedSeries[i - 1])
    }
    // Final value reaches 15.
    expect(cachedSeries[cachedSeries.length - 1]).toBe(15)
  })

  it('stop() halts the loop after the current batch resolves', async () => {
    const mock = makeMockCache({ mode: 'manual' })
    const dl = createBundleDownloader({ audioCache: mock.audioCache, concurrency: 2 })
    const bundle = buildBundle()
    const runPromise = dl.start(bundle)

    // Wait for first batch to be in-flight.
    await tickUntil(() => mock.ensureCalls.length >= 2)
    expect(mock.ensureCalls).toHaveLength(2)

    // Request stop, then resolve the in-flight ensures.
    dl.stop()
    for (const p of Array.from(mock.pendingEnsures.values())) p.resolve()
    await runPromise

    // Only the first 2 ensures should have happened — no further calls.
    expect(mock.ensureCalls).toHaveLength(2)
  })

  it('resetCursor() removes the localStorage key for the course', async () => {
    lsStore['ssi-bundle-download-spa'] = JSON.stringify({
      version: 1,
      cachedIds: ['L1-k'],
    })
    lsStore['ssi-bundle-download-fra'] = JSON.stringify({
      version: 1,
      cachedIds: ['X-k'],
    })
    const mock = makeMockCache({ mode: 'auto' })
    const dl = createBundleDownloader({ audioCache: mock.audioCache })
    dl.resetCursor('spa')
    expect(lsStore['ssi-bundle-download-spa']).toBeUndefined()
    // Other courses are left intact.
    expect(lsStore['ssi-bundle-download-fra']).toBeDefined()
  })
})
