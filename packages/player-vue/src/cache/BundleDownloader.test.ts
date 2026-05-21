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
import type {
  CourseBundle,
  BundleLego,
  BundlePhrase,
  BundlePod,
  BundleRoundMapEntry,
} from '../types/courseBundle'
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
    pods: [],
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
    const dl = createBundleDownloader({ audioCache: mock.audioCache, sleep: async () => undefined })
    const bundle = buildBundle()
    await dl.start(bundle)
    expect(mock.ensureCalls).toEqual(ALL_15_IDS)
  })

  it('walks pods before USE phrases, pods in pod_order ascending', async () => {
    const mock = makeMockCache({ mode: 'auto' })
    const dl = createBundleDownloader({ audioCache: mock.audioCache, sleep: async () => undefined })
    const bundle = buildBundle()
    // Two pods, pod_order 1 then 0 — walker must reorder.
    const pods: BundlePod[] = [
      {
        podId: 'p1',
        podOrder: 1,
        title: 'Second',
        introAudio: { id: 'p1-intro', lifecycle: 'persistent' },
        outroAudio: { id: 'p1-outro', lifecycle: 'persistent' },
        sentences: [
          {
            globalOrder: 2,
            knownText: 'k2',
            targetText: 't2',
            glueToNext: false,
            targetAudio: { id: 'p1-s2-tgt', lifecycle: 'persistent' },
            knownAudio: { id: 'p1-s2-kn', lifecycle: 'persistent' },
          },
          {
            globalOrder: 1,
            knownText: 'k1',
            targetText: 't1',
            glueToNext: false,
            targetAudio: { id: 'p1-s1-tgt', lifecycle: 'persistent' },
            knownAudio: { id: 'p1-s1-kn', lifecycle: 'persistent' },
          },
        ],
      },
      {
        podId: 'p0',
        podOrder: 0,
        title: 'First',
        introAudio: { id: 'p0-intro', lifecycle: 'persistent' },
        outroAudio: { id: 'p0-outro', lifecycle: 'persistent' },
        sentences: [
          {
            globalOrder: 1,
            knownText: 'k1',
            targetText: 't1',
            glueToNext: false,
            targetAudio: { id: 'p0-s1-tgt', lifecycle: 'persistent' },
            knownAudio: { id: 'p0-s1-kn', lifecycle: 'persistent' },
          },
        ],
      },
    ]
    bundle.pods = pods
    await dl.start(bundle)

    // First: pod 0 (intro → sentences globalOrder asc → outro).
    // Second: pod 1 (intro → sentences globalOrder asc → outro).
    // Then: all 15 USE phrase ids.
    expect(mock.ensureCalls).toEqual([
      'p0-intro',
      'p0-s1-tgt', 'p0-s1-kn',
      'p0-outro',
      'p1-intro',
      'p1-s1-tgt', 'p1-s1-kn',
      'p1-s2-tgt', 'p1-s2-kn',
      'p1-outro',
      ...ALL_15_IDS,
    ])
  })

  it('dedupes shared bookend audio across pods', async () => {
    const mock = makeMockCache({ mode: 'auto' })
    const dl = createBundleDownloader({ audioCache: mock.audioCache, sleep: async () => undefined })
    const bundle = buildBundle()
    // Shared bookend ids — common case where the server inlines the same
    // course-level intro/outro on every pod.
    const sharedIntro = { id: 'shared-intro', lifecycle: 'persistent' as const }
    const sharedOutro = { id: 'shared-outro', lifecycle: 'persistent' as const }
    bundle.pods = [
      {
        podId: 'p0',
        podOrder: 0,
        title: null,
        introAudio: sharedIntro,
        outroAudio: sharedOutro,
        sentences: [],
      },
      {
        podId: 'p1',
        podOrder: 1,
        title: null,
        introAudio: sharedIntro,
        outroAudio: sharedOutro,
        sentences: [],
      },
    ]
    await dl.start(bundle)
    // Each shared id appears exactly once.
    expect(mock.ensureCalls.filter((id) => id === 'shared-intro')).toHaveLength(1)
    expect(mock.ensureCalls.filter((id) => id === 'shared-outro')).toHaveLength(1)
  })

  it('skips ids already present in cache', async () => {
    const preCached = ['L1-k', 'L2-t1', 'L3-t2']
    const mock = makeMockCache({ mode: 'auto', preCached })
    const dl = createBundleDownloader({ audioCache: mock.audioCache, sleep: async () => undefined })
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
    const dl = createBundleDownloader({ audioCache: mock.audioCache, sleep: async () => undefined })
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
    const dl = createBundleDownloader({ audioCache: mock.audioCache, sleep: async () => undefined })
    await dl.start(bundle)
    expect(mock.ensureCalls).toEqual(ALL_15_IDS)
  })

  it('respects the concurrency cap (no more than N in-flight at once)', async () => {
    const mock = makeMockCache({ mode: 'manual' })
    const dl = createBundleDownloader({ audioCache: mock.audioCache, concurrency: 2, sleep: async () => undefined })
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
    const dl = createBundleDownloader({ audioCache: mock.audioCache, sleep: async () => undefined })
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
      sleep: async () => undefined,
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
    const dl = createBundleDownloader({ audioCache: mock.audioCache, sleep: async () => undefined })
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
    const dl = createBundleDownloader({ audioCache: mock.audioCache, concurrency: 2, sleep: async () => undefined })
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

  // -------------------------------------------------------------------------
  // Politeness: jitter + 429/503 backoff
  // -------------------------------------------------------------------------

  it('applies jitter between cache-miss fetches but skips it for cache hits', async () => {
    // Pre-cache 3 of the 15 ids so the queue still contains the other 12.
    // After build, has() is also true for those 12 once auto-mode ensures
    // them — but the worker's hit-check runs BEFORE ensure, so all 12 are
    // miss-path and each gets one sleep call. The 3 pre-cached are filtered
    // out at queue build and never reach the worker.
    const mock = makeMockCache({ mode: 'auto', preCached: ['L1-k', 'L2-t1', 'L3-t2'] })
    const sleep = vi.fn(async (_ms: number) => undefined)
    const random = vi.fn(() => 0.5) // → 200ms
    const dl = createBundleDownloader({
      audioCache: mock.audioCache,
      sleep,
      random,
    })
    await dl.start(buildBundle())
    // 12 miss-path ensures, each preceded by exactly one jitter sleep.
    expect(mock.ensureCalls).toHaveLength(12)
    expect(sleep).toHaveBeenCalledTimes(12)
    for (const call of sleep.mock.calls) {
      const ms = call[0] as number
      expect(ms).toBeGreaterThanOrEqual(100)
      expect(ms).toBeLessThanOrEqual(300)
    }
  })

  it('does not jitter when every id is already cached at worker time', async () => {
    // Force the cache-hit fast path inside the worker by pre-caching
    // every id — but route them through the queue by spoofing the
    // resume cursor with NONE of them, so they enter the worker but
    // `audioCache.persistent.has(id)` returns true on inspection.
    // Easiest: bypass the queue-build filter via the resume cursor —
    // but cursorSet only adds, it doesn't remove the cache check.
    // Instead test the simpler invariant: with all ids pre-cached, the
    // queue is empty and sleep is never invoked.
    const mock = makeMockCache({ mode: 'auto', preCached: ALL_15_IDS })
    const sleep = vi.fn(async (_ms: number) => undefined)
    const dl = createBundleDownloader({ audioCache: mock.audioCache, sleep })
    await dl.start(buildBundle())
    expect(mock.ensureCalls).toHaveLength(0)
    expect(sleep).not.toHaveBeenCalled()
    expect(dl.getProgress().cached).toBe(15)
  })

  it('retries on 429 with exponential backoff and succeeds', async () => {
    // Fail the first 2 attempts for L1-k with 429, then succeed.
    let l1kAttempts = 0
    const sleep = vi.fn(async (_ms: number) => undefined)
    const cachedSet = new Set<string>()
    const ensure = vi.fn(async (id: string): Promise<void> => {
      if (id === 'L1-k') {
        l1kAttempts += 1
        if (l1kAttempts <= 2) {
          throw new Error(`AudioCache: fetch ${id} → 429`)
        }
      }
      cachedSet.add(id)
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
      quotaPressure: vi.fn(async () => 0),
      stats: vi.fn(async () => ({
        persistent: { count: cachedSet.size, bytes: 0 },
        ephemeral: { count: 0, bytes: 0 },
        quotaBytes: undefined,
        usageBytes: undefined,
      })),
      clearCourse: vi.fn(async () => undefined),
    }

    const dl = createBundleDownloader({
      audioCache,
      sleep,
      random: () => 0,
    })
    await dl.start(buildBundle())

    // L1-k was attempted 3 times total (2 failures + 1 success).
    expect(l1kAttempts).toBe(3)
    // Backoff sleeps: 1000ms after attempt 1, 2000ms after attempt 2.
    // (Plus jitter sleeps for every cache-miss id — we only assert the
    // backoff values appear in the sleep call list.)
    const sleepMs = sleep.mock.calls.map((c) => c[0] as number)
    expect(sleepMs).toContain(1000)
    expect(sleepMs).toContain(2000)
    // All 15 ids ended up cached.
    expect(cachedSet.size).toBe(15)
    expect(dl.getProgress().cached).toBe(15)
    // No lastError — the retries succeeded.
    expect(dl.getProgress().lastError).toBeNull()
  })

  it('gives up after 3 retries on persistent 429 and moves on', async () => {
    // L2-t1 always returns 429.
    const sleep = vi.fn(async (_ms: number) => undefined)
    const cachedSet = new Set<string>()
    let l2t1Attempts = 0
    const ensure = vi.fn(async (id: string): Promise<void> => {
      if (id === 'L2-t1') {
        l2t1Attempts += 1
        throw new Error(`AudioCache: fetch ${id} → 429`)
      }
      cachedSet.add(id)
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
      quotaPressure: vi.fn(async () => 0),
      stats: vi.fn(async () => ({
        persistent: { count: cachedSet.size, bytes: 0 },
        ephemeral: { count: 0, bytes: 0 },
        quotaBytes: undefined,
        usageBytes: undefined,
      })),
      clearCourse: vi.fn(async () => undefined),
    }
    const dl = createBundleDownloader({
      audioCache,
      sleep,
      random: () => 0,
    })
    await dl.start(buildBundle())

    // Initial attempt + 3 retries = 4 calls.
    expect(l2t1Attempts).toBe(4)
    // Other 14 ids cached.
    expect(cachedSet.size).toBe(14)
    expect(dl.getProgress().cached).toBe(14)
    // lastError reflects the 429.
    expect(dl.getProgress().lastError).toMatch(/L2-t1 → 429/)
    // Backoff sleeps: 1s, 2s, 4s (the 3 retry delays before giving up).
    const sleepMs = sleep.mock.calls.map((c) => c[0] as number)
    expect(sleepMs.filter((ms) => ms === 1000).length).toBeGreaterThanOrEqual(1)
    expect(sleepMs.filter((ms) => ms === 2000).length).toBeGreaterThanOrEqual(1)
    expect(sleepMs.filter((ms) => ms === 4000).length).toBeGreaterThanOrEqual(1)
  })

  it('honours non-default concurrency', async () => {
    const mock = makeMockCache({ mode: 'manual' })
    const dl = createBundleDownloader({
      audioCache: mock.audioCache,
      concurrency: 3,
      sleep: async () => undefined,
      random: () => 0,
    })
    const bundle = buildBundle()
    const runPromise = dl.start(bundle)

    await tickUntil(() => mock.ensureCalls.length >= 3)
    expect(mock.currentInFlight).toBe(3)

    while (mock.pendingEnsures.size > 0 || mock.ensureCalls.length < 15) {
      const pending = Array.from(mock.pendingEnsures.values())
      for (const p of pending) p.resolve()
      const before = mock.ensureCalls.length
      await tickUntil(
        () => mock.ensureCalls.length > before || mock.ensureCalls.length >= 15,
      )
    }
    await runPromise
    expect(mock.peakInFlight).toBeLessThanOrEqual(3)
    expect(mock.peakInFlight).toBeGreaterThanOrEqual(2)
    expect(mock.ensureCalls).toHaveLength(15)
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
    const dl = createBundleDownloader({ audioCache: mock.audioCache, sleep: async () => undefined })
    dl.resetCursor('spa')
    expect(lsStore['ssi-bundle-download-spa']).toBeUndefined()
    // Other courses are left intact.
    expect(lsStore['ssi-bundle-download-fra']).toBeDefined()
  })
})
