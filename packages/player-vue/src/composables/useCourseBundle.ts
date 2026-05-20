/**
 * useCourseBundle — fetch + cache the one-shot course bundle.
 *
 * Mirrors the cache-first + background-revalidation pattern used by
 * `useInstantPlayback` for the round-map: on `load()` we read
 * localStorage first and resolve immediately if a valid cached bundle
 * exists, then revalidate against the server in the background. If the
 * server has bumped `version`, we overwrite the cache and update the
 * ref (race-protected against course-code changes).
 *
 * No singleton. Each invocation owns its own state. The caller keeps
 * the reference for the session.
 *
 * Contract: `packages/player-vue/src/types/courseBundle.ts`
 * Endpoint: GET `${apiBase}/${courseCode}/bundle`
 */

import { ref, type Ref } from 'vue'
import type { CourseBundle } from '../types/courseBundle'

// ============================================================================
// PUBLIC TYPES
// ============================================================================

export interface UseCourseBundleOptions {
  /** Override the base URL. Default '/api/courses'. */
  apiBase?: string
  /** Storage key prefix. Default 'ssi-course-bundle-'. */
  storagePrefix?: string
}

export interface UseCourseBundle {
  bundle: Ref<CourseBundle | null>
  isReady: Ref<boolean>
  error: Ref<Error | null>
  load(courseCode: string): Promise<CourseBundle>
  cancel(): void
  evictCache(courseCode: string): void
}

// ============================================================================
// DEFAULTS
// ============================================================================

const DEFAULT_API_BASE = '/api/courses'
const DEFAULT_STORAGE_PREFIX = 'ssi-course-bundle-'

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
  return (
    b.courseCode === expectedCode &&
    typeof b.version === 'number' &&
    Array.isArray(b.legos) &&
    Array.isArray(b.phrases) &&
    Array.isArray(b.seeds) &&
    Array.isArray(b.roundMap)
  )
}

// ============================================================================
// COMPOSABLE
// ============================================================================

export function useCourseBundle(options: UseCourseBundleOptions = {}): UseCourseBundle {
  const apiBase = options.apiBase ?? DEFAULT_API_BASE
  const storagePrefix = options.storagePrefix ?? DEFAULT_STORAGE_PREFIX

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
  // Cache I/O
  // -----------------------------------------------------------

  function storageKey(code: string): string {
    return storagePrefix + code
  }

  function readCache(code: string): CourseBundle | null {
    try {
      const raw = localStorage.getItem(storageKey(code))
      if (!raw) return null
      const parsed: unknown = JSON.parse(raw)
      if (!isValidBundle(parsed, code)) return null
      return parsed
    } catch (err) {
      console.warn('[CourseBundle] Failed to read cache:', err)
      return null
    }
  }

  function writeCache(code: string, payload: CourseBundle): void {
    try {
      localStorage.setItem(storageKey(code), JSON.stringify(payload))
    } catch (err) {
      // QuotaExceededError or similar — log and continue. The bundle
      // still lives in `bundle.value` for this session; we just lose
      // the warm-start benefit next time.
      console.warn('[CourseBundle] Failed to write cache (quota?):', err)
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
  async function revalidate(code: string, cachedVersion: number): Promise<void> {
    try {
      const fresh = await fetchBundle(code)
      if (fresh.version > cachedVersion) {
        writeCache(code, fresh)
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
    // Cache-first read — synchronous, optimistic.
    const cached = readCache(code)
    if (cached) {
      bundle.value = cached
      isReady.value = true
      error.value = null
      // Background revalidate — never block on it.
      void revalidate(code, cached.version)
      return Promise.resolve(cached)
    }

    // De-dupe: if a network fetch for this same code is already in
    // flight, ride along.
    const existing = inFlightLoads.get(code)
    if (existing) return existing

    // Cold path — must wait for network.
    const promise = (async () => {
      try {
        const fresh = await fetchBundle(code)
        writeCache(code, fresh)
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

  function evictCache(code: string): void {
    try {
      localStorage.removeItem(storageKey(code))
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
