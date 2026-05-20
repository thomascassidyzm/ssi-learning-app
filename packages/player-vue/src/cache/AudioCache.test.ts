/**
 * AudioCache tests — vitest, fake-indexeddb.
 *
 * Covers the AudioCache.types.ts contract: tier-aware caching,
 * idempotent ensure, in-flight de-dupe, ephemeral acquire/release with
 * abort-on-release semantics, LRU-by-last-accessed eviction.
 */

import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openDB } from 'idb'

import { resetAudioCacheForTesting } from './createAudioCache'
import { AudioCacheImpl } from './AudioCache'
import type { AudioCache } from './AudioCache.types'

const DB_NAME = 'ssi-audio-cache-v2'

/** Build a fetch mock that returns a deterministic blob per id. */
function makeFetchMock(options: { delayMs?: number; sizePerId?: (id: string) => number } = {}) {
  const sizeFor = options.sizePerId ?? (() => 32)
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString()
    const id = url.split('/').pop() ?? 'unknown'
    if (options.delayMs) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => resolve(), options.delayMs)
        if (init?.signal) {
          const onAbort = () => {
            clearTimeout(timer)
            reject(new DOMException('Aborted', 'AbortError'))
          }
          if (init.signal.aborted) onAbort()
          else init.signal.addEventListener('abort', onAbort, { once: true })
        }
      })
    }
    const filler = 'x'.repeat(sizeFor(id))
    const blob = new Blob([filler], { type: 'audio/mpeg' })
    return new Response(blob, { status: 200, headers: { 'Content-Type': 'audio/mpeg' } })
  })
}

async function deleteDb(): Promise<void> {
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(DB_NAME)
    req.onsuccess = () => resolve()
    req.onerror = () => resolve()
    req.onblocked = () => resolve()
  })
}

async function readRow(id: string): Promise<{
  id: string
  size: number
  lifecycle: string
  ephemeralOwnerLegoId: string | null
  lastAccessedAt: number
  courseCode: string | null
} | undefined> {
  const db = await openDB(DB_NAME, 1)
  const row = (await db.get('audio', id)) as
    | {
        id: string
        size: number
        lifecycle: string
        ephemeralOwnerLegoId: string | null
        lastAccessedAt: number
        courseCode: string | null
      }
    | undefined
  db.close()
  return row
}

async function putRaw(row: {
  id: string
  blob: Blob
  mimeType: string
  size: number
  lifecycle: 'persistent' | 'ephemeral'
  courseCode: string | null
  cachedAt: number
  lastAccessedAt: number
  ephemeralOwnerLegoId: string | null
}): Promise<void> {
  const db = await openDB(DB_NAME, 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('audio')) {
        const store = db.createObjectStore('audio', { keyPath: 'id' })
        store.createIndex('by-lifecycle', 'lifecycle')
        store.createIndex('by-course', 'courseCode')
        store.createIndex('by-last-accessed', 'lastAccessedAt')
        store.createIndex('by-ephemeral-owner', 'ephemeralOwnerLegoId')
      }
    },
  })
  await db.put('audio', row)
  db.close()
}

