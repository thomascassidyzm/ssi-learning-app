/**
 * AudioCache — tier-aware IndexedDB audio cache implementation.
 *
 * See AudioCache.types.ts for the contract. This implementation backs
 * both namespaces with a single IndexedDB store (`ssi-audio-cache-v2`),
 * keyed by audio id, with a `lifecycle` column distinguishing the two
 * namespaces. In-memory id Sets make `has(id)` synchronous and cheap.
 */

import { openDB, deleteDB, type IDBPDatabase, type DBSchema } from 'idb'
import type {
  AudioCache,
  AudioCacheStats,
  AudioId,
  CreateAudioCacheOptions,
  EphemeralLegoSet,
  EphemeralNamespace,
  PersistentNamespace,
} from './AudioCache.types'
import type { AudioLifecycle } from '../types/courseBundle'
import { buildAudioUrl, getAudioRevision } from '@ssi/core'
import { bytesToWavBlob } from './wav'

const DB_NAME = 'ssi-audio-cache-v2'
const DB_VERSION = 1
const STORE = 'audio'
const STATS_TTL_MS = 5000

interface AudioRow {
  id: string
  blob: Blob
  mimeType: string
  size: number
  lifecycle: AudioLifecycle
  // Vestigial: always written null. The per-course clear API that consumed it
  // was removed (it had no production caller and the write path never
  // populated this, so it could only ever no-op). Kept in the row + the
  // `by-course` index to avoid a DB_VERSION migration; repurpose or drop both
  // in the next schema bump if still unused.
  courseCode: string | null
  cachedAt: number
  lastAccessedAt: number
  ephemeralOwnerLegoId: string | null
  /**
   * The `course_audio.audio_revision` these bytes were fetched at, when it
   * was known. Repaired audio is swapped in place at the SAME id, so the id
   * alone no longer identifies the bytes — without this a device that cached
   * the damaged clip would serve it from IndexedDB forever, even though the
   * HTTP layer has been busted by the `?v=` URL.
   *
   * Optional on purpose: every row written before this existed has no value,
   * and undefined is meaningful (see `isStale`). No DB_VERSION bump — adding
   * an optional field to an existing store needs no migration, and bumping
   * would force an upgrade transaction on every device for nothing.
   */
  audioRevision?: number
}

interface CacheSchema extends DBSchema {
  audio: {
    key: string
    value: AudioRow
    indexes: {
      'by-lifecycle': AudioLifecycle
      'by-course': string
      'by-last-accessed': number
      'by-ephemeral-owner': string
    }
  }
}

export class AudioCacheImpl implements AudioCache {
  private db: IDBPDatabase<CacheSchema> | null = null
  private initPromise: Promise<void> | null = null

  private readonly persistentIds: Set<string> = new Set()
  private readonly ephemeralIds: Set<string> = new Set()

  /**
   * id -> the revision the cached bytes were fetched at. Mirrors
   * `AudioRow.audioRevision` so the staleness check stays synchronous and
   * the `has(id)` fast path keeps its O(1) shape. Ids absent from this map
   * either aren't cached or were cached before revisions existed.
   */
  private readonly cachedRevisions: Map<string, number> = new Map()

  // Offline WAV blob URLs, keyed by audio id — decoded once and reused for
  // repeated clips (spaced rep replays the same audio). See getWavBlobUrl.
  private readonly wavUrlCache: Map<string, string> = new Map()

  // In-flight WAV decodes, keyed by id. Concurrent getWavBlobUrl calls for the
  // same id (prefetch racing playback) share ONE decode + ONE object URL, so a
  // late caller can't overwrite the map with a second URL without revoking the
  // first (the blob-URL leak) and the mp3→WAV re-encode runs once, not twice.
  private readonly wavUrlInflight: Map<string, Promise<string | null>> = new Map()

  /** In-flight ensure/acquire de-dupe: one Promise per id. */
  private readonly inflight: Map<string, Promise<void>> = new Map()

