/**
 * Tests for useCourseBundle — cache-first + background revalidation.
 *
 * Cache lives in IndexedDB (was localStorage; swapped because a single
 * bundle is 1–3MB and localStorage caps at ~5MB per origin). Tests use
 * `fake-indexeddb/auto` to give vitest a real IDB implementation, and
 * each test gets its own DB name to avoid cross-test pollution without
 * needing per-test deletion.
 */

import 'fake-indexeddb/auto'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { openDB } from 'idb'
import { useCourseBundle } from './useCourseBundle'
import type { CourseBundle } from '../types/courseBundle'

// ----------------------------------------------------------------------------
// Test fixtures
// ----------------------------------------------------------------------------

const COURSE_CODE = 'spa_for_eng_v2'

function makeBundle(version: number | string, courseCode: string = COURSE_CODE): CourseBundle {
  return {
    courseCode,
    version,
    mainLoopCount: 0,
    legos: [],
    phrases: [],
    seeds: [],
    roundMap: [],
  }
}

// ----------------------------------------------------------------------------
// Per-test DB isolation. Each spec gets a fresh DB name so we don't have to
// drop and recreate between specs, which is racey under fake-indexeddb when
// connections from prior tests haven't closed yet.
// ----------------------------------------------------------------------------

let dbCounter = 0
let currentDbName: string

function freshDbName(): string {
  dbCounter += 1
  return `ssi-course-bundles-test-${dbCounter}`
}

// Seed the cache directly via idb so tests can simulate "warm cache" and
// "corrupted cache" states without going through useCourseBundle itself.
async function seedCache(dbName: string, value: unknown): Promise<void> {
  const db = await openDB(dbName, 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('bundles')) {
        db.createObjectStore('bundles', { keyPath: 'courseCode' })
      }
    },
  })
  await db.put('bundles', {
    courseCode: (value as { courseCode?: string })?.courseCode ?? COURSE_CODE,
    bundle: value,
    cachedAt: Date.now(),
  })
  db.close()
}

async function readCacheRaw(dbName: string, code: string): Promise<unknown> {
  const db = await openDB(dbName, 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('bundles')) {
        db.createObjectStore('bundles', { keyPath: 'courseCode' })
      }
    },
  })
  const row = await db.get('bundles', code)
  db.close()
  return row
}

// ----------------------------------------------------------------------------
// Async helpers
// ----------------------------------------------------------------------------

/** Yield to the microtask queue. Multiple flushes drain chains of awaits. */
async function flushMicrotasks(rounds = 5): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await Promise.resolve()
  }
}

/**
 * Drain both microtasks and the macrotask queue. fake-indexeddb resolves
 * via setTimeout(0), so pure microtask flushes don't advance it.
 */
async function flushAll(rounds = 3): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await new Promise((r) => setTimeout(r, 0))
  }
}

/**
 * Build a deferred Promise we can resolve on demand — used to test
 * "cache hit resolves before network completes" ordering.
 */
function defer<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

// ----------------------------------------------------------------------------
// Per-test setup
// ----------------------------------------------------------------------------

