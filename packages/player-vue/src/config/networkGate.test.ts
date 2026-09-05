/**
 * networkGate — the shared "never gate the learner on the network" primitive.
 *
 * The behaviour that matters: a weak connection is detected by OBSERVING a
 * stall, not by asking `navigator.onLine` (which reports online on one bar and
 * behind captive portals). Everything downstream — offlinePlaybackActive, the
 * listening surfaces' cache-first branches — reads that observation.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  CRITICAL_PATH_TIMEOUT_MS,
  NETWORK_TIMEOUT,
  withNetworkTimeout,
  isNetworkPresumedDown,
  isOfflineish,
  markNetworkStalled,
  clearNetworkStalled,
  __resetNetworkGateForTests,
} from './networkGate'

describe('networkGate', () => {
  beforeEach(() => {
    __resetNetworkGateForTests()
    vi.unstubAllGlobals()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('returns the value when the network answers inside the budget', async () => {
    const r = await withNetworkTimeout(Promise.resolve('cycles'))
    expect(r).toBe('cycles')
    expect(isNetworkPresumedDown()).toBe(false)
  })

  it('returns the sentinel instead of hanging, and records the stall', async () => {
    vi.useFakeTimers()
    const hang = () => withNetworkTimeout(new Promise<string>(() => {}))
    const first = hang()
    await vi.advanceTimersByTimeAsync(CRITICAL_PATH_TIMEOUT_MS + 1)
    expect(await first).toBe(NETWORK_TIMEOUT)
    // ONE timeout is not evidence — see the two-strike test below.
    expect(isNetworkPresumedDown()).toBe(false)
    const second = hang()
    await vi.advanceTimersByTimeAsync(CRITICAL_PATH_TIMEOUT_MS + 1)
    expect(await second).toBe(NETWORK_TIMEOUT)
    expect(isNetworkPresumedDown()).toBe(true)
  })

  /**
   * The bug this rule exists for: one 2.5s abort on /round-map, on a full 5G
   * signal, put the app into "presumed offline" for a whole minute — and the
   * belt strip drew every belt as not-downloaded (Tom's screenshots,
   * 2026-09-04).
   */
  it('one failure alone does NOT presume the network down', () => {
    markNetworkStalled()
    expect(isNetworkPresumedDown()).toBe(false)
  })

  it('two failures in a row do', () => {
    markNetworkStalled()
    markNetworkStalled()
    expect(isNetworkPresumedDown()).toBe(true)
  })

  it('a success between two failures resets the count — no strike carries over', () => {
    markNetworkStalled()
    clearNetworkStalled()
    markNetworkStalled()
    expect(isNetworkPresumedDown()).toBe(false)
  })

  it('the presumption expires after the (shortened) TTL', () => {
    vi.useFakeTimers()
    markNetworkStalled()
    markNetworkStalled()
    expect(isNetworkPresumedDown()).toBe(true)
    vi.advanceTimersByTime(20_001)
    expect(isNetworkPresumedDown()).toBe(false)
    // …and the strikes went with it: the next single failure starts clean.
    markNetworkStalled()
    expect(isNetworkPresumedDown()).toBe(false)
  })

  it('a success after a stall clears the observation', async () => {
    markNetworkStalled()
    markNetworkStalled()
    expect(isNetworkPresumedDown()).toBe(true)
    await withNetworkTimeout(Promise.resolve(1))
    expect(isNetworkPresumedDown()).toBe(false)
  })

  it('isOfflineish trusts navigator.onLine only when it admits being offline', () => {
    vi.stubGlobal('navigator', { onLine: false })
    expect(isOfflineish()).toBe(true)

    // The weak-signal lie: the browser claims online, nothing completes.
    vi.stubGlobal('navigator', { onLine: true })
    expect(isOfflineish()).toBe(false)
    markNetworkStalled()
    markNetworkStalled()
    expect(isOfflineish()).toBe(true)
  })

  it('does not swallow a real rejection — a 403 is not the same as a hang', async () => {
    await expect(withNetworkTimeout(Promise.reject(new Error('403')))).rejects.toThrow('403')
  })
})
