/**
 * useCourseBundle — fetch + cache the one-shot course bundle.
 *
 * Cache-first + background-revalidation. On `load()` we read the cached
 * bundle from IndexedDB; if present and shape-valid, we resolve with it
 * immediately and revalidate against the server in the background. If
 * the server has bumped `version`, we overwrite the cache and update
 * the ref (race-protected against course-code changes).
 *
 * Why IndexedDB and not localStorage:
 *   A single course bundle runs 1–3MB. localStorage caps at ~5MB per
 *   origin in Chrome/Safari (browser-enforced, not configurable),
 *   which couldn't hold more than one course at a time and frequently
 *   blew up with QuotaExceededError. IndexedDB has gigabytes of room
 *   (Chrome lets origins use ~60% of free disk), and the slight async
 *   latency on reads doesn't matter — `load()` is awaited before
 *   playback starts anyway.
 *
 * No singleton. Each invocation owns its own state. The caller keeps
 * the reference for the session.
 *
 * Contract: `packages/player-vue/src/types/courseBundle.ts`
 * Endpoint: GET `${apiBase}/${courseCode}/bundle`
 */

import { ref, type Ref } from 'vue'
import { openDB, deleteDB, type IDBPDatabase } from 'idb'
import type { CourseBundle } from '../types/courseBundle'

// ============================================================================
// PUBLIC TYPES
// ============================================================================

export interface UseCourseBundleOptions {
  /** Override the base URL. Default '/api/courses'. */
  apiBase?: string
  /** Override the IndexedDB name. Default 'ssi-course-bundles-v1'. */
  dbName?: string
}

export interface UseCourseBundle {
  bundle: Ref<CourseBundle | null>
  isReady: Ref<boolean>
  error: Ref<Error | null>
  load(courseCode: string): Promise<CourseBundle>
  cancel(): void
  evictCache(courseCode: string): Promise<void>
}

// ============================================================================
// DEFAULTS
// ============================================================================

const DEFAULT_API_BASE = '/api/courses'
const DEFAULT_DB_NAME = 'ssi-course-bundles-v1'
const STORE_NAME = 'bundles'

interface CacheRow {
  courseCode: string
  bundle: CourseBundle
  cachedAt: number
}

// ============================================================================
// SHAPE VALIDATION
// ============================================================================

/**
 * Minimum validation for a bundle pulled from cache OR network. Keep
 * this in sync with the `CourseBundle` contract — anything missing
 * here is treated as a cache miss / network failure.
 */
function isValidBundle(value: unknown, expectedCode: string): value is CourseBundle {
  if (!value || typeof value !== 'object') return false
  const b = value as Partial<CourseBundle>
  // version may be a semver string ("0.5.1") or an integer — courses
  // table content_version is text on some courses, int on others.
  const versionOk = typeof b.version === 'string' || typeof b.version === 'number'
  return (
    b.courseCode === expectedCode &&
    versionOk &&
    Array.isArray(b.legos) &&
    Array.isArray(b.phrases) &&
    Array.isArray(b.seeds) &&
    Array.isArray(b.roundMap) &&
    Array.isArray(b.pods)
  )
}

// ============================================================================
// COMPOSABLE
// ============================================================================