beforeEach(() => {
  currentDbName = freshDbName()
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

// ----------------------------------------------------------------------------
// Tests
// ----------------------------------------------------------------------------

describe('useCourseBundle', () => {
  it('empty cache: load() hits network and populates bundle.value', async () => {
    const fixture = makeBundle(1)
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify(fixture), { status: 200 }),
    )

    const { load, bundle, isReady } = useCourseBundle({ dbName: currentDbName })

    expect(bundle.value).toBeNull()
    expect(isReady.value).toBe(false)

    const result = await load(COURSE_CODE)

    expect(result).toEqual(fixture)
    expect(bundle.value).toEqual(fixture)
    expect(isReady.value).toBe(true)
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    expect(globalThis.fetch).toHaveBeenCalledWith(
      `/api/courses/${COURSE_CODE}/bundle`,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )

    // Bundle write is fire-and-forget; drain to let IDB finish.
    await flushAll()
    const row = (await readCacheRaw(currentDbName, COURSE_CODE)) as
      | { bundle: CourseBundle }
      | undefined
    expect(row?.bundle).toEqual(fixture)
  })

  it('warm cache: load() resolves with cached bundle before network completes', async () => {
    const cached = makeBundle(1)
    await seedCache(currentDbName, cached)

    // Build a fetch that hangs forever — proves load() resolved from
    // the cache, not from the network.
    const deferred = defer<Response>()
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockReturnValue(deferred.promise)

    const { load, bundle, isReady } = useCourseBundle({ dbName: currentDbName })
    const result = await load(COURSE_CODE)

    expect(result).toEqual(cached)
    expect(bundle.value).toEqual(cached)
    expect(isReady.value).toBe(true)

    // Drain — revalidation fired but never resolved. That's fine.
    deferred.resolve(new Response(JSON.stringify(cached), { status: 200 }))
    await flushMicrotasks()
  })

  it('revalidation: server bumps version → bundle.value updates', async () => {
    const cached = makeBundle(1)
    const fresh = makeBundle(2)
    await seedCache(currentDbName, cached)

    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify(fresh), { status: 200 }),
    )

    const { load, bundle } = useCourseBundle({ dbName: currentDbName })
    await load(COURSE_CODE)
    expect(bundle.value).toEqual(cached) // optimistic

    // Wait for the background revalidate's IDB write + ref update.
    await vi.waitFor(() => {
      expect(bundle.value).toEqual(fresh)
    })
    const row = (await readCacheRaw(currentDbName, COURSE_CODE)) as
      | { bundle: CourseBundle }
      | undefined
    expect(row?.bundle).toEqual(fresh)
  })

  it('revalidation: same version → bundle.value unchanged', async () => {
    const cached = makeBundle(1)
    await seedCache(currentDbName, cached)

    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify(makeBundle(1)), { status: 200 }),
    )

    const { load, bundle } = useCourseBundle({ dbName: currentDbName })
    await load(COURSE_CODE)
    const before = bundle.value
    // Give the revalidate ample time to run (and confirm it's a no-op).
    await flushAll(5)

    expect(bundle.value).toBe(before) // identity unchanged
  })

  it('semver version strings: any change refreshes (no lexicographic > trap)', async () => {
    // "0.10.0" > "0.5.1" semantically, but lexicographic "0.10" < "0.5"
    // would lose. The composable uses !== so this is fine in both
    // directions.
    const cached = makeBundle('0.5.1')
    const fresh = makeBundle('0.10.0')
    await seedCache(currentDbName, cached)

    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify(fresh), { status: 200 }),
    )

    const { load, bundle } = useCourseBundle({ dbName: currentDbName })
    await load(COURSE_CODE)
    await vi.waitFor(() => {
      expect(bundle.value).toEqual(fresh)
    })
  })

  it('cancel(): aborts in-flight fetches without throwing', async () => {
    // Fetch that respects the abort signal.
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            const err = new Error('aborted')
            err.name = 'AbortError'
            reject(err)
          })
        }),
    )

    const { load, cancel } = useCourseBundle({ dbName: currentDbName })
    const pending = load(COURSE_CODE)
    // Catch the eventual rejection right away so the rejection itself
    // doesn't race the assertion.
    const settled = pending.catch((e) => e)

    // Give the cache read (IDB, macrotask-based via fake-indexeddb) a
    // chance to resolve to null, then let the fetch register its abort
    // listener.
    await flushAll(3)

    // Don't throw on cancel itself.
    expect(() => cancel()).not.toThrow()

    const err = await settled
    expect(err).toBeDefined()
  })

  it('evictCache(): removes the cached bundle, leaves bundle.value alone', async () => {
    const cached = makeBundle(1)
    await seedCache(currentDbName, cached)

    // Make the background revalidate hang so it can't repopulate.
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockReturnValue(defer<Response>().promise)

    const { load, bundle, evictCache } = useCourseBundle({ dbName: currentDbName })
    await load(COURSE_CODE)

    const beforeRow = await readCacheRaw(currentDbName, COURSE_CODE)
    expect(beforeRow).toBeDefined()
    const liveBefore = bundle.value

    await evictCache(COURSE_CODE)

    const afterRow = await readCacheRaw(currentDbName, COURSE_CODE)
    expect(afterRow).toBeUndefined()
    expect(bundle.value).toBe(liveBefore) // ref untouched
  })

  it('corrupted cache: wrong shape treated as cache miss', async () => {
    await seedCache(currentDbName, { courseCode: COURSE_CODE, legos: 'not-an-array' })
    const fixture = makeBundle(1)
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify(fixture), { status: 200 }),
    )

    const { load, bundle } = useCourseBundle({ dbName: currentDbName })
    await load(COURSE_CODE)

    expect(bundle.value).toEqual(fixture)
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
  })

  it('corrupted cache: missing version treated as cache miss', async () => {
    await seedCache(currentDbName, {
      courseCode: COURSE_CODE,
      // version: missing
      mainLoopCount: 0,
      legos: [],
      phrases: [],
      seeds: [],
      roundMap: [],
    })
    const fixture = makeBundle(1)
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify(fixture), { status: 200 }),
    )

    const { load, bundle } = useCourseBundle({ dbName: currentDbName })
    await load(COURSE_CODE)

    expect(bundle.value).toEqual(fixture)
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
  })

  it('concurrent loads for same code: single network fetch', async () => {
    const fixture = makeBundle(1)
    const deferred = defer<Response>()
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockReturnValue(deferred.promise)

    const { load } = useCourseBundle({ dbName: currentDbName })
    const p1 = load(COURSE_CODE)
    const p2 = load(COURSE_CODE)

    // Both should resolve to the same bundle, with only one fetch.
    deferred.resolve(new Response(JSON.stringify(fixture), { status: 200 }))
    const [r1, r2] = await Promise.all([p1, p2])

    expect(r1).toEqual(fixture)
    expect(r2).toEqual(fixture)
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
  })
})
