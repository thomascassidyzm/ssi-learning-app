/**
 * useInstantPlayback — "play what you have".
 *
 * Tom's ruling, 2026-08-15:
 *
 *   "If there's very little signal, but app is not in offline mode. It should
 *    not check online for the handshake, it should just be ready from the
 *    cache. If phone is in airplane mode it should ALSO play whatever it has
 *    in the cache rather than do nothing. … people might not have remembered
 *    to put the app in offline mode deliberately. … Play what you have.
 *    Verify access as and when you can. Never as a gate."
 *
 * Cases named for the ways a learner actually loses the network. All of them
 * must reach playable cycles from cache, and none of them ever sets the offline
 * toggle — so every case here IS the "learner forgot to flip it" case, which is
 * what retires the deliberate/accidental distinction.
 *
 * The weak-signal cases also carry the TWO-STRIKE rule (networkGate, Tom's
 * ruling 2026-09-04) at the level where it actually bites — a real boot through
 * this composable, not the gate in isolation. `networkGate.test.ts` proves the
 * counting; these prove the JOIN: what one aborted boot, two aborted boots, and
 * a boot that succeeded in between each do to `isNetworkPresumedDown()`, which
 * is the signal that decides whether the rest of the app draws itself as
 * offline. One 2.5s abort on a full 5G signal once drew a learner's whole belt
 * strip as "not downloaded"; that is the bug these cases stand guard over.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref } from 'vue'
import { useInstantPlayback, type CyclesResponse, type RoundMap } from './useInstantPlayback'
import { __resetNetworkGateForTests, isNetworkPresumedDown } from '../config/networkGate'

const START_LEGO = 'S0007L01'

// Each case gets its OWN course code. useInstantPlayback coalesces concurrent
// identical GETs in a module-level map keyed by URL, and a deliberately-hung
// request stays in that map until its own 9s leak-guard fires — so sharing one
// course code would let the weak-signal case's hung fetch be handed to the
// cases that follow it. (Harmless in production, where the caller's 2.5s
// budget and the cache fallback absorb it; fatal to reading these assertions.)
function mapFor(course: string): RoundMap {
  return {
    course_code: course,
    version: 4,
    rounds: [
      { r: 1, legoId: 'S0001L01', seed: 1 },
      { r: 7, legoId: START_LEGO, seed: 7 },
    ],
  }
}

function cyclesFixture(course: string, n: number): CyclesResponse {
  return {
    course_code: course,
    version: 4,
    next_lego_id: null,
    cycles: Array.from({ length: n }, (_, i) => ({
      id: `c${i}`,
      type: i === 0 ? 'intro' : 'use',
      lego_id: START_LEGO,
      seed_number: 7,
      known_text: `known ${i}`,
      target_text: `target ${i}`,
      audio: { known_id: `k${i}`, target1_id: `t1${i}`, target2_id: `t2${i}` },
      durations: {},
      is_new: i === 1,
    })) as CyclesResponse['cycles'],
  }
}

/** Put a warm cache on the device — the state a returning learner is in. */
function warmTheCache(course: string, cycles?: CyclesResponse): void {
  localStorage.setItem(
    'ssi-instant-playback-roundmap-' + course,
    JSON.stringify({ map: mapFor(course), cachedAt: 1 }),
  )
  localStorage.setItem(
    `ssi-instant-playback-cycles-${course}-${START_LEGO}`,
    JSON.stringify({ response: cycles ?? cyclesFixture(course, 6), cachedAt: 1 }),
  )
}

function bootFromCurrentPosition(course: string) {
  return useInstantPlayback(ref(course), { resolveStartLegoId: () => START_LEGO })
}

/**
 * A cache entry SHORTER than BOOTSTRAP_LIMIT and stamped at an older version —
 * so the happy-path cached reader deliberately refuses it and the boot is
 * forced onto the network, where only the last-resort reader will serve it.
 * That is the real weak-signal shape, and it is the only shape that puts a
 * boot in front of the network gate at all.
 */
function warmStaleCache(course: string, n = 3): void {
  warmTheCache(course, { ...cyclesFixture(course, n), version: 3, next_lego_id: 'S0008L01' })
}

/**
 * Hangs forever unless aborted — the captive-portal / one-bar case that
 * `navigator.onLine` reports as "online". A boot against this stub spends its
 * full critical-path budget and then aborts, which is exactly ONE strike.
 */
function stubHangingFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      (_url: string, init?: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const err = new Error('The operation was aborted')
            err.name = 'AbortError'
            reject(err)
          })
        }),
    ),
  )
}

/** A link that works. A boot against this stub is a critical-path SUCCESS. */
function stubHealthyFetch(course: string): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      url.includes('/cycles')
        ? new Response(JSON.stringify(cyclesFixture(course, 6)), { status: 200 })
        : new Response(JSON.stringify(mapFor(course)), { status: 200 }),
    ),
  )
}

/**
 * Drive one whole boot across the 2500ms critical-path budget on fake timers.
 * Advancing past the budget is what makes a hanging fetch abort; it is inert
 * for a healthy one, which has already answered on microtasks.
 */
async function bootAcrossTheBudget(course: string) {
  const instant = bootFromCurrentPosition(course)
  const settled = instant.bootstrap().then(
    (r) => ({ ok: true as const, r }),
    (e) => ({ ok: false as const, e }),
  )
  // Nothing has been served at the 2.4s mark — the budget has not expired.
  await vi.advanceTimersByTimeAsync(2400)
  // Cross the 2500ms budget: the caller detaches from any hanging request.
  await vi.advanceTimersByTimeAsync(400)
  return { instant, outcome: await settled }
}

