/**
 * useInstantPlayback — prefetchTier3 REPORTS what happened.
 *
 * Tier 3 is the fetch of the next NEW LEGO: it walks the round-map to the round
 * AFTER the one playing and pulls its cycles. Tom's ruling of 2026-08-31 makes
 * the failure of exactly this fetch the one and only trigger for PRACTISING
 * mode — so the outcome has to leave this function instead of dying in a
 * console.warn, which is what it did before.
 *
 * The four outcomes must stay distinguishable, and one distinction is
 * load-bearing beyond the others: 'no-next' (the course has no round after this
 * one) is a fact about the CONTENT and must never be confused with 'failed'.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref } from 'vue'
import { useInstantPlayback } from './useInstantPlayback'

/**
 * A course that is NOT bundle-enabled — these tests are about the NETWORK
 * path's outcome reporting, and must not be silently rerouted onto the bundle
 * path the day their course joins the cutover.
 */
const NETWORK_PATH_COURSE = 'ita_for_eng'

const ROUND_MAP = {
  course_code: NETWORK_PATH_COURSE,
  version: 1,
  rounds: [
    { r: 1, legoId: 'S0001L01', seed: 1 },
    { r: 2, legoId: 'S0002L01', seed: 2 },
  ],
}

const CYCLES_PAGE = {
  course_code: NETWORK_PATH_COURSE,
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
}

/** Serve the round-map from the network, and route /cycles to `onCycles`. */
function stubFetch(onCycles: () => Promise<unknown>) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (String(url).includes('/round-map')) {
      return { ok: true, status: 200, statusText: 'OK', json: async () => ROUND_MAP }
    }
    return onCycles()
  }))
}

async function playerAtFirstRound() {
  const instant = useInstantPlayback(ref(NETWORK_PATH_COURSE), {
    resolveStartLegoId: () => null,
  })
  // The composable's own boot path sets `roundMap` from bootstrap(); these
  // tests are about tier 3 alone, so the map is placed directly.
  instant.roundMap.value = await instant.getOrFetchRoundMap()
  instant.setCurrentLegoId('S0001L01')
  return instant
}

describe('useInstantPlayback — the next-new-LEGO fetch outcome', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it("reports 'fetched' when the next round's cycles arrive", async () => {
    stubFetch(async () => ({
      ok: true, status: 200, statusText: 'OK', json: async () => CYCLES_PAGE,
    }))
    const instant = await playerAtFirstRound()
    expect(await instant.prefetchTier3()).toBe('fetched')
  })

  it("reports 'failed' when the next new LEGO cannot be had at all", async () => {
    // Nothing cached for S0002L01, and the network is gone: fetchCycles has
    // already tried this device's own copy before it throws, so reaching the
    // caller with 'failed' means genuinely unreachable.
    stubFetch(async () => { throw new Error('Failed to fetch') })
    const instant = await playerAtFirstRound()
    expect(await instant.prefetchTier3()).toBe('failed')
  })

  it("reports 'no-next' at the end of the course, NOT 'failed'", async () => {
    stubFetch(async () => { throw new Error('should never be called') })
    const instant = await playerAtFirstRound()
    instant.setCurrentLegoId('S0002L01') // the last round in the map
    expect(await instant.prefetchTier3()).toBe('no-next')
  })

  it("reports 'skipped' when there is nothing to ask about yet", async () => {
    const instant = useInstantPlayback(ref(NETWORK_PATH_COURSE), {
      resolveStartLegoId: () => null,
    })
    // No round-map fetched, no current LEGO — we never asked, so this must not
    // enter the mode and must not end it either.
    expect(await instant.prefetchTier3()).toBe('skipped')
  })
})
