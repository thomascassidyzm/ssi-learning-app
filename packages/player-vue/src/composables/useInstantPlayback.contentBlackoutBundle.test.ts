/**
 * The blackout must also close the BUNDLE door — the one that matters most.
 *
 * Fifteen courses are on the bundle cutover list, and on those `fetchCycles`
 * answers from one whole-course bundle held in IndexedDB without touching the
 * network at all. That is exactly why airplane mode cannot show a learner
 * practising mode on those courses, and it is exactly what would make an
 * admin test switch a no-op on them.
 *
 * So this file kills the network entirely and hands the composable a working
 * bundle. With the switch OFF the bundle answers and the outcome is 'fetched' —
 * proving the bundle path is genuinely live here and the test is not passing
 * vacuously. With the switch ON the same setup must report 'failed'.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref } from 'vue'

const ROUNDS = [
  { r: 1, legoId: 'S0001L01', seed: 1 },
  { r: 2, legoId: 'S0002L01', seed: 2 },
]

vi.mock('./useCourseBundle', () => ({
  // The bundle's contents are irrelevant here — the projections below are
  // mocked too. What matters is that a bundle EXISTS and resolves instantly.
  getCourseBundle: vi.fn(async () => ({ courseCode: 'spa_for_eng' })),
  getCachedCourseBundle: vi.fn(async () => null),
  setCourseBundleAuthProvider: vi.fn(),
}))

vi.mock('../providers/bundleToBackendCycles', () => ({
  ID_ONLY: (id: string) => id,
  bundleToRoundMap: () => ({ course_code: 'spa_for_eng', version: 1, rounds: ROUNDS }),
  bundleToCyclesResponse: () => ({
    course_code: 'spa_for_eng',
    version: 1,
    cycles: [
      {
        id: 'c-1',
        type: 'intro',
        lego_id: 'S0002L01',
        seed_number: 2,
        known_text: 'I want',
        target_text: 'quiero',
        audio: {},
        durations: {},
        is_new: true,
      },
    ],
    next_lego_id: null,
  }),
  bundleToInfPlayBatch: () => ({ cycles: [], next_round: null }),
}))

import { useInstantPlayback } from './useInstantPlayback'
import { setContentBlackout, resetContentBlackout } from '../playback/contentBlackout'

/** A course on the bundle cutover list. */
const BUNDLE_COURSE = 'spa_for_eng'

async function playerAtFirstRound() {
  const instant = useInstantPlayback(ref(BUNDLE_COURSE), { resolveStartLegoId: () => null })
  instant.roundMap.value = await instant.getOrFetchRoundMap()
  instant.setCurrentLegoId('S0001L01')
  return instant
}

describe('content blackout on a bundle-enabled course', () => {
  beforeEach(() => {
    localStorage.clear()
    resetContentBlackout()
    // No network of any kind. Anything that reports 'fetched' from here can
    // only have come from the bundle.
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    }))
  })
  afterEach(() => {
    resetContentBlackout()
    vi.unstubAllGlobals()
  })

  it("answers 'fetched' from the bundle with no network — the door the switch must close", async () => {
    const instant = await playerAtFirstRound()
    expect(await instant.prefetchTier3()).toBe('fetched')
  })

  it("reports 'failed' once the blackout declines the bundle", async () => {
    const instant = await playerAtFirstRound()
    setContentBlackout(true)
    expect(await instant.prefetchTier3()).toBe('failed')
  })

  it('reopens the bundle door when turned off, so recovery is watchable here too', async () => {
    const instant = await playerAtFirstRound()
    setContentBlackout(true)
    expect(await instant.prefetchTier3()).toBe('failed')
    setContentBlackout(false)
    expect(await instant.prefetchTier3()).toBe('fetched')
  })
})
