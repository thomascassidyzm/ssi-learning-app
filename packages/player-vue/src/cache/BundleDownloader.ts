/**
 * BundleDownloader — background loop that fully caches a course's
 * `lifecycle: 'persistent'` audio.
 *
 * Why this exists: in the new cache-based architecture, the learner
 * should never run out of cached content. While they're playing the
 * intro round of LEGO N, this loop downloads the USE-phrase audio for
 * every LEGO in the course so spaced rep / INF PLAY never has to fetch
 * over the wire. By the time the learner reaches steady state every
 * persistent audio is local.
 *
 * The actual download/de-dup work is delegated to `AudioCache.persistent`
 * — this file just walks the bundle in priority order and feeds ids in.
 *
 * Resumability: the cursor (audio ids cached so far) is persisted to
 * localStorage so a learner who quits mid-download resumes where they
 * left off. The cursor is keyed by course code and invalidated on
 * bundle version bump.
 *
 * Pressure-aware: before each batch the loop consults
 * `audioCache.quotaPressure()` and halts if it crosses a ceiling. The
 * caller (composable layer) can re-`start()` later — e.g. if the user
 * frees up storage or we evict ephemeral audio.
 */

import type { CourseBundle, BundleAudioRef, BundlePhrase } from '../types/courseBundle'
import type { AudioCache } from './AudioCache.types'

// ============================================================================
// PUBLIC TYPES
// ============================================================================

export interface BundleDownloaderOptions {
  /** Cache to write into. Required. */
  audioCache: AudioCache
  /**
   * Max concurrent fetches. Default 4. The cache de-dupes in-flight
   * fetches for the same id, so this controls cache concurrency, not
   * total network parallelism.
   */
  concurrency?: number
  /**
   * Pressure threshold at which the downloader stops. Default 0.85.
   * Read via audioCache.quotaPressure(). Re-checked between batches.
   */
  quotaPressureCeiling?: number
  /**
   * localStorage key prefix for the resume cursor. Default
   * 'ssi-bundle-download-'.
   */
  storagePrefix?: string
}

export interface BundleDownloaderProgress {
  /** Cached so far across this course (this session + prior). */
  cached: number
  /** Total persistent audio refs in the bundle. */
  total: number
  /** True while a fetch loop is running. */
  isRunning: boolean
  /** True if quota pressure stopped the loop. */
  haltedForQuota: boolean
  /** Last error message if any. */
  lastError: string | null
}

export interface BundleDownloader {
  /** Start downloading for this bundle. Idempotent — safe to call repeatedly. */
  start(bundle: CourseBundle): Promise<void>
  /** Stop the loop (after current batch resolves). Resume picks up from cursor. */
  stop(): void
  /** Drop the resume cursor for a course (e.g. version bumped). */
  resetCursor(courseCode: string): void
  /** Reactive-ish progress snapshot. Returns the latest values. */
  getProgress(): BundleDownloaderProgress
  /** Subscribe to progress updates — called after each batch completes. */
  onProgress(handler: (p: BundleDownloaderProgress) => void): () => void
}

// ============================================================================
// INTERNAL TYPES
// ============================================================================

interface CursorPayload {
  // Matches CourseBundle.version — see courseBundle.ts. Stored
  // round-trip via JSON.stringify so any JSON-safe value works.
  version: string | number
  cachedIds: string[]
}

const DEFAULT_CONCURRENCY = 4
const DEFAULT_QUOTA_PRESSURE_CEILING = 0.85
const DEFAULT_STORAGE_PREFIX = 'ssi-bundle-download-'
const CURSOR_PERSIST_EVERY = 10

// ============================================================================
// FACTORY
// ============================================================================

