/**
 * prewarmInstantCaches — a flagged course must warm the first cycle's AUDIO,
 * not just its round map.
 *
 * `prewarmInstantCaches` is the intent hook: it runs on course switch, before
 * the player remounts, so the mount is a cache hit rather than a cold
 * round-trip. The legacy branch has always finished by fetching the first
 * cycle's clips — presentation, known, target1, target2 — because those are
 * what the learner actually hears when they tap.
 *
 * The bundle cutover added an early `return` for flagged courses that stopped
 * after the round map, silently dropping that warm-up. This pins it: on a
 * flagged course the prewarm still reaches the clips, and it gets the cycle
 * metadata out of the bundle rather than off the network.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { prewarmInstantCaches } from './useInstantPlayback'
import * as bundleStore from './useCourseBundle'
import * as toCycles from '../providers/bundleToBackendCycles'

/** On the cutover list — see BUNDLE_BOOTSTRAP_COURSES. */
const BUNDLE_COURSE = 'hun_for_eng'

describe('prewarmInstantCaches — first-clip warm on a bundle course', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('fetches the first cycle\'s clips, and reads the cycles from the bundle', async () => {
    const fakeBundle = { courseCode: BUNDLE_COURSE } as never

    vi.spyOn(bundleStore, 'getCourseBundle').mockResolvedValue(fakeBundle)
    vi.spyOn(toCycles, 'bundleToRoundMap').mockReturnValue({
      version: 1,
      rounds: [{ legoId: 'S0001L01', roundIndex: 1 }],
    } as never)
    const toCyclesSpy = vi.spyOn(toCycles, 'bundleToCyclesResponse').mockReturnValue({
      cycles: [
        {
          audio: {
            presentation_id: 'pres-1',
            known_id: 'known-1',
            target1_id: 't1-1',
            target2_id: 't2-1',
          },
        },
      ],
      next_lego_id: null,
    } as never)

    const fetched: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        fetched.push(String(url))
        return Promise.resolve({ ok: true, status: 200, json: async () => ({}) })
      }),
    )

    await prewarmInstantCaches(BUNDLE_COURSE)

    // The cycles came from the bundle in memory, not from /cycles.
    expect(toCyclesSpy).toHaveBeenCalledWith(fakeBundle, 'S0001L01', expect.any(Number))
    expect(fetched.some((u) => u.includes('/cycles'))).toBe(false)
    expect(fetched.some((u) => u.includes('/round-map'))).toBe(false)

    // ...and all four clips of the opening cycle were warmed.
    for (const id of ['pres-1', 'known-1', 't1-1', 't2-1']) {
      expect(fetched).toContain(`/api/audio/${id}`)
    }
  })

  it('never throws when the bundle is unavailable — a prewarm is best-effort', async () => {
    vi.spyOn(bundleStore, 'getCourseBundle').mockRejectedValue(new Error('offline'))
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
    await expect(prewarmInstantCaches(BUNDLE_COURSE)).resolves.toBeUndefined()
  })
})
