import { describe, expect, it, vi } from 'vitest'
import {
  bulkDownloadAudio,
  fetchBatchAudioUrls,
  type BatchUrlsResult,
  type BulkAudioDownloadCounters,
  type BulkAudioDownloadDeps,
} from './bulkAudioDownload'

function makeDeps(overrides: Partial<BulkAudioDownloadDeps> = {}): BulkAudioDownloadDeps {
  return {
    fetchBatchUrls: async (ids) => ({
      urls: Object.fromEntries(ids.map((id) => [id, `https://s3.example.com/${id}`])),
      denied: [],
    }),
    ensureFromUrl: async () => {},
    ensure: async () => {},
    isCancelled: () => false,
    isPlaying: () => false,
    ...overrides,
  }
}

interface Counts { done: number; failed: number }

function makeCounters(): { counters: BulkAudioDownloadCounters; counts: Counts } {
  const counts: Counts = { done: 0, failed: 0 }
  return {
    counters: {
      onDone: () => { counts.done++ },
      onFailed: () => { counts.failed++ },
    },
    counts,
  }
}

describe('bulkDownloadAudio', () => {
  it('resolves immediately for an empty id list', async () => {
    const { counters, counts } = makeCounters()
    const result = await bulkDownloadAudio([], makeDeps(), counters)
    expect(result).toBe(true)
    expect(counts.done).toBe(0)
    expect(counts.failed).toBe(0)
  })

  it('downloads every id via ensureFromUrl when batch-urls succeeds for all', async () => {
    const ensureFromUrl = vi.fn(async () => {})
    const ensure = vi.fn(async () => {})
    const { counters, counts } = makeCounters()

    const result = await bulkDownloadAudio(['a', 'b', 'c'], makeDeps({ ensureFromUrl, ensure }), counters)

    expect(result).toBe(true)
    expect(ensureFromUrl).toHaveBeenCalledTimes(3)
    expect(ensure).not.toHaveBeenCalled()
    expect(counts.done).toBe(3)
    expect(counts.failed).toBe(0)
  })

  it('falls back to the proxy path entirely when the batch endpoint fails', async () => {
    const fetchBatchUrls = vi.fn(async () => null)
    const ensureFromUrl = vi.fn(async () => {})
    const ensure = vi.fn(async () => {})
    const { counters, counts } = makeCounters()

    const result = await bulkDownloadAudio(['a', 'b'], makeDeps({ fetchBatchUrls, ensureFromUrl, ensure }), counters)

    expect(result).toBe(true)
    expect(ensureFromUrl).not.toHaveBeenCalled()
    expect(ensure).toHaveBeenCalledTimes(2)
    expect(ensure).toHaveBeenCalledWith('a')
    expect(ensure).toHaveBeenCalledWith('b')
    expect(counts.done).toBe(2)
    expect(counts.failed).toBe(0)
  })

  it('falls back only denied ids to the proxy path', async () => {
    const fetchBatchUrls = vi.fn(async (ids: string[]): Promise<BatchUrlsResult> => ({
      urls: Object.fromEntries(ids.filter((id) => id !== 'b').map((id) => [id, `https://s3.example.com/${id}`])),
      denied: ids.includes('b') ? ['b'] : [],
    }))
    const ensureFromUrl = vi.fn(async () => {})
    const ensure = vi.fn(async () => {})
    const { counters, counts } = makeCounters()

    const result = await bulkDownloadAudio(['a', 'b', 'c'], makeDeps({ fetchBatchUrls, ensureFromUrl, ensure }), counters)

    expect(result).toBe(true)
    expect(ensureFromUrl).toHaveBeenCalledTimes(2)
    expect(ensureFromUrl).toHaveBeenCalledWith('a', 'https://s3.example.com/a')
    expect(ensureFromUrl).toHaveBeenCalledWith('c', 'https://s3.example.com/c')
    expect(ensure).toHaveBeenCalledTimes(1)
    expect(ensure).toHaveBeenCalledWith('b')
    expect(counts.done).toBe(3)
  })

  it('falls back an individual id to the proxy path when its direct fetch fails after retries', async () => {
    const ensureFromUrl = vi.fn(async (id: string) => {
      if (id === 'b') throw new Error('S3 fetch failed')
    })
    const ensure = vi.fn(async () => {})
    const { counters, counts } = makeCounters()

    const result = await bulkDownloadAudio(
      ['a', 'b'],
      makeDeps({ ensureFromUrl, ensure }),
      counters,
    )

    expect(result).toBe(true)
    // 'b' retried 3x on the direct path, then fell back to ensure().
    expect(ensureFromUrl).toHaveBeenCalledWith('b', expect.any(String))
    expect(ensure).toHaveBeenCalledTimes(1)
    expect(ensure).toHaveBeenCalledWith('b')
    expect(counts.done).toBe(2)
    expect(counts.failed).toBe(0)
  })

  it('counts a proxy failure after retries as failed, never throws', async () => {
    const fetchBatchUrls = vi.fn(async () => null)
    const ensure = vi.fn(async () => { throw new Error('proxy down') })
    const { counters, counts } = makeCounters()

    const result = await bulkDownloadAudio(['a'], makeDeps({ fetchBatchUrls, ensure }), counters)

    expect(result).toBe(true)
    expect(counts.done).toBe(0)
    expect(counts.failed).toBe(1)
  })

  it('stops and returns false when cancelled before the batch-url request', async () => {
    const fetchBatchUrls = vi.fn(async () => ({ urls: {}, denied: [] }))
    const { counters, counts } = makeCounters()

    const result = await bulkDownloadAudio(
      ['a'],
      makeDeps({ fetchBatchUrls, isCancelled: () => true }),
      counters,
    )

    expect(result).toBe(false)
    expect(fetchBatchUrls).not.toHaveBeenCalled()
    expect(counts.done).toBe(0)
    expect(counts.failed).toBe(0)
  })

  it('requests batch-urls in chunks of up to 500 ids', async () => {
    const ids = Array.from({ length: 1200 }, (_, i) => `id-${i}`)
    const fetchBatchUrls = vi.fn(async (chunk: string[]): Promise<BatchUrlsResult> => ({
      urls: Object.fromEntries(chunk.map((id) => [id, `https://s3.example.com/${id}`])),
      denied: [],
    }))
    const { counters, counts } = makeCounters()

    const result = await bulkDownloadAudio(ids, makeDeps({ fetchBatchUrls }), counters)

    expect(result).toBe(true)
    expect(fetchBatchUrls).toHaveBeenCalledTimes(3) // 500 + 500 + 200
    for (const call of fetchBatchUrls.mock.calls) {
      expect(call[0].length).toBeLessThanOrEqual(500)
    }
    expect(counts.done).toBe(1200)
  })

  it('resolves URLs just-in-time: each chunk downloads before the next chunk is requested', async () => {
    const ids = Array.from({ length: 600 }, (_, i) => `id-${i}`)
    const events: string[] = []
    const fetchBatchUrls = vi.fn(async (chunk: string[]): Promise<BatchUrlsResult> => {
      events.push('batch')
      return {
        urls: Object.fromEntries(chunk.map((id) => [id, `https://s3.example.com/${id}`])),
        denied: [],
      }
    })
    const ensureFromUrl = vi.fn(async () => { events.push('download') })
    const { counters, counts } = makeCounters()

    const result = await bulkDownloadAudio(ids, makeDeps({ fetchBatchUrls, ensureFromUrl }), counters)

    expect(result).toBe(true)
    expect(fetchBatchUrls).toHaveBeenCalledTimes(2) // 500 + 100, never all upfront
    const secondBatchAt = events.indexOf('batch', events.indexOf('batch') + 1)
    const firstDownloadAt = events.indexOf('download')
    // Chunk 1's downloads run before chunk 2's URLs are requested.
    expect(firstDownloadAt).toBeGreaterThan(-1)
    expect(secondBatchAt).toBeGreaterThan(firstDownloadAt)
    expect(events.slice(0, secondBatchAt).filter((e) => e === 'download')).toHaveLength(500)
    expect(counts.done).toBe(600)
  })

  it('re-requests a fresh URL on 403 (expired) instead of retrying or proxying', async () => {
    const ids = Array.from({ length: 600 }, (_, i) => `id-${i}`)
    let batchCall = 0
    const fetchBatchUrls = vi.fn(async (chunk: string[]): Promise<BatchUrlsResult> => {
      batchCall++
      return {
        urls: Object.fromEntries(chunk.map((id) => [id, `https://s3.example.com/${id}?v=${batchCall}`])),
        denied: [],
        ttlSeconds: 300,
      }
    })
    // Chunk 2's original URLs (v=2) are expired; refreshed URLs (v>=3) work.
    const ensureFromUrl = vi.fn(async (id: string, url: string) => {
      if (url.endsWith('?v=2')) throw new Error(`AudioCache: fetch ${id} → 403`)
    })
    const ensure = vi.fn(async () => {})
    const { counters, counts } = makeCounters()

    const result = await bulkDownloadAudio(ids, makeDeps({ fetchBatchUrls, ensureFromUrl, ensure }), counters)

    expect(result).toBe(true)
    expect(ensure).not.toHaveBeenCalled() // fresh URLs succeeded — no proxy fallback
    expect(counts.done).toBe(600)
    expect(counts.failed).toBe(0)
    // Each expired URL was tried exactly once — no blind retries on a dead URL.
    const deadUrlCalls = ensureFromUrl.mock.calls.filter(([, url]) => url.endsWith('?v=2'))
    expect(deadUrlCalls).toHaveLength(100)
    // One fresh-URL re-request per expired id (calls 3..102), on top of the 2 chunk requests.
    expect(fetchBatchUrls).toHaveBeenCalledTimes(102)
  })

  it('batch-refreshes remaining URLs when a chunk outlives the TTL safety margin', async () => {
    const ids = Array.from({ length: 30 }, (_, i) => `id-${i}`)
    let t = 0
    let batchCall = 0
    const fetchBatchUrls = vi.fn(async (chunk: string[]): Promise<BatchUrlsResult> => {
      batchCall++
      return {
        urls: Object.fromEntries(chunk.map((id) => [id, `https://s3.example.com/${id}?v=${batchCall}`])),
        denied: [],
        ttlSeconds: 300,
      }
    })
    const downloadedUrls: string[] = []
    const ensureFromUrl = vi.fn(async (_id: string, url: string) => {
      downloadedUrls.push(url)
      t = 200_000 // first dispatch pushes the clock past 60% of the 300s TTL
    })
    const { counters, counts } = makeCounters()

    const result = await bulkDownloadAudio(
      ids,
      makeDeps({ fetchBatchUrls, ensureFromUrl, now: () => t }),
      counters,
    )

    expect(result).toBe(true)
    expect(counts.done).toBe(30)
    // First dispatch of 24 used the original URLs; the remaining 6 were
    // re-requested in one batch before dispatch, not sent stale.
    expect(fetchBatchUrls).toHaveBeenCalledTimes(2)
    expect(fetchBatchUrls.mock.calls[1][0]).toHaveLength(6)
    expect(downloadedUrls.slice(24).every((u) => u.endsWith('?v=2'))).toBe(true)
  })

  it('uses higher concurrency while idle than while playing (direct path)', async () => {
    let concurrentPeak = 0
    let inFlight = 0
    const ensureFromUrl = vi.fn(async () => {
      inFlight++
      concurrentPeak = Math.max(concurrentPeak, inFlight)
      await new Promise((r) => setTimeout(r, 5))
      inFlight--
    })
    const ids = Array.from({ length: 30 }, (_, i) => `id-${i}`)
    const { counters } = makeCounters()

    await bulkDownloadAudio(ids, makeDeps({ ensureFromUrl, isPlaying: () => false }), counters)

    expect(concurrentPeak).toBeGreaterThan(6) // idle concurrency (24) exceeds the playing cap
  })
})

