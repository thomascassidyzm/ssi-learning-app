/**
 * AudioCache — revision-aware admission.
 *
 * Repaired audio is swapped IN PLACE at the same `course_audio.id` (a new id
 * would CASCADE into `lego_introductions` and destroy authored intro
 * scripts). The `?v=<rev>` URL busts the HTTP and service-worker caches, but
 * IndexedDB is keyed by the BARE id — without these rules a device that
 * already played the damaged clip serves it from IndexedDB forever and the
 * repair is invisible.
 *
 * The four rules, and why each one matters:
 *   same revision      -> HIT   (no pointless refetch)
 *   higher revision    -> MISS  (the repair lands)
 *   stored unknown     -> MISS  (cached before revisions existed, so it may
 *                                well BE the clip that got repaired)
 *   wanted unknown     -> HIT   (offline / pre-revision payload: never
 *                                invalidate on ignorance, or the app goes
 *                                silent the moment it loses network)
 */

import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openDB } from 'idb'
import { clearAudioRevisions, setAudioRevisions } from '@ssi/core'

import { resetAudioCacheForTesting } from './createAudioCache'
import { AudioCacheImpl } from './AudioCache'

vi.mock('./wav', () => ({
  bytesToWavBlob: vi.fn(async () => new Blob(['wav-bytes'], { type: 'audio/wav' })),
}))

const DB_NAME = 'ssi-audio-cache-v2'

/**
 * Fetch mock whose body LENGTH encodes the revision it was asked for, so a
 * test can prove the second fetch's bytes replaced the first's.
 *
 * Length rather than content because fake-indexeddb cannot round-trip a Blob
 * with a working `text()`/`arrayBuffer()` in this environment — it serialises
 * to a bare `{type}` object (same limitation the main AudioCache suite
 * documents). `size` survives the round-trip; the bytes do not.
 */
const BODY_BASE = 100

function bodySizeForRevision(rev: number | undefined): number {
  return BODY_BASE + (rev ?? 0)
}

function makeFetchMock() {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString()
    const m = url.match(/[?&]v=(\d+)/)
    const rev = m ? parseInt(m[1], 10) : undefined
    const blob = new Blob(['x'.repeat(bodySizeForRevision(rev))], { type: 'audio/mpeg' })
    return new Response(blob, { status: 200, headers: { 'Content-Type': 'audio/mpeg' } })
  })
}

async function readRow(id: string): Promise<
  { id: string; size: number; audioRevision?: number } | undefined
> {
  const db = await openDB(DB_NAME, 1)
  const row = (await db.get('audio', id)) as
    | { id: string; size: number; audioRevision?: number }
    | undefined
  db.close()
  return row
}

async function deleteDb(): Promise<void> {
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(DB_NAME)
    req.onsuccess = () => resolve()
    req.onerror = () => resolve()
    req.onblocked = () => resolve()
  })
}

/** The URLs the cache actually requested, in order. */
function urlsFrom(fetchMock: ReturnType<typeof makeFetchMock>): string[] {
  return fetchMock.mock.calls.map((c) => String(c[0]))
}