describe('useInstantPlayback — never gate playback on the network', () => {
  beforeEach(() => {
    localStorage.clear()
    __resetNetworkGateForTests()
    vi.unstubAllGlobals()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('airplane mode, cache warm: every request fails instantly and cached cycles still reach playback', async () => {
    const course = 'cym_for_eng_airplane'
    warmTheCache(course)
    // Airplane mode is not a hang — it is an immediate transport rejection.
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))))

    const instant = bootFromCurrentPosition(course)
    const result = await instant.bootstrap()

    expect(result.firstCycle.lego_id).toBe(START_LEGO)
    expect(instant.getBufferedCyclesForLego(START_LEGO)).toHaveLength(6)
    expect(instant.isReady.value).toBe(true)
  })

  it('weak signal, cache warm: playback starts on the budget, and ONE aborted boot does NOT presume the network down', async () => {
    const course = 'cym_for_eng_weak'
    warmStaleCache(course)
    vi.useFakeTimers()
    stubHangingFetch()

    const { instant, outcome } = await bootAcrossTheBudget(course)

    // The learner plays. That is the whole point of the budget.
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.r.firstCycle.lego_id).toBe(START_LEGO)
    expect(instant.getBufferedCyclesForLego(START_LEGO)).toHaveLength(3)

    // And the app stays on its LIVE paths. This is the join this file is
    // uniquely placed to prove: a real boot through the composable, aborting
    // on its budget, records exactly ONE strike — and one strike is noise, not
    // evidence. A single unlucky request must not flip offlinePlaybackActive
    // or draw the belt strip as "not downloaded" for a learner on full signal.
    expect(isNetworkPresumedDown()).toBe(false)
  })

  it('two consecutive aborted boots, with no success between, DO presume the network down', async () => {
    vi.useFakeTimers()
    stubHangingFetch()

    warmStaleCache('cym_for_eng_two_a')
    await bootAcrossTheBudget('cym_for_eng_two_a')
    expect(isNetworkPresumedDown()).toBe(false)

    // Second strike: a pattern, not noise. NOW the rest of the app is entitled
    // to serve its cached paths.
    warmStaleCache('cym_for_eng_two_b')
    const { instant, outcome } = await bootAcrossTheBudget('cym_for_eng_two_b')
    expect(isNetworkPresumedDown()).toBe(true)

    // Playback never depended on that signal either way.
    expect(outcome.ok).toBe(true)
    expect(instant.getBufferedCyclesForLego(START_LEGO)).toHaveLength(3)
  })

  it('a successful boot between two aborted ones resets the count — no strike carries over', async () => {
    vi.useFakeTimers()

    // Strike one.
    stubHangingFetch()
    warmStaleCache('cym_for_eng_reset_a')
    await bootAcrossTheBudget('cym_for_eng_reset_a')
    expect(isNetworkPresumedDown()).toBe(false)

    // A boot that reaches the server. Recovery is immediate and unconditional:
    // the count goes back to zero, it is not merely decremented.
    stubHealthyFetch('cym_for_eng_reset_b')
    warmStaleCache('cym_for_eng_reset_b')
    const healthy = await bootAcrossTheBudget('cym_for_eng_reset_b')
    expect(healthy.outcome.ok).toBe(true)
    expect(healthy.instant.getBufferedCyclesForLego(START_LEGO)).toHaveLength(6)
    expect(isNetworkPresumedDown()).toBe(false)

    // The next failure is therefore a FIRST strike again, not a second one.
    stubHangingFetch()
    warmStaleCache('cym_for_eng_reset_c')
    await bootAcrossTheBudget('cym_for_eng_reset_c')
    expect(isNetworkPresumedDown()).toBe(false)
  })

  it('deliberate offline toggle OFF, no connectivity, cache warm: identical to airplane mode', async () => {
    // The point of this case. Nothing here opts in to offline mode — no
    // toggle, no persisted `ssi-offline-mode-<course>` key, no lease. The
    // learner simply forgot. They must get the same playback as one who
    // remembered.
    const course = 'cym_for_eng_forgot'
    warmTheCache(course)
    expect(localStorage.getItem('ssi-offline-mode-' + course)).toBeNull()
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))))

    const instant = bootFromCurrentPosition(course)
    const result = await instant.bootstrap()

    expect(result.firstCycle.lego_id).toBe(START_LEGO)
    expect(instant.getBufferedCyclesForLego(START_LEGO)).toHaveLength(6)
  })

  it('a 403 from the entitlement gate serves the cache instead of locking the learner out', async () => {
    // "Verify access as and when you can. Never as a gate." A learner whose
    // entitlement check cannot be completed keeps playing what they already
    // downloaded; the check retries on its own next time.
    const course = 'cym_for_eng_403'
    warmTheCache(course, { ...cyclesFixture(course, 4), version: 3, next_lego_id: 'S0008L01' })
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.includes('/cycles')
          ? new Response('{}', { status: 403, statusText: 'Forbidden' })
          : new Response(JSON.stringify(mapFor(course)), { status: 200 }),
      ),
    )

    const instant = bootFromCurrentPosition(course)
    const result = await instant.bootstrap()

    expect(result.firstCycle.lego_id).toBe(START_LEGO)
    expect(instant.getBufferedCyclesForLego(START_LEGO)).toHaveLength(4)
  })

  it('airplane mode with a genuinely EMPTY cache still fails — the one honest failure', async () => {
    // Nothing cached means nothing to play. bootstrap must reject so the
    // caller can show the "connect once and download" message, rather than
    // pretend it has content.
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))))

    const instant = bootFromCurrentPosition('cym_for_eng_empty')
    await expect(instant.bootstrap()).rejects.toBeTruthy()
  })
})
