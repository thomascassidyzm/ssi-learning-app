import { describe, expect, it, vi } from 'vitest'
import { createEnvelopeMetadataCache } from './useEnvelopeMetadataCache'

type RouteResult = { data: any[] | null; error: { message: string } | null }

class FakeQuery {
  inFilter: { column: string; values: any[] } | null = null
  constructor(private handler: (q: FakeQuery) => RouteResult) {}
  select() { return this }
  in(column: string, values: any[]) { this.inFilter = { column, values }; return this }
  then(resolve: (r: RouteResult) => void, reject?: (e: unknown) => void) {
    try {
      resolve(this.handler(this))
    } catch (e) {
      reject?.(e)
    }
  }
}

function makeFakeClient(handler: (q: FakeQuery) => RouteResult) {
  return {
    from: () => new FakeQuery(handler),
  } as any
}

const ROW = {
  audio_id: 'a1',
  duration_ms: 900,
  peak_count: 3,
  peak_to_mean_ratio: 2.1,
  mean_peak_width_ms: 120,
  extractor_version: 1,
}

describe('createEnvelopeMetadataCache', () => {
  it('fetches and camelCases rows found in the batch', async () => {
    const client = makeFakeClient(() => ({ data: [ROW], error: null }))
    const cache = createEnvelopeMetadataCache(client)

    await cache.fetchBatch(['a1'])

    expect(cache.get('a1')).toEqual({
      audioId: 'a1',
      durationMs: 900,
      peakCount: 3,
      peakToMeanRatio: 2.1,
      meanPeakWidthMs: 120,
      extractorVersion: 1,
    })
  })

  it('caches confirmed-missing ids as null (course without envelope rows yet)', async () => {
    const client = makeFakeClient(() => ({ data: [], error: null }))
    const cache = createEnvelopeMetadataCache(client)

    await cache.fetchBatch(['missing-1'])

    expect(cache.get('missing-1')).toBeNull()
  })

  it('leaves unfetched ids as undefined until fetchBatch is called', () => {
    const client = makeFakeClient(() => ({ data: [], error: null }))
    const cache = createEnvelopeMetadataCache(client)

    expect(cache.get('never-fetched')).toBeUndefined()
  })

  it('does not re-fetch ids already cached (hit or miss)', async () => {
    const handler = vi.fn(() => ({ data: [ROW], error: null }))
    const client = makeFakeClient(handler)
    const cache = createEnvelopeMetadataCache(client)

    await cache.fetchBatch(['a1'])
    await cache.fetchBatch(['a1'])

    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('a fetch failure leaves ids uncached (undefined) for retry, never poisons as null', async () => {
    const client = makeFakeClient(() => ({ data: null, error: { message: 'network down' } }))
    const cache = createEnvelopeMetadataCache(client)
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await cache.fetchBatch(['a1'])

    expect(cache.get('a1')).toBeUndefined()
    warnSpy.mockRestore()
  })

  it('chunks large id lists under the PostgREST in()-list cap', async () => {
    const seen: number[] = []
    const client = makeFakeClient((q) => {
      seen.push(q.inFilter!.values.length)
      return { data: [], error: null }
    })
    const cache = createEnvelopeMetadataCache(client)

    const ids = Array.from({ length: 320 }, (_, i) => `id-${i}`)
    await cache.fetchBatch(ids)

    expect(seen).toEqual([150, 150, 20])
  })
})