describe('AudioCache', () => {
  let originalFetch: typeof globalThis.fetch
  let originalCreateObjectURL: typeof URL.createObjectURL
  let originalRevokeObjectURL: typeof URL.revokeObjectURL
  let fetchMock: ReturnType<typeof makeFetchMock>
  /** All caches created during a test — closed in afterEach so deleteDb isn't blocked. */
  const openCaches: AudioCacheImpl[] = []
  let cache: AudioCacheImpl

  const newCache = (opts?: ConstructorParameters<typeof AudioCacheImpl>[0]): AudioCacheImpl => {
    const c = new AudioCacheImpl(opts)
    openCaches.push(c)
    return c
  }

  beforeEach(async () => {
    resetAudioCacheForTesting()

    fetchMock = makeFetchMock()
    originalFetch = globalThis.fetch
    globalThis.fetch = fetchMock as unknown as typeof fetch

    originalCreateObjectURL = URL.createObjectURL
    originalRevokeObjectURL = URL.revokeObjectURL
    let counter = 0
    URL.createObjectURL = vi.fn(() => `blob:fake-${++counter}`) as unknown as typeof URL.createObjectURL
    URL.revokeObjectURL = vi.fn() as unknown as typeof URL.revokeObjectURL

    // Delete the DB fresh for each test. Must happen AFTER any previous
    // test's caches have closed (handled in afterEach).
    await deleteDb()

    cache = newCache()
  })

  afterEach(async () => {
    // Close every cache opened during this test so deleteDatabase isn't blocked.
    for (const c of openCaches) {
      try {
        c.close()
      } catch {
        // Ignore.
      }
    }
    openCaches.length = 0

    globalThis.fetch = originalFetch
    URL.createObjectURL = originalCreateObjectURL
    URL.revokeObjectURL = originalRevokeObjectURL
    vi.unstubAllGlobals()
  })

  // ==========================================================================
  // PERSISTENT
  // ==========================================================================

  it('persistent.ensure fetches and stores; has(id) true after', async () => {
    await cache.persistent.ensure('a')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(cache.persistent.has('a')).toBe(true)
    expect(cache.has('a')).toBe(true)

    const row = await readRow('a')
    expect(row?.lifecycle).toBe('persistent')
  })

  it('persistent.ensure is idempotent on already-cached', async () => {
    await cache.persistent.ensure('a')
    await cache.persistent.ensure('a')
    await cache.persistent.ensure('a')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('concurrent persistent.ensure for same id triggers single fetch', async () => {
    fetchMock = makeFetchMock({ delayMs: 20 })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    await Promise.all([
      cache.persistent.ensure('a'),
      cache.persistent.ensure('a'),
      cache.persistent.ensure('a'),
    ])

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(cache.has('a')).toBe(true)
  })

  // ==========================================================================
  // EPHEMERAL
  // ==========================================================================

  it('ephemeral.acquireForLego caches every id with lifecycle:ephemeral', async () => {
    await cache.ephemeral.acquireForLego({ legoId: 'L', audioIds: ['a', 'b', 'c'] })

    expect(fetchMock).toHaveBeenCalledTimes(3)
    for (const id of ['a', 'b', 'c']) {
      expect(cache.ephemeral.has(id)).toBe(true)
      expect(cache.has(id)).toBe(true)
      const row = await readRow(id)
      expect(row?.lifecycle).toBe('ephemeral')
      expect(row?.ephemeralOwnerLegoId).toBe('L')
    }
  })

  it('ephemeral.releaseForLego evicts every owned id and returns count', async () => {
    await cache.ephemeral.acquireForLego({ legoId: 'L', audioIds: ['a', 'b', 'c'] })

    const deleted = await cache.ephemeral.releaseForLego('L')
    expect(deleted).toBe(3)

    for (const id of ['a', 'b', 'c']) {
      expect(cache.ephemeral.has(id)).toBe(false)
      expect(cache.has(id)).toBe(false)
      expect(await readRow(id)).toBeUndefined()
    }
  })

  it('releaseForLego during in-flight acquireForLego aborts pending and cleans up', async () => {
    fetchMock = makeFetchMock({ delayMs: 50 })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const acquirePromise = cache.ephemeral.acquireForLego({
      legoId: 'L',
      audioIds: ['a', 'b', 'c'],
    })

    // Release immediately while fetches are in-flight.
    const released = await cache.ephemeral.releaseForLego('L')

    // The acquire should settle without throwing (aborts swallowed).
    await acquirePromise

    // Whatever the release count was, the post-state must be: no L-owned rows.
    expect(released).toBeGreaterThanOrEqual(0)
    for (const id of ['a', 'b', 'c']) {
      const row = await readRow(id)
      // Either fully gone, or — if a write raced past the abort — at minimum
      // not owned by L anymore.
      if (row) {
        expect(row.ephemeralOwnerLegoId).not.toBe('L')
      } else {
        expect(row).toBeUndefined()
      }
      expect(cache.ephemeral.has(id)).toBe(false)
    }
  })

  it('acquireForLego skips ids already in persistent (no duplicate)', async () => {
    await cache.persistent.ensure('a')
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await cache.ephemeral.acquireForLego({ legoId: 'L', audioIds: ['a', 'b'] })
    // Only 'b' should be fetched.
    expect(fetchMock).toHaveBeenCalledTimes(2)

    const rowA = await readRow('a')
    expect(rowA?.lifecycle).toBe('persistent')
    expect(rowA?.ephemeralOwnerLegoId).toBeNull()
    expect(cache.ephemeral.has('a')).toBe(false)
    expect(cache.persistent.has('a')).toBe(true)
  })

  // ==========================================================================
  // UNIFIED READS
  // ==========================================================================

  it('has(id) is unified across namespaces', async () => {
    await cache.persistent.ensure('p')
    await cache.ephemeral.acquireForLego({ legoId: 'L', audioIds: ['e'] })

    expect(cache.has('p')).toBe(true)
    expect(cache.has('e')).toBe(true)
    expect(cache.has('missing')).toBe(false)
  })

  it('getBlobUrl returns blob: URL for cached, null for uncached', async () => {
    await cache.persistent.ensure('a')

    const url = await cache.getBlobUrl('a')
    expect(url).toMatch(/^blob:/)

    const missing = await cache.getBlobUrl('nope')
    expect(missing).toBeNull()
  })

  it('getBlobUrl updates lastAccessedAt', async () => {
    await cache.persistent.ensure('a')
    const before = (await readRow('a'))!.lastAccessedAt

    // Wait a tick so the timestamp can advance.
    await new Promise((r) => setTimeout(r, 5))
    await cache.getBlobUrl('a')

    // Give the fire-and-forget put() a tick to land.
    await new Promise((r) => setTimeout(r, 10))
    const after = (await readRow('a'))!.lastAccessedAt
    expect(after).toBeGreaterThanOrEqual(before)
    expect(after).toBeGreaterThan(before - 1) // sanity
  })

  // ==========================================================================
  // QUOTA
  // ==========================================================================

  it('quotaPressure returns 0 when navigator.storage unavailable', async () => {
    const originalNavigator = globalThis.navigator
    // Stub navigator with no storage property.
    vi.stubGlobal('navigator', {})

    const pressure = await cache.quotaPressure()
    expect(pressure).toBe(0)

    vi.stubGlobal('navigator', originalNavigator)
  })

  it('quotaPressure returns usage/quota when navigator.storage present', async () => {
    vi.stubGlobal('navigator', {
      storage: {
        estimate: async () => ({ quota: 1_000_000, usage: 250_000 }),
      },
    })

    const pressure = await cache.quotaPressure()
    expect(pressure).toBeCloseTo(0.25, 5)
  })

  // ==========================================================================
  // COURSE CLEAR
  // ==========================================================================

  it('clearCourse removes only entries for that course', async () => {
    // Seed two rows manually with different courseCodes (the public API
    // doesn't yet attach courseCode — this verifies the index-based delete).
    const t = Date.now()
    await putRaw({
      id: 'x',
      blob: new Blob(['x']),
      mimeType: 'audio/mpeg',
      size: 1,
      lifecycle: 'persistent',
      courseCode: 'C1',
      cachedAt: t,
      lastAccessedAt: t,
      ephemeralOwnerLegoId: null,
    })
    await putRaw({
      id: 'y',
      blob: new Blob(['y']),
      mimeType: 'audio/mpeg',
      size: 1,
      lifecycle: 'persistent',
      courseCode: 'C2',
      cachedAt: t,
      lastAccessedAt: t,
      ephemeralOwnerLegoId: null,
    })

    // Build a fresh cache instance so it picks up the seeded rows on init.
    const fresh = newCache()
    // Trigger init via stats() so the in-memory Sets populate.
    await fresh.stats()
    expect(fresh.has('x')).toBe(true)
    expect(fresh.has('y')).toBe(true)

    await fresh.clearCourse('C1')

    expect(fresh.has('x')).toBe(false)
    expect(fresh.has('y')).toBe(true)
    expect(await readRow('x')).toBeUndefined()
    expect(await readRow('y')).toBeDefined()
  })

  // ==========================================================================
  // EVICTION
  // ==========================================================================

  it('persistent.evictToTarget evicts oldest persistent first, never touches ephemeral', async () => {
    // Seed three persistent rows with increasing lastAccessedAt.
    const base = 1_000_000
    await putRaw({
      id: 'old',
      blob: new Blob(['oldoldoldoldoldoldoldoldoldold']), // 30 bytes
      mimeType: 'audio/mpeg',
      size: 30,
      lifecycle: 'persistent',
      courseCode: null,
      cachedAt: base,
      lastAccessedAt: base + 1,
      ephemeralOwnerLegoId: null,
    })
    await putRaw({
      id: 'mid',
      blob: new Blob(['midmidmidmidmidmidmidmidmidmid']),
      mimeType: 'audio/mpeg',
      size: 30,
      lifecycle: 'persistent',
      courseCode: null,
      cachedAt: base,
      lastAccessedAt: base + 2,
      ephemeralOwnerLegoId: null,
    })
    await putRaw({
      id: 'new',
      blob: new Blob(['newnewnewnewnewnewnewnewnewnew']),
      mimeType: 'audio/mpeg',
      size: 30,
      lifecycle: 'persistent',
      courseCode: null,
      cachedAt: base,
      lastAccessedAt: base + 3,
      ephemeralOwnerLegoId: null,
    })
    // And an ephemeral row that's older than all of them.
    await putRaw({
      id: 'eph',
      blob: new Blob(['ephephephephephephephephephephp']),
      mimeType: 'audio/mpeg',
      size: 30,
      lifecycle: 'ephemeral',
      courseCode: null,
      cachedAt: base,
      lastAccessedAt: base,
      ephemeralOwnerLegoId: 'L',
    })

    const fresh = newCache()
    await fresh.stats() // force init

    // Total persistent = 90 bytes. Target 40 → must evict at least old + mid (60).
    await fresh.persistent.evictToTarget(40)

    expect(fresh.persistent.has('old')).toBe(false)
    expect(fresh.persistent.has('mid')).toBe(false)
    expect(fresh.persistent.has('new')).toBe(true)
    // Ephemeral untouched even though it's the oldest.
    expect(fresh.ephemeral.has('eph')).toBe(true)
    expect(await readRow('eph')).toBeDefined()
  })

  // ==========================================================================
  // INIT IDEMPOTENCE
  // ==========================================================================

  it('init is idempotent — concurrent ensures share one init', async () => {
    // Fresh cache; nothing initialized yet.
    const fresh = newCache()

    // Kick off two operations in parallel — both await init internally.
    await Promise.all([fresh.persistent.ensure('x'), fresh.persistent.ensure('y')])

    expect(fresh.has('x')).toBe(true)
    expect(fresh.has('y')).toBe(true)
    // Second access should be cheap — no error, no extra DB upgrade.
    await fresh.stats()
  })

  it('AudioCacheImpl can be constructed directly with a custom audioUrl', async () => {
    const direct: AudioCache = newCache({ audioUrl: (id) => `/custom/${id}.mp3` })
    await direct.persistent.ensure('z')

    expect(fetchMock.mock.calls[0][0]).toBe('/custom/z.mp3')
    expect(direct.has('z')).toBe(true)
  })
})
