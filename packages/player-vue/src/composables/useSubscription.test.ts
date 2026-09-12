/**
 * useSubscription — hydration-timeout fail-closed behaviour.
 *
 * The security-relevant case: checkCourseAccess (core/pricing) treats
 * `isPending` (derived from `!hasHydrated`) as an optimistic full-access
 * grant. Before the hydration timeout, a caller who could block
 * /api/subscription from ever resolving kept isPending=true forever. This
 * asserts hydration completes (fail-closed) even when the fetch never
 * settles, while a normal fast response still hydrates correctly.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const store: Record<string, string> = {}
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value }),
    removeItem: vi.fn((key: string) => { delete store[key] }),
    clear: vi.fn(() => { Object.keys(store).forEach((k) => delete store[k]) }),
  },
  writable: true,
})

async function setup(fetchImpl: (...args: any[]) => any) {
  const { setSchoolsClient } = await import('./schools/client')
  setSchoolsClient({
    auth: {
      getSession: () =>
        Promise.resolve({ data: { session: { access_token: 'test-token' } } }),
    },
  } as any)
  vi.stubGlobal('fetch', vi.fn(fetchImpl))
  const { useSubscription } = await import('./useSubscription')
  return useSubscription()
}

describe('useSubscription — hydration timeout', () => {
  beforeEach(() => {
    vi.resetModules()
    Object.keys(store).forEach((k) => delete store[k])
    vi.unstubAllGlobals()
  })

  it('fails closed (hasHydrated=true, isSubscribed=false) if /api/subscription never resolves', async () => {
    vi.useFakeTimers()
    try {
      const sub = await setup(() => new Promise(() => {})) // never settles

      expect(sub.hasHydrated.value).toBe(false)
      const initPromise = sub.initialize()
      await vi.advanceTimersByTimeAsync(8000)
      await initPromise

      expect(sub.hasHydrated.value).toBe(true)
      expect(sub.isSubscribed.value).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('hydrates normally on a fast successful response, well within the timeout', async () => {
    const sub = await setup(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            subscription: {
              id: 's1',
              learnerId: 'l1',
              status: 'active',
              planId: 'monthly',
              planName: 'Monthly',
              currentPeriodEnd: null,
              cancelAtPeriodEnd: false,
              provider: 'stripe',
            },
            isSubscribed: true,
          }),
      }),
    )

    await sub.initialize()

    expect(sub.hasHydrated.value).toBe(true)
    expect(sub.isSubscribed.value).toBe(true)
  })

  it('a late response after the timeout still updates subscription state once it lands', async () => {
    vi.useFakeTimers()
    try {
      let resolveFetch: (v: any) => void
      const pending = new Promise((resolve) => { resolveFetch = resolve })
      const sub = await setup(() => pending)

      const initPromise = sub.initialize()
      await vi.advanceTimersByTimeAsync(8000)
      await initPromise

      // Timed out fail-closed first.
      expect(sub.hasHydrated.value).toBe(true)
      expect(sub.isSubscribed.value).toBe(false)

      // The stalled request finally resolves in the background — state
      // corrects itself rather than staying wrong for the rest of the session.
      resolveFetch!({
        ok: true,
        json: () =>
          Promise.resolve({
            subscription: {
              id: 's1',
              learnerId: 'l1',
              status: 'active',
              planId: 'monthly',
              planName: 'Monthly',
              currentPeriodEnd: null,
              cancelAtPeriodEnd: false,
              provider: 'stripe',
            },
            isSubscribed: true,
          }),
      })
      await vi.advanceTimersByTimeAsync(0)

      expect(sub.isSubscribed.value).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })
})

/**
 * OFFLINE REOPEN (Tom, 2026-09-12, job #378·G). A paying Family owner opened
 * the app in airplane mode and Settings offered him nothing — "zero access".
 * The server rows were right all along. What happened on the device: the
 * localStorage mirror of /api/subscription carried a 5-minute TTL, so a boot
 * more than five minutes after the last online one threw the mirror away,
 * the fetch failed instantly with no network, `initialize()` then declared
 * hydration done with `subscription === null`, and every premium course fell
 * to the free preview. The mirror is the ONLY answer the app has offline, so
 * its age must never be a reason to discard it: the fetch overwrites it the
 * moment a real answer arrives, and `isSubscribed` still checks the paid
 * period's end date against the clock, so a lapsed period fails closed
 * regardless of how old the mirror is.
 */
describe('useSubscription — offline reopen keeps the last known subscription', () => {
  beforeEach(() => {
    vi.resetModules()
    Object.keys(store).forEach((k) => delete store[k])
    vi.unstubAllGlobals()
  })

  const paidUntilNextMonth = {
    id: 'fam-1',
    learnerId: 'owner',
    status: 'active',
    planId: 'pri_family_monthly',
    planName: 'SSi Family',
    currentPeriodEnd: new Date(Date.now() + 25 * 24 * 60 * 60 * 1000).toISOString(),
    cancelAtPeriodEnd: true,
    provider: 'paddle',
  }

  it('a mirror older than five minutes still grants access when the fetch fails offline', async () => {
    store['ssi_subscription'] = JSON.stringify({
      subscription: paidUntilNextMonth,
      isSubscribed: true,
      freeAccess: null,
      cachedAt: Date.now() - 2 * 60 * 60 * 1000, // last online boot was two hours ago
    })
    // Airplane mode: fetch rejects at once, the way the browser does.
    const sub = await setup(() => Promise.reject(new TypeError('Failed to fetch')))

    await sub.initialize()

    expect(sub.hasHydrated.value).toBe(true)
    expect(sub.subscription.value?.planName).toBe('SSi Family')
    expect(sub.isSubscribed.value).toBe(true)
  })

  it('a mirror whose paid period has already ended still fails closed offline', async () => {
    store['ssi_subscription'] = JSON.stringify({
      subscription: {
        ...paidUntilNextMonth,
        currentPeriodEnd: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      },
      isSubscribed: true,
      freeAccess: null,
      cachedAt: Date.now() - 2 * 60 * 60 * 1000,
    })
    const sub = await setup(() => Promise.reject(new TypeError('Failed to fetch')))

    await sub.initialize()

    expect(sub.hasHydrated.value).toBe(true)
    expect(sub.isSubscribed.value).toBe(false)
  })

  it('a fresh online answer replaces the mirror, however old the mirror was', async () => {
    store['ssi_subscription'] = JSON.stringify({
      subscription: paidUntilNextMonth,
      isSubscribed: true,
      freeAccess: null,
      cachedAt: Date.now() - 2 * 60 * 60 * 1000,
    })
    const sub = await setup(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ subscription: null, isSubscribed: false }),
      }),
    )

    await sub.initialize()

    expect(sub.hasHydrated.value).toBe(true)
    expect(sub.subscription.value).toBeNull()
    expect(sub.isSubscribed.value).toBe(false)
  })
})
