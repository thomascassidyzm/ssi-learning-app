/**
 * useInstantPlayback — auth token on the fast-path fetches.
 *
 * The /cycles + /infplay-cycles endpoints are entitlement-gated server-side
 * (d4396730): a PREMIUM course past the free-preview window (seed <=19) 403s any
 * caller the server can't see a valid session for. The instant-playback fetches
 * used to go out as bare GETs with no Authorization header, so a SIGNED-IN paid
 * learner past seed 19 was treated as anonymous → 403 → silent fallback to the
 * slow legacy walk. These tests lock in that the caller's Supabase access token
 * is attached to the round-map / cycles fetches, and that with no provider the
 * request still goes out anonymous (guests / free courses, unchanged).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref } from 'vue'
import {
  useInstantPlayback,
  prewarmInstantCaches,
  setInstantPlaybackAuthProvider,
} from './useInstantPlayback'

const ROUND_MAP = {
  course_code: 'auth_test',
  version: 3,
  rounds: [{ r: 1, legoId: 'S0025L02', seed: 25 }],
}
const CYCLES = {
  course_code: 'auth_test',
  version: 3,
  next_lego_id: null,
  cycles: [
    {
      id: 'c1', type: 'intro', lego_id: 'S0025L02', seed_number: 25,
      known_text: 'hello', target_text: 'bonjour', audio: {}, durations: {}, is_new: true,
    },
  ],
}

function makeFetch() {
  // Records the headers each URL was called with. Emulates the gate: a request
  // WITHOUT a bearer token to a premium lego past seed 19 gets 403; WITH a token
  // it gets 200.
  const calls: Array<{ url: string; auth: string | null }> = []
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const auth = (init?.headers as Record<string, string> | undefined)?.Authorization ?? null
    calls.push({ url, auth })
    if (url.includes('/round-map')) {
      return Promise.resolve({ ok: true, status: 200, statusText: 'OK', json: () => Promise.resolve(ROUND_MAP) })
    }
    if (url.includes('/cycles')) {
      if (!auth) {
        return Promise.resolve({ ok: false, status: 403, statusText: 'Forbidden', json: () => Promise.resolve({ error: 'Subscription required' }) })
      }
      return Promise.resolve({ ok: true, status: 200, statusText: 'OK', json: () => Promise.resolve(CYCLES) })
    }
    return Promise.resolve({ ok: true, status: 200, statusText: 'OK' })
  })
  return { calls, fetchMock }
}

describe('useInstantPlayback — auth token on fast-path fetches', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
    setInstantPlaybackAuthProvider(null)
    try { localStorage.clear() } catch { /* no localStorage in this env */ }
  })
  afterEach(() => {
    setInstantPlaybackAuthProvider(null)
  })

  it('attaches the Authorization bearer token to round-map and cycles when a provider is set', async () => {
    const { calls, fetchMock } = makeFetch()
    vi.stubGlobal('fetch', fetchMock)
    setInstantPlaybackAuthProvider(async () => 'test-jwt-token')

    await prewarmInstantCaches('auth_test')

    const roundMap = calls.find(c => c.url.includes('/round-map'))
    const cycles = calls.find(c => c.url.includes('/cycles'))
    expect(roundMap?.auth).toBe('Bearer test-jwt-token')
    expect(cycles?.auth).toBe('Bearer test-jwt-token')
  })

  it('a signed-in paid learner past seed 19 stays on the fast path — no 403', async () => {
    const { calls, fetchMock } = makeFetch()
    vi.stubGlobal('fetch', fetchMock)
    setInstantPlaybackAuthProvider(async () => 'paid-user-jwt')

    // Resume anchored past the free-preview window (seed 25). With the token
    // attached the gate authorises the learner and bootstrap succeeds — no
    // throw, no fallback.
    const instant = useInstantPlayback(ref('auth_test'), {
      resolveStartLegoId: () => 'S0025L02',
    })
    const result = await instant.bootstrap()

    expect(result.firstCycle.id).toBe('c1')
    const cyclesCall = calls.find(c => c.url.includes('/cycles'))
    expect(cyclesCall?.auth).toBe('Bearer paid-user-jwt')
  })

  it('without a provider (guest / free course) the fetch still goes out anonymous', async () => {
    const { calls, fetchMock } = makeFetch()
    vi.stubGlobal('fetch', fetchMock)
    // no provider set

    await prewarmInstantCaches('auth_test')

    const roundMap = calls.find(c => c.url.includes('/round-map'))
    expect(roundMap?.auth).toBeNull()
  })
})
