/**
 * The admin CONTENT BLACKOUT test switch, proved at the level that matters.
 *
 * The switch exists so PRACTISING mode can be watched on a real device, and its
 * whole claim is that it is HONEST: it does not raise the mode, it takes the
 * content away and lets the app's own trigger fire. So what has to be asserted
 * is that `prefetchTier3` — the one fetch the mode listens to — comes back
 * 'failed' with the switch on and 'fetched' with it off, on a course whose
 * cycles a healthy network would serve without complaint.
 *
 * Two escape hatches would make the switch a lie, and both are covered:
 *   • the BUNDLE path, which answers a bundle-enabled course's cycles from
 *     IndexedDB with no network at all, and
 *   • the CYCLES CACHE, which our own one-round-ahead prefetch has usually
 *     already filled for the exact round tier 3 asks for.
 * Either one left open and the switch reports 'fetched' while claiming the
 * content is unreachable.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref } from 'vue'
import { useInstantPlayback } from './useInstantPlayback'
import {
  isContentBlackoutActive,
  setContentBlackout,
  resetContentBlackout,
} from '../playback/contentBlackout'

const NETWORK_COURSE = 'ita_for_eng'

const roundMap = (code: string) => ({
  course_code: code,
  version: 1,
  rounds: [
    { r: 1, legoId: 'S0001L01', seed: 1 },
    { r: 2, legoId: 'S0002L01', seed: 2 },
  ],
})

const cyclesPage = (code: string) => ({
  course_code: code,
  version: 1,
  cycles: [
    {
      id: 'c-1',
      type: 'intro',
      lego_id: 'S0002L01',
      seed_number: 2,
      known_text: 'I want',
      target_text: 'voglio',
      audio: {},
      durations: {},
      is_new: true,
    },
  ],
  next_lego_id: null,
})

function stubHealthyNetwork(code: string) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const u = String(url)
    if (u.includes('/round-map')) {
      return { ok: true, status: 200, statusText: 'OK', json: async () => roundMap(code) }
    }
    return { ok: true, status: 200, statusText: 'OK', json: async () => cyclesPage(code) }
  }))
}

async function playerAtFirstRound(code: string) {
  const instant = useInstantPlayback(ref(code), { resolveStartLegoId: () => null })
  instant.roundMap.value = await instant.getOrFetchRoundMap()
  instant.setCurrentLegoId('S0001L01')
  return instant
}

describe('content blackout — the admin practising-mode test switch', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
    resetContentBlackout()
  })
  afterEach(() => resetContentBlackout())

  it("says 'skipped' — never 'no-next' — when the cursor is not in the round map", async () => {
    // 'no-next' is a claim about the CONTENT: there is nothing after this, the
    // course has ended. A cursor we cannot find in the map is a claim about
    // OURSELVES. Both leave the mode alone, so behaviour is unchanged — but
    // conflating them made the practising telemetry lie about which happened,
    // and that is precisely the read that had to be made after Tom's session
    // and could not be (2026-08-31).
    stubHealthyNetwork(NETWORK_COURSE)
    const instant = await playerAtFirstRound(NETWORK_COURSE)
    instant.setCurrentLegoId('S9999L99')
    expect(await instant.prefetchTier3()).toBe('skipped')
    // And the genuine end of the map still reads as the course's own end.
    instant.setCurrentLegoId('S0002L01')
    expect(await instant.prefetchTier3()).toBe('no-next')
  })

  it('is off at rest, so no learner is ever in it by accident', () => {
    expect(isContentBlackoutActive()).toBe(false)
  })

  it('never persists — a fresh module state is always off', () => {
    setContentBlackout(true)
    expect(isContentBlackoutActive()).toBe(true)
    // Nothing was written anywhere that a restart could read back.
    expect(
      Object.keys(localStorage).filter((k) => k.toLowerCase().includes('blackout')),
    ).toEqual([])
  })

  it("turns the healthy next-new-LEGO fetch from 'fetched' into 'failed'", async () => {
    stubHealthyNetwork(NETWORK_COURSE)
    const instant = await playerAtFirstRound(NETWORK_COURSE)

    // Same network, same course, same round — the ONLY difference is the switch.
    expect(await instant.prefetchTier3()).toBe('fetched')
    setContentBlackout(true)
    expect(await instant.prefetchTier3()).toBe('failed')
  })

  it("restores 'fetched' the moment it is turned off, which is the recovery half", async () => {
    stubHealthyNetwork(NETWORK_COURSE)
    const instant = await playerAtFirstRound(NETWORK_COURSE)
    setContentBlackout(true)
    expect(await instant.prefetchTier3()).toBe('failed')
    setContentBlackout(false)
    expect(await instant.prefetchTier3()).toBe('fetched')
  })

  it('is not defeated by the cycles cache our own prefetch just filled', async () => {
    stubHealthyNetwork(NETWORK_COURSE)
    const instant = await playerAtFirstRound(NETWORK_COURSE)
    // This call write-through caches S0002L01 — exactly what tier 3 asks for
    // next. Without the cache bypass the blackout below would read that copy
    // back and report 'fetched'.
    expect(await instant.prefetchTier3()).toBe('fetched')
    setContentBlackout(true)
    expect(await instant.prefetchTier3()).toBe('failed')
  })

  it('reports its new state back so a caller renders from the source of truth', () => {
    expect(setContentBlackout(true)).toBe(true)
    expect(setContentBlackout(false)).toBe(false)
  })
})
