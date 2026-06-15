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
  courseCode: string | null
  cachedAt: number
  lastAccessedAt: number
  ephemeralOwnerLegoId: string | null
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

  // Offline WAV blob URLs, keyed by audio id — decoded once and reused for
  // repeated clips (spaced rep replays the same audio). See getWavBlobUrl.
  private readonly wavUrlCache: Map<string, string> = new Map()

  /** In-flight ensure/acquire de-dupe: one Promise per id. */
  private readonly inflight: Map<string, Promise<void>> = new Map()

  /** Per-lego abort controllers — release aborts in-flight acquires. */
  private readonly legoAborts: Map<string, AbortController> = new Map()

  /** stats() cache to avoid hammering IndexedDB. */
  private statsCache: { at: number; value: AudioCacheStats } | null = null

  private readonly audioUrl: (id: AudioId) => string

  readonly persistent: PersistentNamespace
  readonly ephemeral: EphemeralNamespace

  constructor(options: CreateAudioCacheOptions = {}) {
    this.audioUrl = options.audioUrl ?? ((id) => `/api/audio/${id}`)

    // Bind namespace facades to `this`.
    this.persistent = {
      ensure: (id) => this.persistentEnsure(id),
      has: (id) => this.persistentIds.has(id),
      getBlobUrl: (id) => this.getBlobUrl(id),
      evictToTarget: (targetBytes) => this.persistentEvictToTarget(targetBytes),
    }
    this.ephemeral = {
      acquireForLego: (set) => this.ephemeralAcquireForLego(set),
      releaseForLego: (legoId) => this.ephemeralReleaseForLego(legoId),
      has: (id) => this.ephemeralIds.has(id),
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
      cursor = await cursor.continue()
    }
    await tx.done
  }

  // ==========================================================================
  // PERSISTENT
  // ==========================================================================

  private persistentEnsure(id: AudioId): Promise<void> {
    if (this.persistentIds.has(id)) return Promise.resolve()
    const existing = this.inflight.get(id)
    if (existing) return existing

    const p = this.doFetchAndStore(id, {
      lifecycle: 'persistent',
      ephemeralOwnerLegoId: null,
    })
      .finally(() => {
        this.inflight.delete(id)
      })
    this.inflight.set(id, p)
    return p
  }

  private async doFetchAndStore(
    id: AudioId,
    opts: { lifecycle: AudioLifecycle; ephemeralOwnerLegoId: string | null; signal?: AbortSignal },
  ): Promise<void> {
    await this.init()
    if (!this.db) throw new Error('AudioCache: DB not initialized')

    // If already cached in either namespace, persistent wins — skip duplicate.
    if (this.persistentIds.has(id)) return
    if (opts.lifecycle === 'ephemeral' && this.ephemeralIds.has(id)) return

    // Cross-namespace promotion: id is already cached as ephemeral and the
    // caller wants it persistent. Rewrite the existing row's lifecycle in
    // place instead of re-fetching, and move it between the in-memory Sets.
    if (opts.lifecycle === 'persistent' && this.ephemeralIds.has(id)) {
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

    const res = await fetch(this.audioUrl(id), opts.signal ? { signal: opts.signal } : undefined)
    if (!res.ok) {
      throw new Error(`AudioCache: fetch ${id} → ${res.status}`)
    }
    const blob = await res.blob()

    if (opts.signal?.aborted) {
      // Caller already abandoned us; don't persist.
      throw new DOMException('Aborted', 'AbortError')
    }

    const now = Date.now()
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
    }
    await this.db.put(STORE, row)

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
      // Persistent wins — never duplicate.
      if (this.persistentIds.has(id)) continue
      if (this.ephemeralIds.has(id)) continue
      const existing = this.inflight.get(id)
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
          this.inflight.delete(id)
        })
      this.inflight.set(id, p)
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
    return this.persistentIds.has(id) || this.ephemeralIds.has(id)
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
    await this.init()
    if (!this.db) return null
    const row = await this.db.get(STORE, id)
    if (!row) return null
    const wav = await bytesToWavBlob(await row.blob.arrayBuffer())
    if (!wav) return null
    const url = URL.createObjectURL(wav)
    this.wavUrlCache.set(id, url)
    return url
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

  // ==========================================================================
  // CLEAR
  // ==========================================================================

  async clearCourse(courseCode: string): Promise<void> {
    await this.init()
    if (!this.db) return

    const tx = this.db.transaction(STORE, 'readwrite')
    const idx = tx.objectStore(STORE).index('by-course')
    let cursor = await idx.openCursor(IDBKeyRange.only(courseCode))
    while (cursor) {
      const row = cursor.value
      if (row.lifecycle === 'persistent') this.persistentIds.delete(row.id)
      else this.ephemeralIds.delete(row.id)
      const staleWavUrl = this.wavUrlCache.get(row.id)
      if (staleWavUrl) { URL.revokeObjectURL(staleWavUrl); this.wavUrlCache.delete(row.id) }
      await cursor.delete()
      cursor = await cursor.continue()
    }
    await tx.done

    this.statsCache = null
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
