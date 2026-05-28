/**
 * AudioCache — tier-aware IndexedDB audio cache
 *
 * Replaces the implicit "OfflineCache + DownloadManager + warmedUpAudioUrls"
 * surface with a single source of truth for "is this audio playable
 * locally". Two namespaces with different lifecycles:
 *
 *   persistent — large, slow-growing set the bundle downloader walks
 *     across the whole course session-after-session. Reaches steady
 *     state once a course is fully downloaded; LRU-evicted only when
 *     storage quota pressure forces it.
 *
 *   ephemeral  — small working set for ~3 incoming LEGOs at a time
 *     (their intro/debut/build audio). Acquired by the prefetcher
 *     ~2 rounds before a LEGO debuts; explicitly released the moment
 *     its intro round completes.
 *
 * Both namespaces share one IndexedDB store (separate column flags it)
 * so quota accounting is unified and the same blob never gets stored
 * twice if it crosses lifecycles. The implementation MAY reuse the
 * existing `@ssi/core` `OfflineCache` as the underlying store — that's
 * a build-time decision, not a contract one.
 */

// ============================================================================
// AUDIO IDENTIFIER
// ============================================================================

/** Bare audio id — the same UUID used as `/api/audio/:id` path segment. */
export type AudioId = string

// ============================================================================
// CACHE STATS
// ============================================================================

export interface CacheNamespaceStats {
  /** Number of cached audio files in this namespace. */
  count: number
  /** Sum of blob sizes in bytes. */
  bytes: number
}

export interface AudioCacheStats {
  persistent: CacheNamespaceStats
  ephemeral: CacheNamespaceStats
  /** Browser quota estimate (best-effort; may be undefined on old browsers). */
  quotaBytes: number | undefined
  /** Browser usage estimate across all origin storage (not just our DB). */
  usageBytes: number | undefined
}

// ============================================================================
// PERSISTENT NAMESPACE
// ============================================================================

export interface PersistentNamespace {
  /**
   * Fetch (if missing) and cache the audio. Resolves when the blob is
   * durably in IndexedDB. Caller is the bundle downloader (background)
   * or the prefetcher (short-range backstop).
   *
   * Idempotent: a second call for an already-cached id is a fast no-op
   * (synchronously-resolved promise).
   *
   * Throws on fetch/storage failure. Callers MUST wrap in try/catch —
   * the system is designed to keep playing through cache errors.
   */
  ensure(id: AudioId): Promise<void>

  /**
   * Synchronous in-memory check. Backed by a Set populated at init time
   * and maintained on every ensure/evict. Cheap enough to call once per
   * cycle on the hot playback path.
   */
  has(id: AudioId): boolean

  /**
   * Return a blob URL for the cached audio, or null if not cached.
   * Caller is responsible for `URL.revokeObjectURL` once the audio
   * element has loaded — the CyclePlayer / SimplePlayer already do this.
   */
  getBlobUrl(id: AudioId): Promise<string | null>

  /**
   * Best-effort LRU eviction down to `targetBytes`. Called by the
   * cache itself when quota pressure trips a threshold — callers don't
   * normally invoke this directly.
   */
  evictToTarget(targetBytes: number): Promise<void>
}

// ============================================================================
// EPHEMERAL NAMESPACE
// ============================================================================

/**
 * Audio bundle for one LEGO's intro round. The prefetcher computes this
 * from `BundleLego.ephemeralAudio` + the LEGO's BUILD phrases.
 */
export interface EphemeralLegoSet {
  legoId: string
  audioIds: AudioId[]
}

export interface EphemeralNamespace {
  /**
   * Fetch and cache every audio file in the set. Resolves when all
   * blobs are in IndexedDB. Caller is the prefetcher, ~2 rounds before
   * the LEGO's intro round starts.
   *
   * Safe to call repeatedly for the same legoId — already-cached files
   * resolve immediately.
   */
  acquireForLego(set: EphemeralLegoSet): Promise<void>

  /**
   * Evict every audio file in the LEGO's ephemeral set. Called by the
   * prefetcher on the `round:completed` event for that LEGO's intro
   * round.
   *
   * Returns the number of files actually deleted (informational; for
   * logging / telemetry).
   */
  releaseForLego(legoId: string): Promise<number>

  /** Synchronous in-memory check, same semantics as persistent.has. */
  has(id: AudioId): boolean

  /** Same shape as persistent.getBlobUrl. */
  getBlobUrl(id: AudioId): Promise<string | null>
}

// ============================================================================
// CACHE FAÇADE
// ============================================================================

export interface AudioCache {
  persistent: PersistentNamespace
  ephemeral: EphemeralNamespace

  /**
   * `has(id)` — unified read across both namespaces. Use this in the
   * playback hot path; the namespace boundary is irrelevant at play
   * time, only at write time.
   */
  has(id: AudioId): boolean

  /**
   * `getBlobUrl(id)` — same unification on the read path. Returns from
   * whichever namespace has the audio (persistent wins if both, which
   * should never happen in practice).
   */
  getBlobUrl(id: AudioId): Promise<string | null>

  /**
   * `getWavBlobUrl(id)` — OFFLINE playback URL. Decodes the cached bytes and
   * re-encodes as a WAV blob URL, because WebKit's <audio> plays WAV blob
   * URLs but rejects mp3 ones ("operation is not supported"). Cached per id;
   * null on miss / decode failure (caller falls back to the network URL).
   */
  getWavBlobUrl(id: AudioId): Promise<string | null>

  /**
   * 0..1 — current storage pressure (usage / quota). Bundle downloader
   * consults this and backs off when pressure crosses a threshold
   * (e.g. 0.85) to avoid evicting useful audio just to download more.
   *
   * Returns 0 if the browser doesn't expose `navigator.storage.estimate`.
   */
  quotaPressure(): Promise<number>

  /** Cache stats for diagnostics + UI ("X MB cached"). */
  stats(): Promise<AudioCacheStats>

  /**
   * Drop everything for a course (e.g. on version bump). Clears both
   * namespaces' entries for that course; persistent storage for other
   * courses is preserved.
   */
  clearCourse(courseCode: string): Promise<void>
}

// ============================================================================
// FACTORY OPTIONS
// ============================================================================

export interface CreateAudioCacheOptions {
  /**
   * URL builder for cache misses. Defaults to `/api/audio/${id}` —
   * override for tests or alternate routing.
   */
  audioUrl?: (id: AudioId) => string

  /**
   * Quota fraction the bundle downloader is allowed to consume.
   * Default 0.5 — leaves headroom for other origin storage (Supabase
   * client state, localStorage, future caches).
   */
  maxQuotaFraction?: number
}