  /** Per-lego abort controllers — release aborts in-flight acquires. */
  private readonly legoAborts: Map<string, AbortController> = new Map()

  /** stats() cache to avoid hammering IndexedDB. */
  private statsCache: { at: number; value: AudioCacheStats } | null = null

  private readonly audioUrl: (id: AudioId) => string
  private readonly fetchTimeoutMs: number

  readonly persistent: PersistentNamespace
  readonly ephemeral: EphemeralNamespace

  constructor(options: CreateAudioCacheOptions = {}) {
    // Revision-aware by default: a repaired clip fetches
    // `/api/audio/<id>?v=<rev>`, which no HTTP or SW cache has seen.
    this.audioUrl = options.audioUrl ?? ((id) => buildAudioUrl(id))
    this.fetchTimeoutMs = options.fetchTimeoutMs ?? 30_000

    // Bind namespace facades to `this`.
    this.persistent = {
      ensure: (id) => this.persistentEnsure(id),
      ensureFromUrl: (id, url) => this.persistentEnsureFromUrl(id, url),
      // A superseded entry answers false: `has` exists so callers can decide
      // whether to fetch, and holding repaired-away bytes is not "having it".
      // The read path (getBlobUrl) is independent and still serves the old
      // bytes if the refetch can't happen, so offline never goes silent.
      has: (id) => this.persistentIds.has(id) && !this.isStale(id),
      getBlobUrl: (id) => this.getBlobUrl(id),
      evictToTarget: (targetBytes) => this.persistentEvictToTarget(targetBytes),
    }
    this.ephemeral = {
      acquireForLego: (set) => this.ephemeralAcquireForLego(set),
      releaseForLego: (legoId) => this.ephemeralReleaseForLego(legoId),
      has: (id) => this.ephemeralIds.has(id) && !this.isStale(id),
      getBlobUrl: (id) => this.getBlobUrl(id),
    }
  }

  // ==========================================================================
  // INIT
  // ==========================================================================

  private async init(): Promise<void> {
    if (this.db) return
    if (this.initPromise) {
      await this.initPromise
      return
    }
    this.initPromise = this.doInit()
    await this.initPromise
  }

