/**
 * servedPod tests.
 *
 * The contract this file exists to hold (Tom's 2026-08-22 1-based ruling):
 *  1. `pod-1` wins when the course has one (hrv, the first course on the new
 *     convention).
 *  2. `pod-0` when that is all there is — the ~68 older courses must not
 *     change behaviour by a single query.
 *  3. A pod PARKED off the serving slugs (`pod-0-unrecorded` on 37 courses,
 *     `pod-0-gated-2026-08-06` on 2) still reads as "no pods yet". This is the
 *     release gate; a resolver that widened would publish 39 unrecorded pods.
 *  4. Any query failure degrades to `pod-0` — today's behaviour — never to
 *     "no pods".
 *  5. One round-trip per course per session, shared by all five call sites.
 */

import 'fake-indexeddb/auto'
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { resolveServedPod, resetServedPodCache, FALLBACK_POD_SLUG } from './servedPod'
import { __resetNetworkGateForTests } from '../config/networkGate'

/** Fake client returning the given listening_pods rows, counting round-trips. */
function makeClient(
  rows: Array<{ slug: string; pod_type?: string }> | null,
  error: { message: string } | null = null,
) {
  const calls = { count: 0, lastFilters: {} as Record<string, unknown> }
  const client = {
    from(table: string) {
      const filters: Record<string, unknown> = {}
      const chain: any = {
        select: () => chain,
        eq: (col: string, val: unknown) => { filters[col] = val; return chain },
        in: (col: string, vals: unknown[]) => { filters[col] = vals; return chain },
        then: (resolve: (r: unknown) => void) => {
          if (table !== 'listening_pods') return resolve({ data: null, error: null })
          calls.count += 1
          calls.lastFilters = filters
          // Mirror the server: the `.in('slug', …)` filter is applied there,
          // so a parked slug never even comes back over the wire.
          const allowed = filters.slug as string[] | undefined
          const data = rows?.filter(
            (r) => (!allowed || allowed.includes(r.slug)) &&
              (filters.pod_type === undefined || (r.pod_type ?? 'core') === filters.pod_type),
          ) ?? null
          return resolve({ data: error ? null : data, error })
        },
      }
      return chain
    },
  } as any
  return { client, calls }
}

beforeEach(() => {
  resetServedPodCache()
  __resetNetworkGateForTests()
})
afterEach(() => {
  vi.restoreAllMocks()
  resetServedPodCache()
})

describe('resolveServedPod', () => {
  it('prefers pod-1 when the course has one (hrv, the first 1-based course)', async () => {
    const { client } = makeClient([{ slug: 'pod-1' }, { slug: 'pod-0' }])
    const served = await resolveServedPod(client, 'hrv_for_eng')
    expect(served.slug).toBe('pod-1')
    expect(served.podId).toBe('hrv_for_eng:pod-1')
  })

  it('falls back to pod-0 for the ~68 courses that only have pod-0', async () => {
    const { client } = makeClient([{ slug: 'pod-0' }])
    const served = await resolveServedPod(client, 'spa_for_eng_v2')
    expect(served.slug).toBe('pod-0')
    expect(served.podId).toBe('spa_for_eng_v2:pod-0')
  })

  it('still reads "no pods" for a course whose only pod is parked on pod-0-unrecorded', async () => {
    // The release gate. The parked pod exists and is pod_type=core — the
    // resolver must not see it as servable. Deliberately a SYNTHETIC course
    // code: no real course should be named here, because whether any given
    // course is currently parked is live data that moves under the test.
    const { client } = makeClient([{ slug: 'pod-0-unrecorded' }])
    const served = await resolveServedPod(client, 'parked_for_eng')
    // pod-0 is the answer, and pod-0 holds no sentences for such a course —
    // so every learner path reads "no pods yet", exactly as before.
    expect(served.slug).toBe(FALLBACK_POD_SLUG)
    expect(served.podId).toBe('parked_for_eng:pod-0')
  })

  it('ignores every non-serving slug: parked cores, retired pods, choice pods', async () => {
    const { client } = makeClient([
      { slug: 'pod-0-gated-2026-08-06' },
      { slug: 'pod-1-retired-2026-08-22' },
      { slug: 'travel-situations', pod_type: 'choice' },
    ])
    const served = await resolveServedPod(client, 'parked2_for_eng')
    expect(served.slug).toBe('pod-0')
  })

  it('serves a course that has BOTH a real pod-0 and a parked working copy', async () => {
    // The common live shape (37 courses carry a pod-0-unrecorded alongside a
    // served pod-0). Parking a working copy must never take the live pod away.
    const { client } = makeClient([{ slug: 'pod-0' }, { slug: 'pod-0-unrecorded' }])
    expect((await resolveServedPod(client, 'cym_n_for_eng')).slug).toBe('pod-0')
  })

  it('falls back to pod-0 on a query error — degrade to today, never to "no pods"', async () => {
    const { client } = makeClient(null, { message: 'permission denied' })
    const served = await resolveServedPod(client, 'ita_for_eng')
    expect(served.slug).toBe('pod-0')
    expect(served.podId).toBe('ita_for_eng:pod-0')
  })

  it('falls back to pod-0 when the query REJECTS rather than returning an error', async () => {
    const client = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              in: () => ({ then: (_r: unknown, reject: (e: unknown) => void) => reject(new Error('Load failed')) }),
            }),
          }),
        }),
      }),
    } as any
    const served = await resolveServedPod(client, 'fra_for_eng')
    expect(served.slug).toBe('pod-0')
  })

  it('resolves pod-0 for a course with no pods at all', async () => {
    const { client } = makeClient([])
    expect((await resolveServedPod(client, 'new_course')).slug).toBe('pod-0')
  })

  it('memoises: five call sites, one round-trip', async () => {
    const { client, calls } = makeClient([{ slug: 'pod-1' }])
    const all = await Promise.all([
      resolveServedPod(client, 'hrv_for_eng'),
      resolveServedPod(client, 'hrv_for_eng'),
      resolveServedPod(client, 'hrv_for_eng'),
      resolveServedPod(client, 'hrv_for_eng'),
      resolveServedPod(client, 'hrv_for_eng'),
    ])
    expect(calls.count).toBe(1)
    expect(all.every((s) => s.slug === 'pod-1')).toBe(true)
    // and a later caller still gets the settled answer without a new query
    expect((await resolveServedPod(client, 'hrv_for_eng')).slug).toBe('pod-1')
    expect(calls.count).toBe(1)
  })

  it('restricts the query to core pods and the two serving slugs', async () => {
    const { client, calls } = makeClient([{ slug: 'pod-0' }])
    await resolveServedPod(client, 'deu_for_eng')
    expect(calls.lastFilters.course_code).toBe('deu_for_eng')
    expect(calls.lastFilters.pod_type).toBe('core')
    expect(calls.lastFilters.slug).toEqual(['pod-1', 'pod-0'])
  })
})

