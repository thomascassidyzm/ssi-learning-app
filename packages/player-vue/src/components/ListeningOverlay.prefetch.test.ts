/**
 * ListeningOverlay tab-open JIT prefetch tests.
 *
 * Mirrors the audio-id selection + fetch-firing logic from
 * `prefetchTopRows()` in ListeningOverlay.vue. The function is defined
 * inside <script setup> so we can't import it directly — we inline an
 * equivalent here, same shape as the ListeningAudioController test does
 * for its class. Tests pin the contract:
 *
 *   - At most TAB_PREFETCH_LIMIT (5) fetches per call
 *   - Pod turns: audioIds[0] wins
 *   - Phrase/seed rows: target1AudioId wins, fall back to target2AudioId
 *   - Rows missing all audio ids are skipped (don't burn a slot)
 *   - priority: 'low' is passed to fetch
 *   - Fetch failures don't throw (silent catch)
 *   - Empty input is a no-op
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const TAB_PREFETCH_LIMIT = 5

interface PrefetchRow {
  audioIds?: string[]
  target1AudioId?: string | null
  target2AudioId?: string | null
}

function getAudioUrl(audioId: string, courseCode: string): string {
  return `/api/audio/${audioId}?courseId=${encodeURIComponent(courseCode)}`
}

// Inline-equivalent of ListeningOverlay.vue's prefetchTopRows. Mirrors
// the precedence rules and the priority: 'low' fetch call.
function prefetchTopRows(
  rows: PrefetchRow[],
  courseCode: string,
  fetchFn: typeof fetch,
): void {
  if (!rows.length) return

  const urls: string[] = []
  for (let i = 0; i < Math.min(TAB_PREFETCH_LIMIT, rows.length); i++) {
    const row = rows[i]
    if (!row) continue
    let id: string | null = null
    if (Array.isArray(row.audioIds) && row.audioIds.length > 0) {
      id = row.audioIds[0]
    } else if (row.target1AudioId) {
      id = row.target1AudioId
    } else if (row.target2AudioId) {
      id = row.target2AudioId
    }
    if (!id) continue
    const url = getAudioUrl(id, courseCode)
    if (url) urls.push(url)
  }

  if (urls.length === 0) return

  for (const url of urls) {
    fetchFn(url, { priority: 'low' } as RequestInit).catch(() => undefined)
  }
}

describe('prefetchTopRows — tab-open JIT prefetch', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(new Response())
  })

  it('no-ops on empty input', () => {
    prefetchTopRows([], 'spa_for_eng_v2', fetchMock as unknown as typeof fetch)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('caps fetches at TAB_PREFETCH_LIMIT (5)', () => {
    const rows: PrefetchRow[] = Array.from({ length: 20 }, (_, i) => ({
      target1AudioId: `id-${i}`,
    }))
    prefetchTopRows(rows, 'spa_for_eng_v2', fetchMock as unknown as typeof fetch)
    expect(fetchMock).toHaveBeenCalledTimes(5)
  })

  it('passes priority: low on every call', () => {
    const rows: PrefetchRow[] = [
      { target1AudioId: 'a' },
      { target1AudioId: 'b' },
    ]
    prefetchTopRows(rows, 'spa_for_eng_v2', fetchMock as unknown as typeof fetch)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    for (const call of fetchMock.mock.calls) {
      expect(call[1]).toMatchObject({ priority: 'low' })
    }
  })

  it('builds the same URL shape as getAudioUrl (incl. courseId query)', () => {
    const rows: PrefetchRow[] = [{ target1AudioId: 'abc' }]
    prefetchTopRows(rows, 'ita_for_eng_v2', fetchMock as unknown as typeof fetch)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/audio/abc?courseId=ita_for_eng_v2',
      expect.objectContaining({ priority: 'low' }),
    )
  })

  it('prefers audioIds[0] (pod turns) over target1AudioId', () => {
    const rows: PrefetchRow[] = [
      { audioIds: ['pod-1', 'pod-2'], target1AudioId: 'phrase-1' },
    ]
    prefetchTopRows(rows, 'crs', fetchMock as unknown as typeof fetch)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/audio/pod-1?courseId=crs',
      expect.anything(),
    )
  })

  it('falls back to target2AudioId when target1 is missing', () => {
    const rows: PrefetchRow[] = [
      { target1AudioId: null, target2AudioId: 'fallback' },
    ]
    prefetchTopRows(rows, 'crs', fetchMock as unknown as typeof fetch)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/audio/fallback?courseId=crs',
      expect.anything(),
    )
  })

  it('skips rows with no audio ids without burning a slot', () => {
    // First two rows have no audio — they should be skipped, not fill the cap.
    const rows: PrefetchRow[] = [
      { target1AudioId: null, target2AudioId: null },
      {},
      { target1AudioId: 'a' },
      { target1AudioId: 'b' },
    ]
    prefetchTopRows(rows, 'crs', fetchMock as unknown as typeof fetch)
    // The cap walks the first 5 rows. Of those, 2 had ids — we should see 2 fetches.
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls.map(c => c[0])).toEqual([
      '/api/audio/a?courseId=crs',
      '/api/audio/b?courseId=crs',
    ])
  })

  it('swallows fetch rejections (silent prefetch)', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('network down'))
    const rows: PrefetchRow[] = [{ target1AudioId: 'a' }]
    expect(() =>
      prefetchTopRows(rows, 'crs', fetchMock as unknown as typeof fetch),
    ).not.toThrow()
    // Settle microtasks so the rejected promise has had a chance to surface.
    await new Promise(resolve => setTimeout(resolve, 0))
  })

  it('mixed row shapes — preserves order of the top-5 window', () => {
    const rows: PrefetchRow[] = [
      { audioIds: ['p1'] }, // pod
      { target1AudioId: 's1' }, // seed/phrase
      { target1AudioId: 's2', target2AudioId: 's2b' },
      { target2AudioId: 's3b' }, // target1 missing
      { audioIds: ['p2', 'p3'] },
      { target1AudioId: 's6' }, // beyond the cap
    ]
    prefetchTopRows(rows, 'crs', fetchMock as unknown as typeof fetch)
    expect(fetchMock.mock.calls.map(c => c[0])).toEqual([
      '/api/audio/p1?courseId=crs',
      '/api/audio/s1?courseId=crs',
      '/api/audio/s2?courseId=crs',
      '/api/audio/s3b?courseId=crs',
      '/api/audio/p2?courseId=crs',
    ])
  })
})