describe('fetchBatchAudioUrls', () => {
  const originalFetch = globalThis.fetch

  it('returns urls, denied and ttlSeconds on a 200 response', async () => {
    globalThis.fetch = vi.fn(async () => new Response(
      JSON.stringify({ urls: { a: 'https://s3/a' }, denied: ['b'], ttlSeconds: 300 }),
      { status: 200 },
    )) as unknown as typeof fetch

    const result = await fetchBatchAudioUrls(['a', 'b'])
    expect(result).toEqual({ urls: { a: 'https://s3/a' }, denied: ['b'], ttlSeconds: 300 })

    globalThis.fetch = originalFetch
  })

  it('returns null on a non-ok response', async () => {
    globalThis.fetch = vi.fn(async () => new Response('not found', { status: 404 })) as unknown as typeof fetch

    const result = await fetchBatchAudioUrls(['a'])
    expect(result).toBeNull()

    globalThis.fetch = originalFetch
  })

  it('returns null when fetch throws (network error)', async () => {
    globalThis.fetch = vi.fn(async () => { throw new Error('network down') }) as unknown as typeof fetch

    const result = await fetchBatchAudioUrls(['a'])
    expect(result).toBeNull()

    globalThis.fetch = originalFetch
  })

  it('defaults denied to [] and leaves ttlSeconds unset when the response omits them', async () => {
    globalThis.fetch = vi.fn(async () => new Response(
      JSON.stringify({ urls: { a: 'https://s3/a' } }),
      { status: 200 },
    )) as unknown as typeof fetch

    const result = await fetchBatchAudioUrls(['a'])
    expect(result).toEqual({ urls: { a: 'https://s3/a' }, denied: [] })
    expect(result?.ttlSeconds).toBeUndefined()

    globalThis.fetch = originalFetch
  })
})
