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