describe('resolveServedPod — offline lane', () => {
  it('uses the slug the download snapshot was built from, with no network call', async () => {
    const { fetchAndCacheListeningMeta, getCachedListeningMeta } = await import('./listeningMetaCache')
    // Download Croatian while online and serving pod-1.
    const online = makeFullClient([{ slug: 'pod-1' }])
    await fetchAndCacheListeningMeta(online, 'hrv_for_eng')
    expect((await getCachedListeningMeta('hrv_for_eng'))!.podSlug).toBe('pod-1')

    // Now go offline. A doomed query would resolve pod-0 and leave the learner
    // reading a pod they never downloaded.
    resetServedPodCache()
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    const { client, calls } = makeClient([{ slug: 'pod-0' }])
    const served = await resolveServedPod(client, 'hrv_for_eng')
    expect(served.slug).toBe('pod-1')
    expect(calls.count).toBe(0) // no round-trip at all
  })

  it('never resurrects a parked slug from the cache', async () => {
    const { getCachedListeningMeta } = await import('./listeningMetaCache')
    // Hand-write a snapshot claiming a parked slug (belt-and-braces: the
    // writer can only ever store a serving slug, but the gate lives here too).
    const online = makeFullClient([{ slug: 'pod-0' }])
    const { fetchAndCacheListeningMeta } = await import('./listeningMetaCache')
    await fetchAndCacheListeningMeta(online, 'gate_course')
    const entry = (await getCachedListeningMeta('gate_course'))!
    const { openDB } = await import('idb')
    const db = await openDB('ssi-listening-meta', 1)
    await db.put('meta', { ...entry, podSlug: 'pod-0-unrecorded' }, 'v2:gate_course')

    resetServedPodCache()
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    const { client } = makeClient([])
    expect((await resolveServedPod(client, 'gate_course')).slug).toBe('pod-0')
  })
})

/** A client that answers every table the meta download touches. */
function makeFullClient(pods: Array<{ slug: string }>) {
  return {
    from(table: string) {
      const filters: Record<string, unknown> = {}
      const chain: any = {
        select: () => chain,
        eq: (c: string, v: unknown) => { filters[c] = v; return chain },
        in: (c: string, v: unknown[]) => { filters[c] = v; return chain },
        order: () => chain,
        range: () => chain,
        limit: () => chain,
        maybeSingle: () => chain,
        then: (resolve: (r: unknown) => void) => {
          if (table === 'listening_pods') {
            const allowed = filters.slug as string[] | undefined
            return resolve({
              data: pods.filter((p) => !allowed || allowed.includes(p.slug)),
              error: null,
            })
          }
          return resolve({ data: [], error: null })
        },
      }
      return chain
    },
  } as any
}