  private async doInit(): Promise<void> {
    const open = () => openDB<CacheSchema>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: 'id' })
          store.createIndex('by-lifecycle', 'lifecycle')
          store.createIndex('by-course', 'courseCode')
          store.createIndex('by-last-accessed', 'lastAccessedAt')
          store.createIndex('by-ephemeral-owner', 'ephemeralOwnerLegoId')
        }
      },
    })
    let db = await open()
    // Self-heal a storeless DB (interrupted upgrade / a ?reset that opened it
    // without recreating stores) — otherwise the very next transaction throws
    // NotFoundError and the whole audio cache is dead. Delete and recreate.
    if (!db.objectStoreNames.contains(STORE)) {
      db.close()
      await deleteDB(DB_NAME)
      db = await open()
    }
    this.db = db

    // Populate in-memory id Sets from the lifecycle index.
    const tx = this.db.transaction(STORE, 'readonly')
    const idx = tx.objectStore(STORE).index('by-lifecycle')
    let cursor = await idx.openCursor()
    while (cursor) {
      const row = cursor.value
      if (row.lifecycle === 'persistent') this.persistentIds.add(row.id)
      else this.ephemeralIds.add(row.id)
      if (typeof row.audioRevision === 'number') {
        this.cachedRevisions.set(row.id, row.audioRevision)
      }
      cursor = await cursor.continue()
    }
    await tx.done
  }

  // ==========================================================================
  // REVISION STALENESS
  // ==========================================================================

  /**
   * Is the cached copy of `id` superseded by a repair?
   *
   * `getAudioRevision(id)` is what the backend most recently told us to play
   * (undefined = never repaired, or we simply haven't heard). The stored
   * revision is what we actually hold.
   *
   *   wanted undefined                -> NOT stale. The load-bearing rule:
   *                                      offline, or on a payload that
   *                                      predates revisions, we know nothing,
   *                                      so we must keep playing what we have.
   *                                      Never invalidate on ignorance.
   *   stored undefined, wanted known  -> STALE. The entry was cached before
   *                                      revisions existed, so it may well be
   *                                      the very bytes that got repaired.
   *   wanted > stored                 -> STALE. A repair landed since.
   *   wanted <= stored                -> NOT stale. Never downgrade.
   *
   * A stale entry is refetched and overwritten, but is NOT deleted first: if
   * the refetch fails (offline), `getBlobUrl` still finds the old row and
   * playback continues on slightly-worse audio rather than silence.
   */
  private isStale(id: AudioId): boolean {
    const wanted = getAudioRevision(id)
    if (wanted === undefined) return false
    const stored = this.cachedRevisions.get(id)
    if (stored === undefined) return true
    return wanted > stored
  }

  /** Cache key for the in-flight de-dupe: an old-revision fetch in flight
   *  must not satisfy a request for a newer revision. */
  private inflightKey(id: AudioId): string {
    const wanted = getAudioRevision(id)
    return wanted === undefined ? id : `${id}@${wanted}`
  }

  // ==========================================================================
  // PERSISTENT
  // ==========================================================================

  private persistentEnsure(id: AudioId): Promise<void> {
    if (this.persistentIds.has(id) && !this.isStale(id)) return Promise.resolve()
    const key = this.inflightKey(id)
    const existing = this.inflight.get(key)
    if (existing) return existing

    const p = this.doFetchAndStore(id, {
      lifecycle: 'persistent',
      ephemeralOwnerLegoId: null,
    })
      .finally(() => {
        this.inflight.delete(key)
      })
    this.inflight.set(key, p)
    return p
  }

  private persistentEnsureFromUrl(id: AudioId, url: string): Promise<void> {
    if (this.persistentIds.has(id) && !this.isStale(id)) return Promise.resolve()
    const key = this.inflightKey(id)
    const existing = this.inflight.get(key)
    if (existing) return existing

    const p = this.doFetchAndStore(id, {
      lifecycle: 'persistent',
      ephemeralOwnerLegoId: null,
      url,
    })
      .finally(() => {
        this.inflight.delete(key)
      })
    this.inflight.set(key, p)
    return p
  }

  private async doFetchAndStore(
    id: AudioId,
    opts: { lifecycle: AudioLifecycle; ephemeralOwnerLegoId: string | null; signal?: AbortSignal; url?: string },
  ): Promise<void> {
    await this.init()
    if (!this.db) throw new Error('AudioCache: DB not initialized')

    // If already cached in either namespace, persistent wins — skip duplicate.
    // Unless a repair has superseded those bytes, in which case we refetch and
    // overwrite regardless of which namespace holds them.
    const stale = this.isStale(id)
    if (this.persistentIds.has(id) && !stale) return
    if (opts.lifecycle === 'ephemeral' && this.ephemeralIds.has(id) && !stale) return

    // Cross-namespace promotion: id is already cached as ephemeral and the
    // caller wants it persistent. Rewrite the existing row's lifecycle in
    // place instead of re-fetching, and move it between the in-memory Sets.
    // (A stale row is deliberately excluded — promoting it would keep the
    // superseded bytes, just under a different lifecycle.)
    if (opts.lifecycle === 'persistent' && this.ephemeralIds.has(id) && !stale) {
      const existing = await this.db.get(STORE, id)
      if (existing) {
        const promoted: AudioRow = {
          ...existing,
          lifecycle: 'persistent',
          ephemeralOwnerLegoId: null,
          lastAccessedAt: Date.now(),
        }
        await this.db.put(STORE, promoted)
        this.ephemeralIds.delete(id)
        this.persistentIds.add(id)
        this.statsCache = null
        return
      }
      // Row missing from DB despite Set membership — fall through to fetch
      // and self-heal the inconsistency.
      this.ephemeralIds.delete(id)
    }

    // Hard per-fetch timeout covering headers AND body. A hung connection
    // otherwise never settles this promise, and since it lives in the
    // in-flight de-dupe map every retry of the id gets the same dead promise
    // — the silent bulk-download freeze (founder stall, 2026-07-31). The
    // timeout converts the hang into a rejection the callers' retry paths
    // already handle, and `.finally` clears the in-flight entry so the next
    // attempt fetches for real.
    const controller = new AbortController()
    const timer = setTimeout(
      () => controller.abort(new DOMException(`AudioCache: fetch ${id} timed out`, 'TimeoutError')),
      this.fetchTimeoutMs,
    )
    const onOuterAbort = () => controller.abort(new DOMException('Aborted', 'AbortError'))
    if (opts.signal?.aborted) onOuterAbort()
    else opts.signal?.addEventListener('abort', onOuterAbort, { once: true })

    let blob: Blob
    try {
      const res = await fetch(opts.url ?? this.audioUrl(id), { signal: controller.signal })
      if (!res.ok) {
        throw new Error(`AudioCache: fetch ${id} → ${res.status}`)
      }
      blob = await res.blob()
    } finally {
      clearTimeout(timer)
      opts.signal?.removeEventListener('abort', onOuterAbort)
    }

    if (opts.signal?.aborted) {
      // Caller already abandoned us; don't persist.
      throw new DOMException('Aborted', 'AbortError')
    }

    const now = Date.now()
    // Stamp the revision these bytes were fetched at. Read AFTER the fetch so
    // a revision published mid-flight isn't attributed to older bytes.
    const fetchedRevision = getAudioRevision(id)
    const row: AudioRow = {
      id,
      blob,
      mimeType: blob.type || 'audio/mpeg',
      size: blob.size,
      lifecycle: opts.lifecycle,
      courseCode: null,
      cachedAt: now,
      lastAccessedAt: now,
      ephemeralOwnerLegoId: opts.ephemeralOwnerLegoId,
      ...(fetchedRevision !== undefined ? { audioRevision: fetchedRevision } : {}),
    }
    await this.db.put(STORE, row)

    if (fetchedRevision !== undefined) this.cachedRevisions.set(id, fetchedRevision)
    else this.cachedRevisions.delete(id)

    // The decoded-WAV cache is keyed by id too, so an overwrite must drop it —
    // otherwise the offline read path keeps handing out a blob: URL holding
    // the repaired-away audio, and the repair is invisible offline.
    const staleWav = this.wavUrlCache.get(id)
    if (staleWav) {
      URL.revokeObjectURL(staleWav)
      this.wavUrlCache.delete(id)
    }

    if (opts.lifecycle === 'persistent') {
      this.persistentIds.add(id)
      // Defensive: if id was somehow in both Sets, ensure only persistent.
      this.ephemeralIds.delete(id)
    } else {
      this.ephemeralIds.add(id)
    }

    this.statsCache = null
  }

  private async persistentEvictToTarget(targetBytes: number): Promise<void> {
    await this.init()
    if (!this.db) return

    // Compute current persistent total.
    let total = 0
    {
      const tx = this.db.transaction(STORE, 'readonly')
      const idx = tx.objectStore(STORE).index('by-lifecycle')
      let cursor = await idx.openCursor('persistent')
      while (cursor) {
        total += cursor.value.size
        cursor = await cursor.continue()
      }
      await tx.done
    }
    if (total <= targetBytes) return

    // Walk by-last-accessed ascending; delete persistent rows oldest-first.
    const tx = this.db.transaction(STORE, 'readwrite')
    const idx = tx.objectStore(STORE).index('by-last-accessed')
    let cursor = await idx.openCursor()
    while (cursor && total > targetBytes) {
      const row = cursor.value
      if (row.lifecycle === 'persistent') {
        total -= row.size
        this.persistentIds.delete(row.id)
        this.cachedRevisions.delete(row.id)
        // The bytes are gone — drop any cached WAV blob URL for this id too,
        // else a held blob: URL points at deleted data and plays silence/stalls.
        // Revoke it to release the blob.
        const staleWavUrl = this.wavUrlCache.get(row.id)
        if (staleWavUrl) { URL.revokeObjectURL(staleWavUrl); this.wavUrlCache.delete(row.id) }
        await cursor.delete()
      }
      cursor = await cursor.continue()
    }
    await tx.done

    this.statsCache = null
  }

  // ==========================================================================
  // EPHEMERAL
  // ==========================================================================

  private async ephemeralAcquireForLego(set: EphemeralLegoSet): Promise<void> {
    await this.init()

    // One AbortController per legoId — release aborts it.
    let ac = this.legoAborts.get(set.legoId)
    if (!ac) {
      ac = new AbortController()
      this.legoAborts.set(set.legoId, ac)
    }
    const signal = ac.signal

    const promises: Promise<void>[] = []
    for (const id of set.audioIds) {
      // Persistent wins — never duplicate. A superseded entry is refetched
      // regardless of which namespace holds it.
      const stale = this.isStale(id)
      if (this.persistentIds.has(id) && !stale) continue
      if (this.ephemeralIds.has(id) && !stale) continue
      const key = this.inflightKey(id)
      const existing = this.inflight.get(key)
      if (existing) {
        promises.push(existing)
        continue
      }
      const p = this.doFetchAndStore(id, {
        lifecycle: 'ephemeral',
        ephemeralOwnerLegoId: set.legoId,
        signal,
      })
        .catch((err) => {
          // Swallow AbortError — release-during-acquire is expected.
          if (err instanceof DOMException && err.name === 'AbortError') return
          throw err
        })
        .finally(() => {
          this.inflight.delete(key)
        })
      this.inflight.set(key, p)
      promises.push(p)
    }

    await Promise.all(promises)
  }

  private async ephemeralReleaseForLego(legoId: string): Promise<number> {
    await this.init()
    if (!this.db) return 0

    // Abort any in-flight acquires for this lego.
    const ac = this.legoAborts.get(legoId)
    if (ac) {
      ac.abort()
      this.legoAborts.delete(legoId)
    }

    // Walk by-ephemeral-owner and delete every matching row.
    let deleted = 0
    const tx = this.db.transaction(STORE, 'readwrite')
    const idx = tx.objectStore(STORE).index('by-ephemeral-owner')
    let cursor = await idx.openCursor(IDBKeyRange.only(legoId))
    while (cursor) {
      const row = cursor.value
      this.ephemeralIds.delete(row.id)
      this.cachedRevisions.delete(row.id)
      await cursor.delete()
      deleted++
      cursor = await cursor.continue()
    }
    await tx.done

    this.statsCache = null
    return deleted
  }

  // ==========================================================================
  // READS
  // ==========================================================================

  has(id: AudioId): boolean {
    // Same rule as the namespace facades: holding bytes a repair has
    // superseded is not "having it".
    return (this.persistentIds.has(id) || this.ephemeralIds.has(id)) && !this.isStale(id)
  }

  async getBlobUrl(id: AudioId): Promise<string | null> {
    await this.init()
    if (!this.db) return null

    const row = await this.db.get(STORE, id)
    if (!row) return null

    // Fire-and-forget lastAccessedAt update.
    const updated: AudioRow = { ...row, lastAccessedAt: Date.now() }
    void this.db.put(STORE, updated)

    // Guarantee the blob URL carries a decodable content-type. A blob with
    // an empty `.type` yields a typeless blob: URL that iOS Safari's <audio>
    // rejects with "operation is not supported" — the failure that got blob
    // playback dropped 2026-05-23. We captured the real type as `mimeType`
    // at fetch time; re-wrap only when the stored blob lost its own type.
    const typed = row.blob.type
      ? row.blob
      : new Blob([row.blob], { type: row.mimeType || 'audio/mpeg' })
    return URL.createObjectURL(typed)
  }

  /**
   * Offline playback URL: decode the cached (mp3) bytes and re-encode as a
   * WAV blob URL. WebKit's <audio> plays WAV blob URLs but NOT mp3 ones
   * ("operation is not supported"), so this is the offline-mode read path.
   * Decoded once per id and cached — spaced rep replays the same clips, so
   * we never decode the same audio twice. Null on miss / decode failure, so
   * the caller falls back to the network URL.
   */
  async getWavBlobUrl(id: AudioId): Promise<string | null> {
    const cached = this.wavUrlCache.get(id)
    if (cached) return cached
    // Coalesce concurrent decodes: one shared promise per id means one decode
    // and one object URL, so a racing caller can't leak a second URL.
    const existing = this.wavUrlInflight.get(id)
    if (existing) return existing
    const work = (async (): Promise<string | null> => {
      await this.init()
      if (!this.db) return null
      const row = await this.db.get(STORE, id)
      if (!row) return null
      const wav = await bytesToWavBlob(await row.blob.arrayBuffer())
      if (!wav) return null
      const url = URL.createObjectURL(wav)
      this.wavUrlCache.set(id, url)
      return url
    })().finally(() => {
      this.wavUrlInflight.delete(id)
    })
    this.wavUrlInflight.set(id, work)
    return work
  }

  // ==========================================================================
  // QUOTA & STATS
  // ==========================================================================

  async quotaPressure(): Promise<number> {
    try {
      if (typeof navigator === 'undefined') return 0
      const storage = (navigator as Navigator & { storage?: StorageManager }).storage
      if (!storage?.estimate) return 0
      const est = await storage.estimate()
      if (!est.quota || est.quota === 0) return 0
      const ratio = (est.usage ?? 0) / est.quota
      if (ratio < 0) return 0
      if (ratio > 1) return 1
      return ratio
    } catch {
      return 0
    }
  }

  async stats(): Promise<AudioCacheStats> {
    const now = Date.now()
    if (this.statsCache && now - this.statsCache.at < STATS_TTL_MS) {
      return this.statsCache.value
    }
    await this.init()

    const result: AudioCacheStats = {
      persistent: { count: 0, bytes: 0 },
      ephemeral: { count: 0, bytes: 0 },
      quotaBytes: undefined,
      usageBytes: undefined,
    }

    if (this.db) {
      const tx = this.db.transaction(STORE, 'readonly')
      const idx = tx.objectStore(STORE).index('by-lifecycle')
      let cursor = await idx.openCursor()
      while (cursor) {
        const row = cursor.value
        const bucket = row.lifecycle === 'persistent' ? result.persistent : result.ephemeral
        bucket.count++
        bucket.bytes += row.size
        cursor = await cursor.continue()
      }
      await tx.done
    }

    // Best-effort quota/usage read.
    try {
      if (typeof navigator !== 'undefined') {
        const storage = (navigator as Navigator & { storage?: StorageManager }).storage
        if (storage?.estimate) {
          const est = await storage.estimate()
          result.quotaBytes = est.quota
          result.usageBytes = est.usage
        }
      }
    } catch {
      // Leave undefined.
    }

    this.statsCache = { at: now, value: result }
    return result
  }

  /**
   * Close the underlying IndexedDB connection. Primarily for tests so
   * `indexedDB.deleteDatabase` isn't blocked by a held connection.
   * After close(), the next API call lazily re-opens.
   */
  close(): void {
    if (this.db) {
      this.db.close()
      this.db = null
      this.initPromise = null
    }
    this.persistentIds.clear()
    this.ephemeralIds.clear()
    this.inflight.clear()
    this.legoAborts.clear()
    // Revoke any outstanding WAV blob URLs so they don't leak across a close/
    // re-open (and so a stale URL can't survive the DB being recreated).
    for (const url of this.wavUrlCache.values()) URL.revokeObjectURL(url)
    this.wavUrlCache.clear()
    this.statsCache = null
  }
}
