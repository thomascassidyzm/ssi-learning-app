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
    const hang = new Promise<string>(() => {})
    const settled = withNetworkTimeout(hang)
    await vi.advanceTimersByTimeAsync(CRITICAL_PATH_TIMEOUT_MS + 1)
    expect(await settled).toBe(NETWORK_TIMEOUT)
    expect(isNetworkPresumedDown()).toBe(true)
  })

  it('a success after a stall clears the observation', async () => {
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
    expect(isOfflineish()).toBe(true)
  })

  it('does not swallow a real rejection — a 403 is not the same as a hang', async () => {
    await expect(withNetworkTimeout(Promise.reject(new Error('403')))).rejects.toThrow('403')
  })
})