export function createBundleDownloader(options: BundleDownloaderOptions): BundleDownloader {
  const audioCache = options.audioCache
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY
  const ceiling = options.quotaPressureCeiling ?? DEFAULT_QUOTA_PRESSURE_CEILING
  const storagePrefix = options.storagePrefix ?? DEFAULT_STORAGE_PREFIX

  // Mutable state — singleton per downloader instance.
  let activeCourseCode: string | null = null
  let activeRun: Promise<void> | null = null
  let stopRequested = false
  let progress: BundleDownloaderProgress = {
    cached: 0,
    total: 0,
    isRunning: false,
    haltedForQuota: false,
    lastError: null,
  }
  const handlers = new Set<(p: BundleDownloaderProgress) => void>()

  // -----------------------------------------------------------------------
  // Cursor helpers
  // -----------------------------------------------------------------------

  function cursorKey(courseCode: string): string {
    return `${storagePrefix}${courseCode}`
  }

  function readCursor(courseCode: string): CursorPayload | null {
    try {
      const raw = globalThis.localStorage?.getItem(cursorKey(courseCode))
      if (!raw) return null
      const parsed = JSON.parse(raw) as CursorPayload
      if (typeof parsed?.version !== 'number' || !Array.isArray(parsed?.cachedIds)) return null
      return parsed
    } catch {
      return null
    }
  }

  function writeCursor(courseCode: string, payload: CursorPayload): void {
    try {
      globalThis.localStorage?.setItem(cursorKey(courseCode), JSON.stringify(payload))
    } catch {
      // localStorage may be full or unavailable — non-fatal.
    }
  }

  function deleteCursor(courseCode: string): void {
    try {
      globalThis.localStorage?.removeItem(cursorKey(courseCode))
    } catch {
      // non-fatal
    }
  }

  // -----------------------------------------------------------------------
  // Progress helpers
  // -----------------------------------------------------------------------

  function emit(): void {
    const snapshot = { ...progress }
    for (const h of handlers) {
      try {
        h(snapshot)
      } catch {
        // Don't let a buggy subscriber take the loop down.
      }
    }
  }

  function updateProgress(patch: Partial<BundleDownloaderProgress>): void {
    progress = { ...progress, ...patch }
  }

  // -----------------------------------------------------------------------
  // Bundle walk — persistent audio in priority order
  // -----------------------------------------------------------------------

  /**
   * Walk the bundle and return the ordered list of persistent audio ids.
   *
   * Priority:
   *   1. Pods (Layer 2) — one pod at a time, in pod_order ascending.
   *      Per pod: intro bookend → sentences (target, then known, in
   *      globalOrder) → outro bookend. Pods come first because they're
   *      the most cache-sensitive content: laps have near-zero inter-play
   *      gaps and play 130+ files in quick succession, so any cold-load
   *      latency is audible. Spaced-rep USE phrases sit inside a ~10s
   *      cycle that absorbs load latency, so they're lower priority.
   *   2. Belt-forward: roundMap order, for each LEGO emit its USE phrases'
   *      k/t1/t2 in (position, role) order.
   *
   * Deduplicated by id across the whole walk.
   */
  function enumeratePersistentIds(bundle: CourseBundle): string[] {
    const seen = new Set<string>()
    const out: string[] = []

    const yieldRef = (ref: BundleAudioRef | undefined) => {
      if (!ref) return
      if (ref.lifecycle !== 'persistent') return
      if (seen.has(ref.id)) return
      seen.add(ref.id)
      out.push(ref.id)
    }

    // --- 1. Pods (Layer 2) ---------------------------------------------
    // Sort pods defensively even though the server orders them — the
    // CourseBundle contract doesn't pin pod order.
    const orderedPods = [...bundle.pods].sort((a, b) => a.podOrder - b.podOrder)
    for (const pod of orderedPods) {
      yieldRef(pod.introAudio)
      // Sentences in globalOrder ascending. The runtime plays them in
      // this order with role/speed driven by the active stage playlist,
      // but the underlying audio file is the same — caching globalOrder
      // ascending means lap N has the cache primed for sentence k before
      // the lap reaches it.
      const orderedSentences = [...pod.sentences].sort((a, b) => a.globalOrder - b.globalOrder)
      for (const sentence of orderedSentences) {
        yieldRef(sentence.targetAudio)
        yieldRef(sentence.knownAudio)
      }
      yieldRef(pod.outroAudio)
    }

    // --- 2. USE phrases by roundMap order ------------------------------
    // Index phrases by lego for O(1) lookup as we walk roundMap.
    const phrasesByLego = new Map<string, BundlePhrase[]>()
    for (const phrase of bundle.phrases) {
      if (phrase.role !== 'use') continue
      const list = phrasesByLego.get(phrase.legoId)
      if (list) list.push(phrase)
      else phrasesByLego.set(phrase.legoId, [phrase])
    }
    // Sort each lego's USE phrases by position for stable ordering.
    for (const list of phrasesByLego.values()) {
      list.sort((a, b) => a.position - b.position)
    }

    // Sort roundMap defensively — spec says ascending but don't trust callers.
    const orderedRounds = [...bundle.roundMap].sort((a, b) => a.roundIndex - b.roundIndex)

    for (const entry of orderedRounds) {
      const usePhrases = phrasesByLego.get(entry.legoId)
      if (!usePhrases) continue
      for (const phrase of usePhrases) {
        yieldRef(phrase.audio.known)
        yieldRef(phrase.audio.target1)
        yieldRef(phrase.audio.target2)
      }
    }

    return out
  }

  // -----------------------------------------------------------------------
  // Run loop
  // -----------------------------------------------------------------------

  async function runDownload(bundle: CourseBundle): Promise<void> {
    const courseCode = bundle.courseCode
    const allIds = enumeratePersistentIds(bundle)
    const total = allIds.length

    // Read + validate cursor. Wipe on version mismatch.
    let cursor = readCursor(courseCode)
    if (cursor && cursor.version !== bundle.version) {
      deleteCursor(courseCode)
      cursor = null
    }
    const cursorSet = new Set(cursor?.cachedIds ?? [])

    // Build queue: skip ids the cursor or cache already covers.
    const queue: string[] = []
    let cached = 0
    for (const id of allIds) {
      const inCursor = cursorSet.has(id)
      const inCache = audioCache.persistent.has(id)
      if (inCursor || inCache) {
        cached += 1
        if (!cursorSet.has(id)) cursorSet.add(id)
        continue
      }
      queue.push(id)
    }

    updateProgress({
      cached,
      total,
      isRunning: true,
      haltedForQuota: false,
      lastError: null,
    })
    emit()

    // If everything is already cached, persist a tidy cursor and bail.
    if (queue.length === 0) {
      writeCursor(courseCode, {
        version: bundle.version,
        cachedIds: Array.from(cursorSet),
      })
      updateProgress({ isRunning: false })
      emit()
      return
    }

    let cursorWritesSinceFlush = 0
    let queueIdx = 0

    // Outer loop: spawn `concurrency` workers, wait for batch, check quota.
    // We re-spawn between batches so the quota check actually sees a
    // breathing point (not just inside a single worker's await).
    while (queueIdx < queue.length && !stopRequested) {
      const pressure = await audioCache.quotaPressure()
      if (pressure > ceiling) {
        updateProgress({ haltedForQuota: true, isRunning: false })
        writeCursor(courseCode, {
          version: bundle.version,
          cachedIds: Array.from(cursorSet),
        })
        emit()
        return
      }

      // Snapshot how many ids we want this batch — `concurrency` per
      // batch. The quota check between batches is the pinch point.
      const batchEnd = Math.min(queueIdx + concurrency, queue.length)
      const workerCount = Math.min(concurrency, batchEnd - queueIdx)
      const batchTarget = batchEnd

      // Worker bound to this batch's slice.
      const batchWorker = async (): Promise<void> => {
        while (true) {
          if (stopRequested) return
          if (queueIdx >= batchTarget) return
          const id = queue[queueIdx]
          queueIdx += 1
          try {
            await audioCache.persistent.ensure(id)
          } catch (err) {
            progress = {
              ...progress,
              lastError: err instanceof Error ? err.message : String(err),
            }
          }
          const nowCached = audioCache.persistent.has(id)
          if (nowCached) {
            if (!cursorSet.has(id)) cursorSet.add(id)
            progress = { ...progress, cached: progress.cached + 1 }
          }
          cursorWritesSinceFlush += 1
          if (cursorWritesSinceFlush >= CURSOR_PERSIST_EVERY) {
            cursorWritesSinceFlush = 0
            writeCursor(courseCode, {
              version: bundle.version,
              cachedIds: Array.from(cursorSet),
            })
          }
          emit()
        }
      }
      const workers: Promise<void>[] = []
      for (let i = 0; i < workerCount; i++) workers.push(batchWorker())
      await Promise.all(workers)
    }

    // Final flush.
    writeCursor(courseCode, {
      version: bundle.version,
      cachedIds: Array.from(cursorSet),
    })
    updateProgress({ isRunning: false })
    emit()
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  async function start(bundle: CourseBundle): Promise<void> {
    // Same course already running → return the in-flight promise.
    if (activeRun && activeCourseCode === bundle.courseCode) {
      return activeRun
    }
    // Different course requested → stop the current loop. In-flight
    // ensures will finish naturally (the cache de-dupes), then we start
    // fresh.
    if (activeRun && activeCourseCode !== bundle.courseCode) {
      stopRequested = true
      try {
        await activeRun
      } catch {
        // ignored — we're tearing it down anyway
      }
    }
    stopRequested = false
    activeCourseCode = bundle.courseCode
    activeRun = runDownload(bundle).finally(() => {
      // Only clear the slot if no new run started in the meantime.
      if (activeCourseCode === bundle.courseCode) {
        activeRun = null
      }
    })
    return activeRun
  }

  function stop(): void {
    stopRequested = true
  }

  function resetCursor(courseCode: string): void {
    deleteCursor(courseCode)
  }

  function getProgress(): BundleDownloaderProgress {
    return { ...progress }
  }

  function onProgress(handler: (p: BundleDownloaderProgress) => void): () => void {
    handlers.add(handler)
    return () => {
      handlers.delete(handler)
    }
  }

  return { start, stop, resetCursor, getProgress, onProgress }
}
