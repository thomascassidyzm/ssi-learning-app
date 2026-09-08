/**
 * THE FRESH BUYER'S RECEIPT — regression, Tom 2026-09-07.
 *
 * A brand-new account bought SSi Family for £25. Paddle took the money, the
 * webhook wrote the subscriptions row one second later, /api/subscription
 * returned it correctly — and the app still offered the Upgrade row, because
 * the ONLY thing that told it a purchase had happened was Paddle's success
 * redirect (?just_subscribed=1), which had not landed.
 *
 * These assert the in-page path: Paddle's own checkout.completed event makes
 * the app converge on the purchase with no redirect at all. Both fail on the
 * pre-fix code, where nothing listens for that event.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

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

const FAMILY_RESPONSE = {
  subscription: {
    id: 'b119e295-2faf-4d44-b018-cee49cb3d797',
    learnerId: '36afb73b-1d2b-4ea2-b6d7-a1e5b2105e5b',
    status: 'active',
    planId: 'pri_01kypr3nmr37sqaq9sb50m3xn2',
    planName: 'SSi Family',
    currentPeriodEnd: '2036-10-07T23:41:26.033Z',
    cancelAtPeriodEnd: false,
    provider: 'paddle',
  },
  isSubscribed: true,
}

const NO_SUBSCRIPTION = { subscription: null, isSubscribed: false }

/** Boots a shared instance whose /api/subscription answers change over time. */
async function setup(responses: unknown[]) {
  const { setSchoolsClient } = await import('./schools/client')
  setSchoolsClient({
    auth: { getSession: () => Promise.resolve({ data: { session: { access_token: 't' } } }) },
  } as any)
  const queue = [...responses]
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(queue.length > 1 ? queue.shift() : queue[0]),
      })
    )
  )
  const { useSharedSubscription, CHECKOUT_COMPLETED_EVENT_NAME } = await import('./useSubscription')
  return { sub: useSharedSubscription(), eventName: CHECKOUT_COMPLETED_EVENT_NAME }
}

describe('useSubscription — Paddle checkout.completed, without the success redirect', () => {
  beforeEach(() => {
    vi.resetModules()
    Object.keys(store).forEach((k) => delete store[k])
    vi.unstubAllGlobals()
  })
  afterEach(() => { vi.useRealTimers() })

  it('a brand new account that buys Family ends up holding Family, with no redirect', async () => {
    // The buyer's page: booted signed-in and unsubscribed, then pays. The
    // webhook lands a moment later, so the API only reports Family on the
    // SECOND read — exactly the real ordering.
    const { sub, eventName } = await setup([NO_SUBSCRIPTION, FAMILY_RESPONSE])
    await sub.initialize()
    expect(sub.isSubscribed.value).toBe(false)

    // Paddle confirms the payment in-page. No navigation, no ?just_subscribed=1.
    window.dispatchEvent(new CustomEvent(eventName))

    await vi.waitFor(() => {
      expect(sub.isSubscribed.value).toBe(true)
    }, { timeout: 8000 })
    expect(sub.subscription.value?.planName).toBe('SSi Family')
  })

  it('drops the cached pre-purchase answer, so the next page load cannot serve it', async () => {
    const { sub, eventName } = await setup([NO_SUBSCRIPTION, FAMILY_RESPONSE])
    await sub.initialize()
    // Boot cached "not subscribed" with a 5-minute TTL.
    expect(JSON.parse(store['ssi_subscription']).isSubscribed).toBe(false)

    window.dispatchEvent(new CustomEvent(eventName))

    await vi.waitFor(() => {
      expect(JSON.parse(store['ssi_subscription']).isSubscribed).toBe(true)
    }, { timeout: 8000 })
  })
})
