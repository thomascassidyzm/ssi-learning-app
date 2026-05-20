/**
 * Tests for useCourseBundle — cache-first + background revalidation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useCourseBundle } from './useCourseBundle'
import type { CourseBundle } from '../types/courseBundle'

// ----------------------------------------------------------------------------
// Test fixtures
// ----------------------------------------------------------------------------

const COURSE_CODE = 'spa_for_eng_v2'
const STORAGE_PREFIX = 'ssi-course-bundle-'

function makeBundle(version: number, courseCode: string = COURSE_CODE): CourseBundle {
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
// localStorage shim — happy-dom provides one, but we explicitly stub it so
// quota-exceeded behaviour is testable and tests are deterministic.
// ----------------------------------------------------------------------------

interface LocalStorageShim extends Storage {
  __setQuotaExceeded(value: boolean): void
}

function makeLocalStorageShim(): LocalStorageShim {
  const store = new Map<string, string>()
  let quotaExceeded = false
  return {
    get length() {
      return store.size
    },
    clear() {
      store.clear()
    },
    getItem(key: string) {
      return store.get(key) ?? null
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null
    },
    removeItem(key: string) {
      store.delete(key)
    },
    setItem(key: string, value: string) {
      if (quotaExceeded) {
        const err = new Error('QuotaExceededError')
        err.name = 'QuotaExceededError'
        throw err
      }
      store.set(key, value)
    },
    __setQuotaExceeded(value: boolean) {
      quotaExceeded = value
    },
  } as LocalStorageShim
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

let storage: LocalStorageShim

beforeEach(() => {
  storage = makeLocalStorageShim()
  vi.stubGlobal('localStorage', storage)
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

    const { load, bundle, isReady } = useCourseBundle()

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
    // Persisted to cache for next session.
    expect(storage.getItem(STORAGE_PREFIX + COURSE_CODE)).not.toBeNull()
  })

  it('warm cache: load() resolves immediately before fetch completes', async () => {
    const cached = makeBundle(1)
    storage.setItem(STORAGE_PREFIX + COURSE_CODE, JSON.stringify(cached))

    // Build a fetch that hangs forever — proves load() resolved without
    // awaiting the network.
    const deferred = defer<Response>()
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockReturnValue(deferred.promise)

    const { load, bundle, isReady } = useCourseBundle()
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
    storage.setItem(STORAGE_PREFIX + COURSE_CODE, JSON.stringify(cached))

    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify(fresh), { status: 200 }),
    )

    const { load, bundle } = useCourseBundle()
    await load(COURSE_CODE)
    expect(bundle.value).toEqual(cached) // optimistic

    // Let the background revalidate run to completion.
    await flushMicrotasks(20)

    expect(bundle.value).toEqual(fresh)
    expect(JSON.parse(storage.getItem(STORAGE_PREFIX + COURSE_CODE)!)).toEqual(fresh)
  })

  it('revalidation: same version → bundle.value unchanged', async () => {
    const cached = makeBundle(1)
    storage.setItem(STORAGE_PREFIX + COURSE_CODE, JSON.stringify(cached))

    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify(makeBundle(1)), { status: 200 }),
    )

    const { load, bundle } = useCourseBundle()
    await load(COURSE_CODE)
    const before = bundle.value
    await flushMicrotasks(20)

    expect(bundle.value).toBe(before) // identity unchanged
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

    const { load, cancel } = useCourseBundle()
    const pending = load(COURSE_CODE)

    // Don't throw on cancel itself.
    expect(() => cancel()).not.toThrow()

    // The pending load will reject — catch it so the test runner
    // doesn't see an unhandled rejection.
    await expect(pending).rejects.toBeDefined()
  })

  it('evictCache(): removes the cached bundle, leaves bundle.value alone', async () => {
    const cached = makeBundle(1)
    storage.setItem(STORAGE_PREFIX + COURSE_CODE, JSON.stringify(cached))

    // Make the background revalidate hang so it can't repopulate.
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockReturnValue(defer<Response>().promise)

    const { load, bundle, evictCache } = useCourseBundle()
    await load(COURSE_CODE)

    expect(storage.getItem(STORAGE_PREFIX + COURSE_CODE)).not.toBeNull()
    const liveBefore = bundle.value

    evictCache(COURSE_CODE)

    expect(storage.getItem(STORAGE_PREFIX + COURSE_CODE)).toBeNull()
    expect(bundle.value).toBe(liveBefore) // ref untouched
  })

  it('quota exceeded on write does not throw; bundle.value still populated', async () => {
    storage.__setQuotaExceeded(true)
    const fixture = makeBundle(1)
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify(fixture), { status: 200 }),
    )

    const { load, bundle, isReady } = useCourseBundle()
    const result = await load(COURSE_CODE)

    expect(result).toEqual(fixture)
    expect(bundle.value).toEqual(fixture)
    expect(isReady.value).toBe(true)
    // Cache write was rejected — storage stays empty.
    expect(storage.getItem(STORAGE_PREFIX + COURSE_CODE)).toBeNull()
  })

  it('corrupted cache: invalid JSON treated as cache miss', async () => {
    storage.setItem(STORAGE_PREFIX + COURSE_CODE, '{not valid json')
    const fixture = makeBundle(1)
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify(fixture), { status: 200 }),
    )

    const { load, bundle } = useCourseBundle()
    await load(COURSE_CODE)

    expect(bundle.value).toEqual(fixture)
    expect(globalThis.fetch).toHaveBeenCalledTimes(1) // had to fetch
  })

  it('corrupted cache: wrong shape treated as cache miss', async () => {
    storage.setItem(
      STORAGE_PREFIX + COURSE_CODE,
      JSON.stringify({ courseCode: COURSE_CODE, legos: 'not-an-array' }),
    )
    const fixture = makeBundle(1)
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify(fixture), { status: 200 }),
    )

    const { load, bundle } = useCourseBundle()
    await load(COURSE_CODE)

    expect(bundle.value).toEqual(fixture)
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
  })

  it('corrupted cache: missing version treated as cache miss', async () => {
    storage.setItem(
      STORAGE_PREFIX + COURSE_CODE,
      JSON.stringify({
        courseCode: COURSE_CODE,
        // version: missing
        mainLoopCount: 0,
        legos: [],
        phrases: [],
        seeds: [],
        roundMap: [],
      }),
    )
    const fixture = makeBundle(1)
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify(fixture), { status: 200 }),
    )

    const { load, bundle } = useCourseBundle()
    await load(COURSE_CODE)

    expect(bundle.value).toEqual(fixture)
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
  })

  it('concurrent loads for same code: single network fetch', async () => {
    const fixture = makeBundle(1)
    const deferred = defer<Response>()
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockReturnValue(deferred.promise)

    const { load } = useCourseBundle()
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
