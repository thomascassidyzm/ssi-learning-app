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
import { BELT_THRESHOLDS } from '../playback/PriorityRoundLoader'

// ============================================================================
// PUBLIC TYPES
// ============================================================================

export interface BundleDownloaderOptions {
  /** Cache to write into. Required. */
  audioCache: AudioCache
  /**
   * Max concurrent fetches. Default 4 — concurrency=4 amortises cold-start
   * ~4× faster than the previous default of 1, and stays well under the
   * proxy rate-limit ceiling. Retained as an option for future tuning.
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
  /**
   * Sleep function used for jitter and retry backoff. Defaults to
   * setTimeout-backed. Tests inject a synchronous resolver to avoid
   * burning wall-clock time.
   */
  sleep?: (ms: number) => Promise<void>
  /**
   * RNG used to pick jitter durations. Defaults to Math.random.
   * Tests inject a deterministic sequence for assertions.
   */
  random?: () => number
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
  /**
   * True if a size-capped run hit its maxBytes ceiling. Distinct from
   * haltedForQuota — this is a soft cap the caller imposed (driving-mode
   * chunked prefetch), not a quota safety net.
   */
  haltedForByteCap: boolean
  /** Last error message if any. */
  lastError: string | null
}

/**
 * Per-call options for {@link BundleDownloader.start}. Lets a caller cap a
 * single invocation to N freshly-downloaded bytes (chunked prefetch) and/or
 * front-load a specific set of audio ids ahead of the bundle's walk order.
 *
 * Both are halt/seed knobs over the existing walk — the priority list still
 * goes through the same dedup + cursor + retry machinery as the bundle ids,
 * and the byte cap only measures bytes newly fetched in this run (already-
 * cached ids contribute zero to the count).
 */
export interface BundleDownloaderStartOptions {
  /**
   * Soft cap on bytes downloaded by THIS start() invocation. Pre-cached
   * audio doesn't count — only blobs newly fetched and persisted while
   * this run is active. Halt is checked between batches, so the actual
   * cap is the cap + (concurrency × per-blob size) in the worst case.
   *
   * Use case: driving-mode wants ~50MB of cache primed before activation,
   * with subsequent chunks fired in the background after playback starts.
   * Each chunk is a separate start() call with maxBytes set.
   */
  maxBytes?: number
  /**
   * Audio ids to enqueue ahead of the bundle's natural walk order.
   * Dedupes against already-cached + cursor-marked ids, so already-warm
   * ids are skipped. Order within the list is preserved.
   *
   * Use case: driving-mode knows which rounds are next and wants their
   * audio cached first, before BundleDownloader fills the long tail.
   */
  priorityIds?: string[]
}