describe('AudioCache revision admission', () => {
  let cache: AudioCacheImpl
  let fetchMock: ReturnType<typeof makeFetchMock>
  let originalFetch: typeof globalThis.fetch
  let originalCreateObjectURL: typeof URL.createObjectURL
  let originalRevokeObjectURL: typeof URL.revokeObjectURL
  /** Closed in afterEach — an open handle blocks deleteDatabase forever. */
  const openCaches: AudioCacheImpl[] = []

  beforeEach(async () => {
    resetAudioCacheForTesting()
    clearAudioRevisions()

    fetchMock = makeFetchMock()
    originalFetch = globalThis.fetch
    globalThis.fetch = fetchMock as unknown as typeof fetch

    originalCreateObjectURL = URL.createObjectURL
    originalRevokeObjectURL = URL.revokeObjectURL
    let counter = 0
    URL.createObjectURL = vi.fn(
      () => `blob:fake-${++counter}`
    ) as unknown as typeof URL.createObjectURL
    URL.revokeObjectURL = vi.fn() as unknown as typeof URL.revokeObjectURL

    // Only safe once the previous test's caches have closed (afterEach).
    await deleteDb()

    cache = new AudioCacheImpl()
    openCaches.push(cache)
  })

  afterEach(async () => {
    for (const c of openCaches) {
      try {
        c.close()
      } catch {
        // already closed
      }
    }
    openCaches.length = 0
    globalThis.fetch = originalFetch
    URL.createObjectURL = originalCreateObjectURL
    URL.revokeObjectURL = originalRevokeObjectURL
    clearAudioRevisions()
  })

  it('same revision = HIT: the second ensure does not refetch', async () => {
    setAudioRevisions({ clip: 2 })

    await cache.persistent.ensure('clip')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(urlsFrom(fetchMock)[0]).toBe('/api/audio/clip?v=2')

    await cache.persistent.ensure('clip')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(cache.persistent.has('clip')).toBe(true)
  })

  it('higher revision = MISS, then OVERWRITE with the repaired bytes', async () => {
    setAudioRevisions({ clip: 2 })
    await cache.persistent.ensure('clip')
    expect((await readRow('clip'))!.size).toBe(bodySizeForRevision(2))
    expect((await readRow('clip'))!.audioRevision).toBe(2)

    // A repair lands: the backend now says revision 3.
    setAudioRevisions({ clip: 3 })
    expect(cache.persistent.has('clip')).toBe(false)

    await cache.persistent.ensure('clip')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(urlsFrom(fetchMock)[1]).toBe('/api/audio/clip?v=3')

    // Same key, replaced bytes, updated stamp — not a second row.
    const row = await readRow('clip')
    expect(row!.size).toBe(bodySizeForRevision(3))
    expect(row!.audioRevision).toBe(3)
    expect(cache.persistent.has('clip')).toBe(true)
  })

  it('unknown wanted revision = HIT: offline playback never breaks', async () => {
    // No revision was ever published for this clip — the normal case, and the
    // offline case. Ignorance must not invalidate anything.
    await cache.persistent.ensure('clip')
    expect(urlsFrom(fetchMock)[0]).toBe('/api/audio/clip')
    expect((await readRow('clip'))!.audioRevision).toBeUndefined()

    await cache.persistent.ensure('clip')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(cache.persistent.has('clip')).toBe(true)
    expect(await cache.persistent.getBlobUrl('clip')).toBeTruthy()
  })

  it('stored revision unknown + a revision now known = MISS', async () => {
    // Cached before revisions existed. We cannot tell whether these are the
    // bytes that got repaired, so we must assume they are.
    await cache.persistent.ensure('clip')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect((await readRow('clip'))!.audioRevision).toBeUndefined()

    setAudioRevisions({ clip: 2 })
    expect(cache.persistent.has('clip')).toBe(false)

    await cache.persistent.ensure('clip')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(urlsFrom(fetchMock)[1]).toBe('/api/audio/clip?v=2')
    expect((await readRow('clip'))!.audioRevision).toBe(2)
  })

  it('lower revision than stored = HIT: never downgrade to the damaged clip', async () => {
    setAudioRevisions({ clip: 5 })
    await cache.persistent.ensure('clip')
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // A stale cached payload republishing an older revision must not win.
    // (The registry itself merges monotonically, so this is belt-and-braces.)
    setAudioRevisions({ clip: 2 })
    await cache.persistent.ensure('clip')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('a failed refetch leaves the old bytes readable — degrade, never go silent', async () => {
    setAudioRevisions({ clip: 2 })
    await cache.persistent.ensure('clip')

    setAudioRevisions({ clip: 3 })
    fetchMock.mockImplementationOnce(async () => {
      throw new TypeError('Failed to fetch')
    })
    await expect(cache.persistent.ensure('clip')).rejects.toThrow()

    // Superseded, but still playable — clipped audio beats no audio.
    const row = await readRow('clip')
    expect(row!.size).toBe(bodySizeForRevision(2))
    expect(row!.audioRevision).toBe(2)
    expect(await cache.persistent.getBlobUrl('clip')).toBeTruthy()
  })

  it('the ephemeral namespace applies the same rules', async () => {
    setAudioRevisions({ clip: 2 })
    await cache.ephemeral.acquireForLego({ legoId: 'S0001L01', audioIds: ['clip'] })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await cache.ephemeral.acquireForLego({ legoId: 'S0001L01', audioIds: ['clip'] })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    setAudioRevisions({ clip: 3 })
    expect(cache.ephemeral.has('clip')).toBe(false)
    await cache.ephemeral.acquireForLego({ legoId: 'S0001L01', audioIds: ['clip'] })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(urlsFrom(fetchMock)[1]).toBe('/api/audio/clip?v=3')
  })

  it('an in-flight fetch at the old revision does not satisfy the new one', async () => {
    // The in-flight de-dupe map is keyed by bare id; if it stayed that way, a
    // request arriving mid-repair would be handed the pre-repair promise and
    // the repair would be silently dropped for that session.
    let release!: () => void
    const gate = new Promise<void>((r) => { release = r })
    fetchMock.mockImplementationOnce(async (input: RequestInfo | URL) => {
      await gate
      const url = typeof input === 'string' ? input : input.toString()
      const m = url.match(/[?&]v=(\d+)/)
      const rev = m ? parseInt(m[1], 10) : undefined
      return new Response(
        new Blob(['x'.repeat(bodySizeForRevision(rev))], { type: 'audio/mpeg' }),
        { status: 200 },
      )
    })

    setAudioRevisions({ clip: 2 })
    const first = cache.persistent.ensure('clip')

    setAudioRevisions({ clip: 3 })
    const second = cache.persistent.ensure('clip')
    expect(second).not.toBe(first)

    release()
    await Promise.all([first, second])
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(urlsFrom(fetchMock)).toContain('/api/audio/clip?v=3')
    expect((await readRow('clip'))!.audioRevision).toBe(3)
  })

  it('an overwrite revokes the cached decoded-WAV URL for that id', async () => {
    // The offline read path caches the mp3 -> WAV decode by bare id. If a
    // repair overwrote the bytes but left that decode in place, offline
    // playback would keep handing out the repaired-away audio.
    //
    // White-box: fake-indexeddb cannot round-trip a Blob with a working
    // arrayBuffer(), so getWavBlobUrl cannot run against stored rows here
    // (the main AudioCache suite stubs the DB for the same reason). Seed the
    // decode cache directly and assert the overwrite clears it.
    setAudioRevisions({ clip: 2 })
    await cache.persistent.ensure('clip')

    const wavUrls = (cache as unknown as { wavUrlCache: Map<string, string> }).wavUrlCache
    wavUrls.set('clip', 'blob:stale-wav')

    setAudioRevisions({ clip: 3 })
    await cache.persistent.ensure('clip')

    expect(wavUrls.has('clip')).toBe(false)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:stale-wav')
  })
})