export function useCourseBundle(options: UseCourseBundleOptions = {}): UseCourseBundle {
  const apiBase = options.apiBase ?? DEFAULT_API_BASE
  const dbName = options.dbName ?? DEFAULT_DB_NAME

  // -----------------------------------------------------------
  // State
  // -----------------------------------------------------------

  const bundle: Ref<CourseBundle | null> = ref(null)
  const isReady = ref(false)
  const error: Ref<Error | null> = ref(null)

  /** AbortController per in-flight fetch — cancel() walks and aborts all. */
  const activeAborts = new Set<AbortController>()

  /** De-dupe concurrent loads for the same course code. */
  const inFlightLoads = new Map<string, Promise<CourseBundle>>()

  // -----------------------------------------------------------
  // IndexedDB — lazy, idempotent init
  // -----------------------------------------------------------

  let dbPromise: Promise<IDBPDatabase> | null = null

  function getDB(): Promise<IDBPDatabase> {
    if (!dbPromise) {
      const open = () => openDB(dbName, 1, {
        upgrade(db) {
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME, { keyPath: 'courseCode' })
          }
        },
      })
      dbPromise = (async () => {
        let db = await open()
        // Self-heal a storeless DB (interrupted upgrade / a ?reset that opened
        // it without recreating stores) → otherwise every transaction throws
        // NotFoundError. Delete and recreate.
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.close()
          await deleteDB(dbName)
          db = await open()
        }
        return db
      })()
    }
    return dbPromise
  }

  // -----------------------------------------------------------
  // Cache I/O (async — IDB)
  // -----------------------------------------------------------

  async function readCache(code: string): Promise<CourseBundle | null> {
    try {
      const db = await getDB()
      const row = (await db.get(STORE_NAME, code)) as CacheRow | undefined
      if (!row) return null
      if (!isValidBundle(row.bundle, code)) {
        // Schema drift between writer and reader (e.g. older session
        // wrote a now-invalid shape). Treat as miss and refetch.
        return null
      }
      return row.bundle
    } catch (err) {
      console.warn('[CourseBundle] Failed to read cache:', (err as any)?.name, '—', (err as any)?.message, err)
      return null
    }
  }

  async function writeCache(code: string, payload: CourseBundle): Promise<void> {
    try {
      const db = await getDB()
      const row: CacheRow = {
        courseCode: code,
        bundle: payload,
        cachedAt: Date.now(),
      }
      await db.put(STORE_NAME, row)
    } catch (err) {
      // IDB writes can fail under extreme quota pressure or in
      // private-browsing modes that disable persistent storage.
      // The bundle still lives in `bundle.value` for this session,
      // we just lose the warm-start benefit next time. Non-fatal.
      console.warn('[CourseBundle] Failed to write cache:', (err as any)?.name, '—', (err as any)?.message, err)
    }
  }

  // -----------------------------------------------------------
  // Abort plumbing
  // -----------------------------------------------------------

  function makeAbort(): AbortController {
    const ctrl = new AbortController()
    activeAborts.add(ctrl)
    return ctrl
  }

  function releaseAbort(ctrl: AbortController): void {
    activeAborts.delete(ctrl)
  }

  // -----------------------------------------------------------
  // Network
  // -----------------------------------------------------------

  async function fetchBundle(code: string): Promise<CourseBundle> {
    const ctrl = makeAbort()
    try {
      const res = await fetch(
        `${apiBase}/${encodeURIComponent(code)}/bundle`,
        { signal: ctrl.signal },
      )
      if (!res.ok) {
        throw new Error(`${res.status} ${res.statusText}`)
      }
      const data: unknown = await res.json()
      if (!isValidBundle(data, code)) {
        throw new Error('Invalid bundle shape returned from server')
      }
      return data
    } finally {
      releaseAbort(ctrl)
    }
  }

  /**
   * Fire-and-forget revalidation. If the server has a newer version,
   * overwrite the cache and (if the live ref still represents the same
   * course) update `bundle.value`. Swallows all errors — offline blips
   * keep the cached copy.
   */
  async function revalidate(code: string, cachedVersion: string | number): Promise<void> {
    try {
      const fresh = await fetchBundle(code)
      // !== rather than > because versions can be semver strings
      // (e.g. "0.5.1") where lexicographic > misorders (e.g. "0.10"
      // < "0.5"). Any difference triggers a refresh.
      if (fresh.version !== cachedVersion) {
        await writeCache(code, fresh)
        // Race-protect: if the caller has since loaded a different
        // course, don't stomp on it.
        if (bundle.value?.courseCode === code) {
          bundle.value = fresh
        }
      }
    } catch {
      // Offline / aborted / version-tie — keep the cached copy.
    }
  }

  // -----------------------------------------------------------
  // Public API
  // -----------------------------------------------------------

  function load(code: string): Promise<CourseBundle> {
    // De-dupe: if a load for this same code is already in flight, ride
    // along. Same code = same result, no need for parallel cache reads
    // or fetches.
    const existing = inFlightLoads.get(code)
    if (existing) return existing

    const promise = (async () => {
      try {
        // Cache-first read. IDB latency is ~1-5ms on a warm DB; the
        // caller is awaiting load() anyway so this is unobservable.
        const cached = await readCache(code)
        if (cached) {
          bundle.value = cached
          isReady.value = true
          error.value = null
          // Background revalidate — never block on it.
          void revalidate(code, cached.version)
          return cached
        }

        // Cold path — wait for network.
        const fresh = await fetchBundle(code)
        // Fire-and-forget the write — the bundle is already usable.
        // No await: even if writeCache is slow (rare), playback
        // shouldn't wait.
        void writeCache(code, fresh)
        bundle.value = fresh
        isReady.value = true
        error.value = null
        return fresh
      } catch (err) {
        const wrapped = err instanceof Error ? err : new Error(String(err))
        error.value = wrapped
        throw wrapped
      } finally {
        inFlightLoads.delete(code)
      }
    })()

    inFlightLoads.set(code, promise)
    return promise
  }

  function cancel(): void {
    for (const ctrl of activeAborts) {
      try {
        ctrl.abort()
      } catch {
        // Some environments throw on abort of an already-aborted
        // controller — fine, we're tearing down.
      }
    }
    activeAborts.clear()
  }

  async function evictCache(code: string): Promise<void> {
    try {
      const db = await getDB()
      await db.delete(STORE_NAME, code)
    } catch (err) {
      console.warn('[CourseBundle] Failed to evict cache:', err)
    }
  }

  return {
    bundle,
    isReady,
    error,
    load,
    cancel,
    evictCache,
  }
}
