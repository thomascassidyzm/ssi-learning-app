/**
 * useInstantPlayback — in-flight request coalescing.
 *
 * On a COLD course switch, prewarmInstantCaches (fire-and-forget on select),
 * the player-mount bootstrap, the resume resolver's getOrFetchRoundMap, and the
 * post-cache-hit revalidate all fire the SAME round-map / cycles GETs and race
 * each other — every one misses the not-yet-written localStorage cache and
 * fetches cold, turning one round-map + one cycles fetch into ×3 (prewarm was
 * ADDING load instead of preventing it). The coalescer collapses concurrent
 * identical GETs to one shared fetch, cleared on settle.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref } from 'vue'
import { useInstantPlayback, prewarmInstantCaches } from './useInstantPlayback'

const ROUND_MAP = {
  course_code: 'coalesce_test',
  version: 7,
  rounds: [{ r: 1, legoId: 'S0001L01', seed: 1 }],
}
const CYCLES = {
  course_code: 'coalesce_test',
  version: 7,
  next_lego_id: null,
  cycles: [
    {
      id: 'c1',
      type: 'intro',
      lego_id: 'S0001L01',
      seed_number: 1,
      known_text: 'hello',
      target_text: 'bonjour',
      audio: {},
      durations: {},
      is_new: true,
    },
  ],
}

function makeCountingFetch() {
  const counts = { roundMap: 0, cycles: 0, audio: 0 }
  const fetchMock = vi.fn((url: string) => {
    if (url.includes('/round-map')) {
      counts.roundMap++
      return Promise.resolve({ ok: true, status: 200, statusText: 'OK', json: () => Promise.resolve(ROUND_MAP) })
    }
    if (url.includes('/cycles')) {
      counts.cycles++
      return Promise.resolve({ ok: true, status: 200, statusText: 'OK', json: () => Promise.resolve(CYCLES) })
    }
    // /api/audio/* precache — fire-and-forget, not part of the boot GETs.
    counts.audio++
    return Promise.resolve({ ok: true, status: 200, statusText: 'OK' })
  })
  return { counts, fetchMock }
}

describe('useInstantPlayback — coalescing', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
    try { localStorage.clear() } catch { /* no localStorage in this env */ }
  })

  it('two concurrent prewarms for the same course share ONE round-map and ONE cycles fetch', async () => {
    const { counts, fetchMock } = makeCountingFetch()
    vi.stubGlobal('fetch', fetchMock)

    // Fire both synchronously (no await between) so the second reaches the
    // coalescer while the first's fetch is still in flight — the exact race
    // prewarm-vs-mount hits on a cold switch.
    await Promise.all([
      prewarmInstantCaches('coalesce_test'),
      prewarmInstantCaches('coalesce_test'),
    ])

    expect(counts.roundMap).toBe(1)
    expect(counts.cycles).toBe(1)
  })

  it('prewarm racing a cold bootstrap fetches round-map and cycles once each', async () => {
    const { counts, fetchMock } = makeCountingFetch()
    vi.stubGlobal('fetch', fetchMock)

    const instant = useInstantPlayback(ref('coalesce_test'), {
      resolveStartLegoId: () => null,
    })

    // Kick both off with no await between — prewarm (fire-and-forget) and the
    // mount bootstrap racing on a cold cache.
    const p1 = prewarmInstantCaches('coalesce_test')
    const p2 = instant.bootstrap()
    await Promise.all([p1, p2])

    expect(counts.roundMap).toBe(1)
    expect(counts.cycles).toBe(1)
  })

  it('a later fetch (after the first settles) is NOT suppressed — the entry clears on settle', async () => {
    const { counts, fetchMock } = makeCountingFetch()
    vi.stubGlobal('fetch', fetchMock)

    // First prewarm fully settles and writes localStorage...
    await prewarmInstantCaches('coalesce_test')
    expect(counts.roundMap).toBe(1)

    // ...a fresh composable with a cache-cleared window still reaches the
    // network on its own miss (coalescing dedupes concurrency, never caches
    // the promise past settle). Clear the localStorage the first write left so
    // this second pass is a genuine cold fetch, not a cache hit.
    localStorage.clear()
    const instant = useInstantPlayback(ref('coalesce_test'), { resolveStartLegoId: () => null })
    await instant.bootstrap()
    expect(counts.roundMap).toBe(2)
  })
})