export interface BundleDownloader {
  /**
   * Start downloading for this bundle. Idempotent — safe to call
   * repeatedly. The optional `opts` lets callers cap a single run by
   * bytes and/or front-load specific ids (used by driving-mode chunked
   * prefetch).
   */
  start(bundle: CourseBundle, opts?: BundleDownloaderStartOptions): Promise<void>
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

// Uniform politeness jitter applied between cache-miss fetches.
const JITTER_MIN_MS = 100
const JITTER_MAX_MS = 300

// Exponential backoff on 429/503 — 1s, 2s, 4s, 8s, capped at 30s.
const BACKOFF_BASE_MS = 1000
const BACKOFF_CAP_MS = 30_000
const MAX_RETRIES = 3

/** Default sleep, real-time. Stripped to a no-op shim in tests. */
const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Parse the HTTP status out of an AudioCache fetch error message.
 * AudioCache.persistent.ensure rejects with
 *   `AudioCache: fetch <id> → <status>`
 * Anything else returns null and is treated as non-retryable.
 */
function parseFetchStatus(message: string): number | null {
  const match = message.match(/→\s*(\d{3})\b/)
  if (!match) return null
  const status = Number(match[1])
  return Number.isFinite(status) ? status : null
}

// ============================================================================
// FACTORY
// ============================================================================

export function createBundleDownloader(options: BundleDownloaderOptions): BundleDownloader {
  const audioCache = options.audioCache
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY
  const ceiling = options.quotaPressureCeiling ?? DEFAULT_QUOTA_PRESSURE_CEILING
  const storagePrefix = options.storagePrefix ?? DEFAULT_STORAGE_PREFIX
  const sleep = options.sleep ?? defaultSleep
  const random = options.random ?? Math.random

  // Mutable state — singleton per downloader instance.
  let activeCourseCode: string | null = null
  let activeRun: Promise<void> | null = null
  let stopRequested = false
  let progress: BundleDownloaderProgress = {
    cached: 0,
    total: 0,
    isRunning: false,
    haltedForQuota: false,
    haltedForByteCap: false,
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
   * Priority — learner-reachability order. Earliest-needed first.
   *
   *   1. Belt entry points — for each belt threshold (1, 8, 20, 40, 80,
   *      150, 280, 400), find the first LEGO in roundMap order at or after
   *      that threshold and emit its USE phrases' k/t1/t2. This guarantees
   *      that even mid-cold-start, a belt-skipping learner lands on a
   *      LEGO whose audio is already cached: every belt's Round-1 entry
   *      gets primed before we fill in the long tail.
   *   2. Pods (Layer 2) — one pod at a time, in pod_order ascending.
   *      Per pod: intro bookend → sentences (target, then known, in
   *      globalOrder) → outro bookend. Pods come before the LEGO long
   *      tail because Listening Mode is a one-tap entry from the UI, not
   *      gated on round progression — a learner can open it at any time
   *      and expect the pod to be ready. The first pod is ~130 files
   *      (~25s with concurrency=4), so the gap between belt-entry coverage
   *      and listening-mode coverage is small.
   *   3. Belt-forward LEGO USE phrases — roundMap order, for each LEGO
   *      emit its USE phrases' k/t1/t2 in (position, role) order, skipping
   *      anything already emitted by pass 1. This is the long tail —
   *      thousands of files filling in over minutes, but every belt's
   *      Round-1 entry is already covered by pass 1 and pods by pass 2.
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

    // --- 1 & 2. USE phrases — belt entries first, then roundMap order -
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

    const yieldUsePhrasesFor = (legoId: string) => {
      const usePhrases = phrasesByLego.get(legoId)
      if (!usePhrases) return
      for (const phrase of usePhrases) {
        yieldRef(phrase.audio.known)
        yieldRef(phrase.audio.target1)
        yieldRef(phrase.audio.target2)
      }
    }

    // --- 1. Belt entry points — first LEGO at/after each belt threshold.
    // We iterate thresholds ascending (smallest first) so the first belt's
    // entry gets cached before the second belt's, etc. The deduper in
    // yieldRef makes overlap a no-op (e.g. if seed 1 is the only LEGO,
    // all thresholds resolve to the same entry).
    const emittedBeltLegos = new Set<string>()
    for (const threshold of BELT_THRESHOLDS) {
      // First roundMap entry whose seedNumber clears the threshold.
      const entry = orderedRounds.find((e) => e.seedNumber >= threshold)
      if (!entry) continue
      if (emittedBeltLegos.has(entry.legoId)) continue
      emittedBeltLegos.add(entry.legoId)
      yieldUsePhrasesFor(entry.legoId)
    }

    // --- 2. Pods (Layer 2) — sit between belt entries and the LEGO long
    // tail so Listening Mode is usable within tens of seconds of session
    // start, not after the whole course finishes downloading. Sort pods
    // defensively even though the server orders them — the CourseBundle
    // contract doesn't pin pod order.
    const orderedPods = [...bundle.pods].sort((a, b) => a.podOrder - b.podOrder)
    for (const pod of orderedPods) {
      yieldRef(pod.introAudio)
      // Sentences in globalOrder ascending. The runtime plays them in
      // this order with role/speed driven by the active stage playlist,
      // but the underlying audio file is the same — caching globalOrder
      // ascending means lap N has the cache primed for sentence k before
      // the lap reaches it. Explainer audio (Tom-voiced bilingual
      // breakdown) sits alongside target+known — fires in Stage 1 of
      // the playlist and needs the same gapless availability.
      const orderedSentences = [...pod.sentences].sort((a, b) => a.globalOrder - b.globalOrder)
      for (const sentence of orderedSentences) {
        yieldRef(sentence.targetAudio)
        yieldRef(sentence.knownAudio)
        yieldRef(sentence.explainerAudio)
      }
      yieldRef(pod.outroAudio)
    }

    // --- 3. Fill the rest of LEGO USE phrases in roundMap order. yieldRef
    // dedupes by id, so anything already emitted by the belt-entry pass
    // is silently skipped.
    for (const entry of orderedRounds) {
      yieldUsePhrasesFor(entry.legoId)
    }

    return out
  }

  // -----------------------------------------------------------------------
  // Run loop
  // -----------------------------------------------------------------------

  /**
   * Snapshot the total bytes currently in the persistent namespace. Used as
   * a baseline for the maxBytes cap — bytes downloaded by THIS run = stats
   * delta since runDownload started. Falls back to 0 if stats() errors;
   * the worst case is a cap that under-counts, which just halts sooner.
   */
  async function readPersistentBytes(): Promise<number> {
    try {
      const stats = await audioCache.stats()
      return stats.persistent.bytes
    } catch {
      return 0
    }
  }

  async function runDownload(
    bundle: CourseBundle,
    opts: BundleDownloaderStartOptions,
  ): Promise<void> {
    const courseCode = bundle.courseCode
    const maxBytes = opts.maxBytes
    const priorityIds = opts.priorityIds ?? []

    // Enumerate the bundle's natural walk order, then prepend the caller's
    // priority list. Dedup is handled at queue-build time, so we just
    // concatenate and let the filter below skip duplicates.
    const bundleIds = enumeratePersistentIds(bundle)
    const seenAll = new Set<string>()
    const allIds: string[] = []
    for (const id of priorityIds) {
      if (seenAll.has(id)) continue
      seenAll.add(id)
      allIds.push(id)
    }
    for (const id of bundleIds) {
      if (seenAll.has(id)) continue
      seenAll.add(id)
      allIds.push(id)
    }
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
      haltedForByteCap: false,
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

    // Byte-cap baseline. Only sampled if maxBytes was set — otherwise we
    // skip the stats() round-trip entirely (existing always-on callers
    // don't pay for a feature they don't use).
    const baselineBytes = maxBytes !== undefined ? await readPersistentBytes() : 0

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

      // Byte-cap halt. Sampled between batches so the cap is approximate
      // by up to (concurrency × per-blob size) — fine for a soft chunk
      // boundary. Caller fires another start() with a fresh maxBytes to
      // accumulate the next chunk.
      if (maxBytes !== undefined) {
        const nowBytes = await readPersistentBytes()
        if (nowBytes - baselineBytes >= maxBytes) {
          updateProgress({ haltedForByteCap: true, isRunning: false })
          writeCursor(courseCode, {
            version: bundle.version,
            cachedIds: Array.from(cursorSet),
          })
          emit()
          return
        }
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

          // Cache-hit fast path: ensure() resolves synchronously from
          // audioCache.has(id), so we skip both jitter and retry. A
          // cold-cache learner should never sit through pointless
          // jitter while the cache walks already-cached ids.
          const wasAlreadyCached = audioCache.persistent.has(id)
          if (!wasAlreadyCached) {
            // Politeness jitter (100–300ms uniform) between cache-miss
            // fetches — spreads cold-cache hammering across the edge.
            const jitter = JITTER_MIN_MS + Math.floor(random() * (JITTER_MAX_MS - JITTER_MIN_MS + 1))
            await sleep(jitter)
            if (stopRequested) return
          }

          // Attempt with bounded retries on 429/503. Other errors stay
          // non-retryable (recorded once in lastError and we move on).
          let attempt = 0
          while (true) {
            try {
              await audioCache.persistent.ensure(id)
              break
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err)
              const status = parseFetchStatus(message)
              const retryable = status === 429 || status === 503
              if (retryable && attempt < MAX_RETRIES && !stopRequested) {
                const delay = Math.min(BACKOFF_BASE_MS * 2 ** attempt, BACKOFF_CAP_MS)
                attempt += 1
                await sleep(delay)
                if (stopRequested) return
                continue
              }
              progress = { ...progress, lastError: message }
              break
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

  async function start(
    bundle: CourseBundle,
    opts: BundleDownloaderStartOptions = {},
  ): Promise<void> {
    // Same course already running → return the in-flight promise.
    // Note: per-call opts on a re-entrant call are dropped — the in-flight
    // run already owns its own (priorityIds, maxBytes). Callers wanting a
    // distinct chunk must wait for the previous start() to settle first;
    // driving-mode does exactly that (sequential chunk-then-next-chunk).
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
    activeRun = runDownload(bundle, opts).finally(() => {
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
